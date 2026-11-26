import { describe, expect, it } from 'vitest';
import { createApp, type AppDependencies } from '../app.js';
import {
  InMemoryAgentDirectory,
  InMemorySupervisorNotifier,
  InMemoryTicketStore,
  type IdGenerator,
} from '../infrastructure/index.js';
import { FixedClock, requestAgainstApp } from '../test-utils/index.js';

const CREATED_AT = new Date('2025-01-01T00:00:00.000Z');
const DUE_AT = new Date('2025-01-01T08:00:00.000Z');

function createExpiryApp() {
  let nextId = 0;
  const clock = new FixedClock(CREATED_AT);
  const store = new InMemoryTicketStore();
  const supervisorNotifier = new InMemorySupervisorNotifier();
  const dependencies: AppDependencies = {
    store,
    clock,
    idGenerator: { next: () => `ticket-${++nextId}` } satisfies IdGenerator,
    agentDirectory: new InMemoryAgentDirectory(),
    supervisorNotifier,
  };

  return {
    client: requestAgainstApp(createApp(dependencies)),
    clock,
    store,
    supervisorNotifier,
  };
}

async function createTicket(client: ReturnType<typeof requestAgainstApp>) {
  const response = await client.post('/tickets').send({
    title: 'VPN access failure',
    description: 'The user cannot connect from the office.',
    category: 'ACCESOS',
    priority: 'ALTA',
    requester: 'user-123',
  });

  expect(response.status).toBe(201);
  expect(response.body.dueAt).toBe(DUE_AT.toISOString());
  return response.body as { id: string };
}

describe('ticket expiry HTTP integration', () => {
  it.each([
    ['before dueAt', new Date(DUE_AT.getTime() - 1), false],
    ['exactly at dueAt', DUE_AT, false],
  ] as const)('returns no expiry events when requested %s', async (_case, now, overdue) => {
    const { client, clock, store, supervisorNotifier } = createExpiryApp();
    const ticket = await createTicket(client);
    clock.set(now);

    const response = await client.get(`/tickets/${ticket.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      id: ticket.id,
      overdue,
      overdueCycle: 1,
      escalations: [],
      supervisorNotifications: [],
    }));
    expect(response.body.dueAt).toBe(DUE_AT.toISOString());
    expect(store.listEscalations(ticket.id)).toEqual([]);
    expect(store.listSupervisorNotifications(ticket.id)).toEqual([]);
    expect(supervisorNotifier.listNotifications()).toEqual([]);
  });

  it('serializes the service result with complete ISO expiry records after dueAt', async () => {
    const { client, clock, store, supervisorNotifier } = createExpiryApp();
    const ticket = await createTicket(client);
    const evaluatedAt = new Date(DUE_AT.getTime() + 1);
    clock.set(evaluatedAt);

    const response = await client.get(`/tickets/${ticket.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      id: ticket.id,
      overdue: true,
      overdueCycle: 1,
      escalations: [{
        ticketId: ticket.id,
        cycle: 1,
        escalatedAt: evaluatedAt.toISOString(),
        notifiedAt: evaluatedAt.toISOString(),
      }],
      supervisorNotifications: [{
        ticketId: ticket.id,
        cycle: 1,
        notifiedAt: evaluatedAt.toISOString(),
      }],
    }));
    expect(response.body.dueAt).toBe(DUE_AT.toISOString());
    expect(store.listEscalations(ticket.id)).toHaveLength(1);
    expect(store.listSupervisorNotifications(ticket.id)).toHaveLength(1);
    expect(supervisorNotifier.listNotifications()).toHaveLength(1);
  });

  it('does not duplicate events when HTTP reads the same expired ticket repeatedly', async () => {
    const { client, clock, store, supervisorNotifier } = createExpiryApp();
    const ticket = await createTicket(client);
    clock.set(new Date(DUE_AT.getTime() + 1));

    const first = await client.get(`/tickets/${ticket.id}`);
    const second = await client.get(`/tickets/${ticket.id}`);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.escalations).toHaveLength(1);
    expect(second.body.supervisorNotifications).toHaveLength(1);
    expect(store.listEscalations(ticket.id)).toHaveLength(1);
    expect(store.listSupervisorNotifications(ticket.id)).toHaveLength(1);
    expect(supervisorNotifier.listNotifications()).toHaveLength(1);
  });
});
