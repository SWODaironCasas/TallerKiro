import { describe, expect, it } from 'vitest';
import { createApp, type AppDependencies } from '../app.js';
import {
  DEFAULT_AGENT_RECORDS,
  InMemoryAgentDirectory,
  InMemorySupervisorNotifier,
  InMemoryTicketStore,
} from '../infrastructure/index.js';
import { FixedClock, requestAgainstApp } from '../test-utils/index.js';

const CREATED_AT = new Date('2025-01-02T03:04:05.006Z');
const OPAQUE_AGENT_ID = 'queue/team-42';

class TestIdGenerator {
  private sequence = 0;

  next(): string {
    this.sequence += 1;
    return `ticket-${this.sequence}`;
  }
}

interface TestContext {
  app: ReturnType<typeof createApp>;
  dependencies: AppDependencies;
}

function createTestContext(): TestContext {
  const dependencies: AppDependencies = {
    store: new InMemoryTicketStore(),
    clock: new FixedClock(CREATED_AT),
    idGenerator: new TestIdGenerator(),
    agentDirectory: new InMemoryAgentDirectory([
      ...DEFAULT_AGENT_RECORDS,
      { id: OPAQUE_AGENT_ID, role: 'AGENT', active: true },
    ]),
    supervisorNotifier: new InMemorySupervisorNotifier(),
  };

  return { app: createApp(dependencies), dependencies };
}

async function createTicket(application: TestContext['app']): Promise<string> {
  const response = await requestAgainstApp(application).post('/tickets').send({
    title: 'VPN access failure',
    description: 'The user cannot connect from the office.',
    category: 'ACCESOS',
    priority: 'ALTA',
    requester: 'user-123',
  });

  expect(response.status).toBe(201);
  return response.body.id as string;
}

describe('PATCH /tickets/:id/assignment', () => {
  it('assigns an opaque active responsibleId and transitions NUEVO to ASIGNADO', async () => {
    const { app } = createTestContext();
    const ticketId = await createTicket(app);

    const response = await requestAgainstApp(app)
      .patch(`/tickets/${ticketId}/assignment`)
      .set('X-Actor-Id', ' supervisor-1 ')
      .send({ responsibleId: ` ${OPAQUE_AGENT_ID} ` });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: ticketId,
      responsibleId: OPAQUE_AGENT_ID,
      status: 'ASIGNADO',
    });
  });

  it.each([
    {
      name: 'returns ACTOR_REQUIRED when the actor is absent',
      configure: (request: ReturnType<typeof requestAgainstApp>) => request,
      expectedCode: 'ACTOR_REQUIRED',
    },
    {
      name: 'returns ACTOR_UNKNOWN for an unknown actor',
      configure: (request: ReturnType<typeof requestAgainstApp>) =>
        request.set('X-Actor-Id', 'actor-does-not-exist'),
      expectedCode: 'ACTOR_UNKNOWN',
    },
  ])('$name', async ({ configure, expectedCode }) => {
    const { app } = createTestContext();
    const ticketId = await createTicket(app);

    const response = await configure(
      requestAgainstApp(app)
        .patch(`/tickets/${ticketId}/assignment`)
        .send({ responsibleId: 'agent-1' }),
    );

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: expect.objectContaining({ code: expectedCode }),
    });
    expect(response.body.error).not.toHaveProperty('stack');
  });

  it.each([
    {
      name: 'rejects an inactive agent',
      responsibleId: 'agent-inactive',
    },
    {
      name: 'rejects an unknown agent',
      responsibleId: 'agent-does-not-exist',
    },
  ])('$name with AGENT_UNAVAILABLE', async ({ responsibleId }) => {
    const { app } = createTestContext();
    const ticketId = await createTicket(app);

    const response = await requestAgainstApp(app)
      .patch(`/tickets/${ticketId}/assignment`)
      .set('X-Actor-Id', 'supervisor-1')
      .send({ responsibleId });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: {
        code: 'AGENT_UNAVAILABLE',
        message: 'Agent is unavailable',
      },
    });
  });

  it.each([
    { name: 'omits responsibleId', body: {} },
    { name: 'uses an empty responsibleId', body: { responsibleId: '  ' } },
    { name: 'uses a non-string responsibleId', body: { responsibleId: 123 } },
    { name: 'uses a null responsibleId', body: { responsibleId: null } },
  ])('$name with INVALID_REQUEST', async ({ body }) => {
    const { app } = createTestContext();
    const ticketId = await createTicket(app);

    const response = await requestAgainstApp(app)
      .patch(`/tickets/${ticketId}/assignment`)
      .set('X-Actor-Id', 'supervisor-1')
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: expect.objectContaining({ code: 'INVALID_REQUEST' }),
    });
  });

  it('preserves the operational state and history when reassigning', async () => {
    const { app } = createTestContext();
    const ticketId = await createTicket(app);
    const client = requestAgainstApp(app);

    const firstAssignment = await client
      .patch(`/tickets/${ticketId}/assignment`)
      .set('X-Actor-Id', 'supervisor-1')
      .send({ responsibleId: 'agent-1' });
    expect(firstAssignment.status).toBe(200);
    expect(firstAssignment.body.status).toBe('ASIGNADO');

    const progress = await client
      .patch(`/tickets/${ticketId}/status`)
      .set('X-Actor-Id', 'agent-1')
      .send({ status: 'EN_PROGRESO' });
    expect(progress.status).toBe(200);

    const reassignment = await client
      .patch(`/tickets/${ticketId}/assignment`)
      .set('X-Actor-Id', 'supervisor-1')
      .send({ responsibleId: OPAQUE_AGENT_ID });

    expect(reassignment.status).toBe(200);
    expect(reassignment.body).toMatchObject({
      responsibleId: OPAQUE_AGENT_ID,
      status: 'EN_PROGRESO',
    });

    const history = await client.get(`/tickets/${ticketId}/history`);
    expect(history.status).toBe(200);
    expect(history.body).toEqual([
      expect.objectContaining({ from: 'NUEVO', to: 'ASIGNADO', actorId: 'supervisor-1' }),
      expect.objectContaining({ from: 'ASIGNADO', to: 'EN_PROGRESO', actorId: 'agent-1' }),
    ]);
  });
});
