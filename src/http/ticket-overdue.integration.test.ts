import { describe, expect, it } from 'vitest';
import { createApp, type AppDependencies } from '../app.js';
import type { Priority } from '../domain/index.js';
import {
  InMemoryAgentDirectory,
  InMemorySupervisorNotifier,
  InMemoryTicketStore,
  type IdGenerator,
  type SupervisorNotifier,
} from '../infrastructure/index.js';
import { FixedClock, requestAgainstApp } from '../test-utils/index.js';

const BASE_TIME = new Date('2025-01-01T00:00:00.000Z');
const SUPERVISOR = 'supervisor-1';
const AGENT = 'agent-1';

const SLA_MS: Record<Priority, number> = {
  CRITICA: 4 * 60 * 60 * 1000,
  ALTA: 8 * 60 * 60 * 1000,
  MEDIA: 24 * 60 * 60 * 1000,
  BAJA: 72 * 60 * 60 * 1000,
};

interface TestContext {
  client: ReturnType<typeof requestAgainstApp>;
  clock: FixedClock;
  store: InMemoryTicketStore;
  supervisorNotifier: InMemorySupervisorNotifier;
}

class FailingSupervisorNotifier implements SupervisorNotifier {
  readonly emitted: string[] = [];

  notify(record: { ticketId: string }): void {
    this.emitted.push(record.ticketId);
    throw new Error('supervisor notifier unavailable');
  }
}

