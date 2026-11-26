import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp, type AppDependencies } from '../app.js';
import type { Ticket } from '../domain/index.js';
import {
  InMemoryAgentDirectory,
  InMemorySupervisorNotifier,
  InMemoryTicketStore,
} from '../infrastructure/index.js';
import { FixedClock } from '../test-utils/index.js';
import { mapTicketToResponse } from './mappers.js';

const CREATED_AT = new Date('2025-01-01T00:00:00.000Z');

class TestIdGenerator {
  private sequence = 0;

  next(): string {
    this.sequence += 1;
    return `ticket-${this.sequence}`;
  }
}

function createTestContext() {
  const clock = new FixedClock(CREATED_AT);
  const dependencies: AppDependencies = {
    store: new InMemoryTicketStore(),
    clock,
    idGenerator: new TestIdGenerator(),
    agentDirectory: new InMemoryAgentDirectory(),
    supervisorNotifier: new InMemorySupervisorNotifier(),
  };

  return { client: request(createApp(dependencies)), clock };
}

async function createTicket(
  client: ReturnType<typeof request>,
  priority: 'ALTA' | 'CRITICA' = 'ALTA',
): Promise<string> {
  const response = await client.post('/tickets').send({
    title: 'VPN access failure',
    description: 'The user cannot connect from the office.',
    category: 'ACCESOS',
    priority,
    requester: 'user-123',
  });

  expect(response.status).toBe(201);
  return response.body.id as string;
}

function expectStandardError(
  response: {
    status: number;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  },
  status: number,
  code: string,
): void {
  expect(response.status).toBe(status);
  expect(response.headers['content-type']).toMatch(/json/);
  expect(response.body).toEqual({
    error: expect.objectContaining({
      code,
      message: expect.any(String),
    }),
  });
  expect(response.body).not.toHaveProperty('stack');
  expect(Object.keys(response.body)).toEqual(['error']);
}

