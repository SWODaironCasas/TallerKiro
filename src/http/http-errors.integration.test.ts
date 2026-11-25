import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import {
  InMemoryAgentDirectory,
  InMemorySupervisorNotifier,
  InMemoryTicketStore,
} from '../infrastructure/index.js';
import { createIsolatedDependencies, FixedClock } from '../test-utils/index.js';

const CREATED_AT = new Date('2025-01-01T00:00:00.000Z');
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function createTestClient() {
  const clock = new FixedClock(CREATED_AT);
  let nextId = 0;
  const dependencies = createIsolatedDependencies({
    store: () => new InMemoryTicketStore(),
    clock: () => clock,
    idGenerator: () => ({ next: () => `ticket-${++nextId}` }),
    agentDirectory: () => new InMemoryAgentDirectory(),
    supervisorNotifier: () => new InMemorySupervisorNotifier(),
  });

  return { client: request(createApp(dependencies)), clock };
}

async function createTicket(client: ReturnType<typeof request>): Promise<string> {
  const response = await client.post('/tickets').send({
    title: 'VPN access failure',
    description: 'The user cannot connect from the office.',
    category: 'ACCESOS',
    priority: 'ALTA',
    requester: 'user-123',
  });

  expect(response.status).toBe(201);
  expect(response.headers['content-type']).toMatch(/json/);
  return response.body.id as string;
}

function expectJson(response: { headers: Record<string, string> }): void {
  expect(response.headers['content-type']).toMatch(/json/);
}

function expectPublicError(
  response: {
    status: number;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  },
  status: number,
  code: string,
): void {
  expect(response.status).toBe(status);
  expectJson(response);
  expect(response.body).toEqual({
    error: expect.objectContaining({
      code,
      message: expect.any(String),
    }),
  });
  expect(response.body).not.toHaveProperty('stack');
  expect(JSON.stringify(response.body)).not.toMatch(/SyntaxError|at Object\./);
}

describe('HTTP history, error, and route integration', () => {
  it('returns history in ascending change order with actor attribution', async () => {
    const { client, clock } = createTestClient();
    const ticketId = await createTicket(client);

    clock.advanceBy(1_000);
    const assignment = await client
      .patch(`/tickets/${ticketId}/assignment`)
      .set('X-Actor-Id', 'supervisor-1')
      .send({ responsibleId: 'agent-1' });
    expect(assignment.status).toBe(200);

    clock.advanceBy(1_000);
    const progress = await client
      .patch(`/tickets/${ticketId}/status`)
      .set('X-Actor-Id', 'agent-1')
      .send({ status: 'EN_PROGRESO' });
    expect(progress.status).toBe(200);

    const response = await client.get(`/tickets/${ticketId}/history`);

    expect(response.status).toBe(200);
    expectJson(response);
    expect(response.body).toHaveLength(2);
    expect(response.body).toEqual([
      expect.objectContaining({
        sequence: 1,
        from: 'NUEVO',
        to: 'ASIGNADO',
        changedAt: '2025-01-01T00:00:01.000Z',
        actorId: 'supervisor-1',
      }),
      expect.objectContaining({
        sequence: 2,
        from: 'ASIGNADO',
        to: 'EN_PROGRESO',
        changedAt: '2025-01-01T00:00:02.000Z',
        actorId: 'agent-1',
      }),
    ]);

    const changedAt = response.body.map((entry: { changedAt: string }) =>
      Date.parse(entry.changedAt),
    );
    expect(changedAt[0]).toBeLessThan(changedAt[1]);
    expect(response.body.every((entry: { changedAt: string }) => ISO_UTC.test(entry.changedAt))).toBe(true);
  });

  it('returns a standard JSON 404 when history belongs to an unknown ticket', async () => {
    const { client } = createTestClient();

    const response = await client.get('/tickets/missing-ticket/history');

    expectPublicError(response, 404, 'TICKET_NOT_FOUND');
    expect(response.body).toEqual({
      error: {
        code: 'TICKET_NOT_FOUND',
        message: 'Ticket missing-ticket not found',
      },
    });
  });

  it('requires an identifiable actor for a state-changing operation', async () => {
    const { client } = createTestClient();
    const ticketId = await createTicket(client);

    const response = await client
      .patch(`/tickets/${ticketId}/status`)
      .send({ status: 'NUEVO' });

    expectPublicError(response, 400, 'ACTOR_REQUIRED');
  });

  it('returns a standard JSON error for malformed JSON without parser internals', async () => {
    const { client } = createTestClient();

    const response = await client
      .post('/tickets')
      .set('Content-Type', 'application/json')
      .send('{"title":"unclosed"');

    expectPublicError(response, 400, 'INVALID_JSON');
    expect(response.body).toEqual({
      error: {
        code: 'INVALID_JSON',
        message: 'Malformed JSON request body',
      },
    });
  });

  it('returns 405, JSON error details, and the allowed method for a known route', async () => {
    const { client } = createTestClient();

    const response = await client.post('/health');

    expectPublicError(response, 405, 'METHOD_NOT_ALLOWED');
    expect(response.headers.allow).toBe('GET');
    expect(response.body).toEqual({
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Method not allowed',
      },
    });
  });

  it('returns a standard JSON 404 for an unknown route', async () => {
    const { client } = createTestClient();

    const response = await client.get('/route-that-does-not-exist');

    expectPublicError(response, 404, 'ROUTE_NOT_FOUND');
    expect(response.body).toEqual({
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: 'Route not found',
      },
    });
  });

  it('keeps successful and error responses JSON representations', async () => {
    const { client } = createTestClient();

    const success = await client.get('/tickets');
    expect(success.status).toBe(200);
    expectJson(success);
    expect(success.body).toEqual([]);

    const error = await client.get('/tickets/unknown');
    expectPublicError(error, 404, 'TICKET_NOT_FOUND');
  });
});