function createTestContext(): TestContext {
  let nextId = 0;
  const clock = new FixedClock(BASE_TIME);
  const store = new InMemoryTicketStore();
  const supervisorNotifier = new InMemorySupervisorNotifier();
  const idGenerator: IdGenerator = {
    next: () => `ticket-${++nextId}`,
  };
  const dependencies: AppDependencies = {
    store,
    clock,
    idGenerator,
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

async function createTicket(
  client: TestContext['client'],
  category: string = 'ACCESOS',
  priority: Priority = 'ALTA',
): Promise<{ id: string; dueAt: string }> {
  const response = await client.post('/tickets').send({
    title: `${category} ticket`,
    description: 'Ticket used by overdue integration tests.',
    category,
    priority,
    requester: 'requester-1',
  });

  expect(response.status).toBe(201);
  return { id: response.body.id as string, dueAt: response.body.dueAt as string };
}

describe('SLA and GET /tickets/overdue integration', () => {
  it.each(Object.entries(SLA_MS) as Array<[Priority, number]>)
    ('uses the %s SLA and applies strict before/equal/after dueAt boundaries', async (priority, slaMs) => {
      const { client, clock, store, supervisorNotifier } = createTestContext();
      const ticket = await createTicket(client, 'ACCESOS', priority);
      const dueAt = new Date(BASE_TIME.getTime() + slaMs);

      expect(ticket.dueAt).toBe(dueAt.toISOString());

      clock.set(new Date(dueAt.getTime() - 1));
      const beforeDueAt = await client
        .get('/tickets/overdue')
        .set('X-Actor-Id', SUPERVISOR);
      expect(beforeDueAt.status).toBe(200);
      expect(beforeDueAt.body).toEqual([]);

      clock.set(dueAt);
      const atDueAt = await client
        .get('/tickets/overdue')
        .set('X-Actor-Id', SUPERVISOR);
      expect(atDueAt.status).toBe(200);
      expect(atDueAt.body).toEqual([]);

      clock.set(new Date(dueAt.getTime() + 1));
      const afterDueAt = await client
        .get('/tickets/overdue')
        .set('X-Actor-Id', SUPERVISOR);
      expect(afterDueAt.status).toBe(200);
      expect(afterDueAt.body).toEqual([
        expect.objectContaining({
          id: ticket.id,
          overdue: true,
          overdueCycle: 1,
          escalations: [
            expect.objectContaining({
              cycle: 1,
              escalatedAt: new Date(dueAt.getTime() + 1).toISOString(),
            }),
          ],
          supervisorNotifications: [
            expect.objectContaining({
              cycle: 1,
              notifiedAt: new Date(dueAt.getTime() + 1).toISOString(),
            }),
          ],
        }),
      ]);
      expect(store.listEscalations(ticket.id)).toHaveLength(1);
      expect(store.listSupervisorNotifications(ticket.id)).toHaveLength(1);
      expect(supervisorNotifier.list()).toHaveLength(1);
    });

  it('authorizes supervisors, filters by category, and rejects invalid categories', async () => {
    const { client, clock } = createTestContext();
    const accessTicket = await createTicket(client, 'ACCESOS', 'BAJA');
    const applicationTicket = await createTicket(client, 'APLICACIONES', 'BAJA');
    clock.set(new Date(BASE_TIME.getTime() + SLA_MS.BAJA + 1));

    const allOverdue = await client
      .get('/tickets/overdue')
      .set('X-Actor-Id', SUPERVISOR);
    expect(allOverdue.status).toBe(200);
    expect(allOverdue.body.map((ticket: { id: string }) => ticket.id)).toEqual([
      accessTicket.id,
      applicationTicket.id,
    ]);

    const filtered = await client
      .get('/tickets/overdue')
      .query({ category: 'APLICACIONES' })
      .set('X-Actor-Id', SUPERVISOR);
    expect(filtered.status).toBe(200);
    expect(filtered.body).toEqual([
      expect.objectContaining({ id: applicationTicket.id, category: 'APLICACIONES' }),
    ]);

    const invalidCategory = await client
      .get('/tickets/overdue')
      .query({ category: 'NO_EXISTE' })
      .set('X-Actor-Id', SUPERVISOR);
    expect(invalidCategory.status).toBe(400);
    expect(invalidCategory.body).toEqual({
      error: expect.objectContaining({ code: 'INVALID_REQUEST' }),
    });

    const nonSupervisor = await client
      .get('/tickets/overdue')
      .set('X-Actor-Id', AGENT);
    expect(nonSupervisor.status).toBe(403);
    expect(nonSupervisor.body).toEqual({
      error: expect.objectContaining({ code: 'SUPERVISOR_REQUIRED' }),
    });
  });

  it('emits one escalation and notification per cycle with consistent dates', async () => {
    const { client, clock, store, supervisorNotifier } = createTestContext();
    const ticket = await createTicket(client);
    const breachAt = new Date(new Date(ticket.dueAt).getTime() + 1);
    clock.set(breachAt);

    const firstQuery = await client
      .get('/tickets/overdue')
      .set('X-Actor-Id', SUPERVISOR);
    const secondQuery = await client
      .get('/tickets/overdue')
      .set('X-Actor-Id', SUPERVISOR);
    const thirdQuery = await client
      .get('/tickets/overdue')
      .set('X-Actor-Id', SUPERVISOR);

    for (const response of [firstQuery, secondQuery, thirdQuery]) {
      expect(response.status).toBe(200);
      expect(response.body[0]).toEqual(
        expect.objectContaining({
          id: ticket.id,
          escalations: [
            expect.objectContaining({
              ticketId: ticket.id,
              cycle: 1,
              escalatedAt: breachAt.toISOString(),
              notifiedAt: breachAt.toISOString(),
            }),
          ],
          supervisorNotifications: [
            expect.objectContaining({
              ticketId: ticket.id,
              cycle: 1,
              notifiedAt: breachAt.toISOString(),
            }),
          ],
        }),
      );
    }

    expect(store.listEscalations(ticket.id)).toHaveLength(1);
    expect(store.listSupervisorNotifications(ticket.id)).toHaveLength(1);
    expect(supervisorNotifier.list()).toHaveLength(1);
    expect(store.listEscalations(ticket.id)[0]?.notifiedAt).toEqual(breachAt);
    expect(store.listSupervisorNotifications(ticket.id)[0]?.notifiedAt).toEqual(
      breachAt,
    );
    expect(supervisorNotifier.list()[0]?.notifiedAt).toEqual(breachAt);
  });

  it('preserves resolved and closed records, then creates one new cycle after reopening and re-breaching', async () => {
    const { client, clock, store, supervisorNotifier } = createTestContext();
    const ticket = await createTicket(client);
    const dueAt = new Date(ticket.dueAt);
    const firstBreachAt = new Date(dueAt.getTime() + 1);
    clock.set(firstBreachAt);

    const firstOverdue = await client
      .get('/tickets/overdue')
      .set('X-Actor-Id', SUPERVISOR);
    expect(firstOverdue.status).toBe(200);
    const firstEscalation = firstOverdue.body[0].escalations[0];
    const firstNotification = firstOverdue.body[0].supervisorNotifications[0];

    const assignment = await client
      .patch(`/tickets/${ticket.id}/assignment`)
      .set('X-Actor-Id', SUPERVISOR)
      .send({ responsibleId: AGENT });
    expect(assignment.status).toBe(200);

    const progress = await client
      .patch(`/tickets/${ticket.id}/status`)
      .set('X-Actor-Id', AGENT)
      .send({ status: 'EN_PROGRESO' });
    expect(progress.status).toBe(200);

    const resolved = await client
      .patch(`/tickets/${ticket.id}/status`)
      .set('X-Actor-Id', AGENT)
      .send({ status: 'RESUELTO', resolutionNote: 'VPN restored' });
    expect(resolved.status).toBe(200);
    expect(resolved.body).toMatchObject({
      status: 'RESUELTO',
      overdue: true,
      overdueCycle: 1,
      resolutionNote: 'VPN restored',
      escalations: [firstEscalation],
      supervisorNotifications: [firstNotification],
    });

    const closed = await client
      .patch(`/tickets/${ticket.id}/status`)
      .set('X-Actor-Id', AGENT)
      .send({ status: 'CERRADO' });
    expect(closed.status).toBe(200);
    expect(closed.body).toMatchObject({
      status: 'CERRADO',
      overdue: true,
      overdueCycle: 1,
      escalations: [firstEscalation],
      supervisorNotifications: [firstNotification],
    });
    expect(closed.body.closedAt).toBe(firstBreachAt.toISOString());

    const reopened = await client
      .patch(`/tickets/${ticket.id}/status`)
      .set('X-Actor-Id', AGENT)
      .send({ status: 'EN_PROGRESO' });
    expect(reopened.status).toBe(200);
    expect(reopened.body).toMatchObject({
      status: 'EN_PROGRESO',
      overdue: false,
      overdueCycle: 2,
      resolutionNote: null,
      resolvedAt: null,
      closedAt: null,
      escalations: [firstEscalation],
      supervisorNotifications: [firstNotification],
    });

    const secondBreach = await client
      .get('/tickets/overdue')
      .set('X-Actor-Id', SUPERVISOR);
    expect(secondBreach.status).toBe(200);
    expect(secondBreach.body[0]).toMatchObject({
      id: ticket.id,
      status: 'EN_PROGRESO',
      overdue: true,
      overdueCycle: 2,
      escalations: [
        firstEscalation,
        expect.objectContaining({
          ticketId: ticket.id,
          cycle: 2,
          escalatedAt: firstBreachAt.toISOString(),
          notifiedAt: firstBreachAt.toISOString(),
        }),
      ],
      supervisorNotifications: [
        firstNotification,
        expect.objectContaining({
          ticketId: ticket.id,
          cycle: 2,
          notifiedAt: firstBreachAt.toISOString(),
        }),
      ],
    });

    await client.get('/tickets/overdue').set('X-Actor-Id', SUPERVISOR);
    expect(store.listEscalations(ticket.id)).toHaveLength(2);
    expect(store.listSupervisorNotifications(ticket.id)).toHaveLength(2);
    expect(supervisorNotifier.list()).toHaveLength(2);
    expect(store.listEscalations(ticket.id)[0]?.cycle).toBe(1);
    expect(store.listEscalations(ticket.id)[1]?.cycle).toBe(2);
    expect(store.listSupervisorNotifications(ticket.id)[0]?.cycle).toBe(1);
    expect(store.listSupervisorNotifications(ticket.id)[1]?.cycle).toBe(2);
  });

  it('returns the existing HTTP error contracts for listOverdue authorization and validation failures', async () => {
    const { client } = createTestContext();

    const missingActor = await client.get('/tickets/overdue');
    expect(missingActor.status).toBe(403);
    expect(missingActor.body).toEqual({
      error: expect.objectContaining({ code: 'SUPERVISOR_REQUIRED' }),
    });

    const unknownActor = await client
      .get('/tickets/overdue')
      .set('X-Actor-Id', 'unknown-actor');
    expect(unknownActor.status).toBe(403);
    expect(unknownActor.body).toEqual({
      error: expect.objectContaining({ code: 'SUPERVISOR_REQUIRED' }),
    });

    const invalidCategory = await client
      .get('/tickets/overdue')
      .query({ category: 'INVALID' })
      .set('X-Actor-Id', SUPERVISOR);
    expect(invalidCategory.status).toBe(400);
    expect(invalidCategory.body).toEqual({
      error: expect.objectContaining({ code: 'INVALID_REQUEST' }),
    });
  });

  it('persists the notification before invoking the supervisor notifier', async () => {
    const clock = new FixedClock(BASE_TIME);
    const store = new InMemoryTicketStore();
    let nextId = 0;
    const observedPersistedCounts: number[] = [];
    const notifier: SupervisorNotifier = {
      notify: (record) => {
        observedPersistedCounts.push(
          store.listSupervisorNotifications(record.ticketId).length,
        );
      },
    };
    const client = requestAgainstApp(
      createApp({
        store,
        clock,
        idGenerator: { next: () => `ticket-${++nextId}` },
        agentDirectory: new InMemoryAgentDirectory(),
        supervisorNotifier: notifier,
      }),
    );
    const ticket = await createTicket(client);
    const breachAt = new Date(new Date(ticket.dueAt).getTime() + 1);
    clock.set(breachAt);

    const response = await client
      .get('/tickets/overdue')
      .set('X-Actor-Id', SUPERVISOR);

    expect(response.status).toBe(200);
    expect(observedPersistedCounts).toEqual([1]);
    expect(store.listSupervisorNotifications(ticket.id)).toHaveLength(1);
  });

  it('keeps the persisted event and does not duplicate notification after notifier failure', async () => {
    const clock = new FixedClock(BASE_TIME);
    const store = new InMemoryTicketStore();
    const notifier = new FailingSupervisorNotifier();
    let nextId = 0;
    const client = requestAgainstApp(
      createApp({
        store,
        clock,
        idGenerator: { next: () => `ticket-${++nextId}` },
        agentDirectory: new InMemoryAgentDirectory(),
        supervisorNotifier: notifier,
      }),
    );
    const ticket = await createTicket(client);
    clock.set(new Date(new Date(ticket.dueAt).getTime() + 1));

    const firstAttempt = await client
      .get('/tickets/overdue')
      .set('X-Actor-Id', SUPERVISOR);
    expect(firstAttempt.status).toBe(500);
    expect(firstAttempt.body).toEqual({
      error: expect.objectContaining({ code: 'INTERNAL_ERROR' }),
    });

    const secondAttempt = await client
      .get('/tickets/overdue')
      .set('X-Actor-Id', SUPERVISOR);
    expect(secondAttempt.status).toBe(200);
    expect(secondAttempt.body[0]).toEqual(
      expect.objectContaining({
        id: ticket.id,
        overdue: true,
        escalations: [expect.objectContaining({ cycle: 1 })],
        supervisorNotifications: [expect.objectContaining({ cycle: 1 })],
      }),
    );
    expect(store.listEscalations(ticket.id)).toHaveLength(1);
    expect(store.listSupervisorNotifications(ticket.id)).toHaveLength(1);
    expect(notifier.emitted).toEqual([ticket.id]);
  });
});