describe('HTTP error and response contract regressions', () => {
  it('returns ACTOR_REQUIRED for a mutating request without an actor', async () => {
    const { client } = createTestContext();
    const ticketId = await createTicket(client);

    const response = await client
      .patch(`/tickets/${ticketId}/status`)
      .send({ status: 'EN_PROGRESO' });

    expectStandardError(response, 400, 'ACTOR_REQUIRED');
  });

  it('returns ACTOR_UNKNOWN for a valid but unknown actor', async () => {
    const { client } = createTestContext();
    const ticketId = await createTicket(client);

    const response = await client
      .patch(`/tickets/${ticketId}/status`)
      .set('X-Actor-Id', 'actor-does-not-exist')
      .send({ status: 'EN_PROGRESO' });

    expectStandardError(response, 400, 'ACTOR_UNKNOWN');
  });

  it('returns SUPERVISOR_REQUIRED for an actor without supervisor permission', async () => {
    const { client } = createTestContext();

    const response = await client
      .get('/tickets/overdue')
      .set('X-Actor-Id', 'agent-1');

    expectStandardError(response, 403, 'SUPERVISOR_REQUIRED');
  });

  it('returns AGENT_UNAVAILABLE for an inactive responsible agent', async () => {
    const { client } = createTestContext();
    const ticketId = await createTicket(client);

    const response = await client
      .patch(`/tickets/${ticketId}/assignment`)
      .set('X-Actor-Id', 'supervisor-1')
      .send({ responsibleId: 'agent-inactive' });

    expectStandardError(response, 409, 'AGENT_UNAVAILABLE');
  });

  it('returns INVALID_TRANSITION without mutating the ticket or its history', async () => {
    const { client } = createTestContext();
    const ticketId = await createTicket(client);
    const before = await client.get(`/tickets/${ticketId}`);
    expect(before.status).toBe(200);

    const response = await client
      .patch(`/tickets/${ticketId}/status`)
      .set('X-Actor-Id', 'agent-1')
      .send({ status: 'EN_PROGRESO' });

    expectStandardError(response, 409, 'INVALID_TRANSITION');

    const after = await client.get(`/tickets/${ticketId}`);
    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({
      id: before.body.id,
      status: before.body.status,
      responsibleId: before.body.responsibleId,
      updatedAt: before.body.updatedAt,
      overdue: before.body.overdue,
      overdueCycle: before.body.overdueCycle,
      escalations: before.body.escalations,
      supervisorNotifications: before.body.supervisorNotifications,
    });

    const history = await client.get(`/tickets/${ticketId}/history`);
    expect(history.status).toBe(200);
    expect(history.body).toEqual([]);
  });

  it('returns TICKET_NOT_FOUND for a missing ticket resource', async () => {
    const { client } = createTestContext();

    const response = await client.get('/tickets/missing-ticket');

    expectStandardError(response, 404, 'TICKET_NOT_FOUND');
  });

  it('returns INVALID_REQUEST details associated with invalid fields', async () => {
    const { client } = createTestContext();

    const response = await client.post('/tickets').send({
      title: 'VPN access failure',
      category: 'ACCESOS',
    });

    expectStandardError(response, 400, 'INVALID_REQUEST');
    expect(response.body.error).toEqual({
      code: 'INVALID_REQUEST',
      message: 'Request validation failed',
      details: expect.arrayContaining([
        expect.objectContaining({ path: ['description'], code: 'invalid_type' }),
        expect.objectContaining({ path: ['priority'], code: 'invalid_value' }),
        expect.objectContaining({ path: ['requester'], code: 'invalid_type' }),
      ]),
    });
  });

  it('maps every escalation, cycle, and supervisor notification without loss', () => {
    const ticket: Ticket = {
      id: 'ticket-with-events',
      title: 'VPN access failure',
      description: 'The user cannot connect from the office.',
      category: 'ACCESOS',
      priority: 'CRITICA',
      requester: 'user-123',
      responsibleId: 'agent-1',
      status: 'EN_PROGRESO',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T09:00:00.000Z'),
      dueAt: new Date('2025-01-01T04:00:00.000Z'),
      resolutionNote: null,
      resolvedAt: null,
      closedAt: null,
      overdue: true,
      overdueCycle: 2,
      escalations: [
        {
          ticketId: 'ticket-with-events',
          cycle: 1,
          escalatedAt: new Date('2025-01-01T04:00:00.001Z'),
          notifiedAt: new Date('2025-01-01T04:00:00.002Z'),
        },
        {
          ticketId: 'ticket-with-events',
          cycle: 2,
          escalatedAt: new Date('2025-01-01T08:00:00.001Z'),
          notifiedAt: new Date('2025-01-01T08:00:00.002Z'),
        },
      ],
      supervisorNotifications: [
        {
          ticketId: 'ticket-with-events',
          cycle: 1,
          notifiedAt: new Date('2025-01-01T04:00:00.002Z'),
        },
        {
          ticketId: 'ticket-with-events',
          cycle: 2,
          notifiedAt: new Date('2025-01-01T08:00:00.002Z'),
        },
      ],
    };

    const response = mapTicketToResponse(ticket);

    expect(response.overdueCycle).toBe(2);
    expect(response.escalations).toEqual([
      {
        ticketId: 'ticket-with-events',
        cycle: 1,
        escalatedAt: '2025-01-01T04:00:00.001Z',
        notifiedAt: '2025-01-01T04:00:00.002Z',
      },
      {
        ticketId: 'ticket-with-events',
        cycle: 2,
        escalatedAt: '2025-01-01T08:00:00.001Z',
        notifiedAt: '2025-01-01T08:00:00.002Z',
      },
    ]);
    expect(response.supervisorNotifications).toEqual([
      {
        ticketId: 'ticket-with-events',
        cycle: 1,
        notifiedAt: '2025-01-01T04:00:00.002Z',
      },
      {
        ticketId: 'ticket-with-events',
        cycle: 2,
        notifiedAt: '2025-01-01T08:00:00.002Z',
      },
    ]);
  });

  it('returns a standard error envelope for a missing history resource', async () => {
    const { client } = createTestContext();

    const response = await client.get('/tickets/missing-ticket/history');

    expectStandardError(response, 404, 'TICKET_NOT_FOUND');
  });
});
