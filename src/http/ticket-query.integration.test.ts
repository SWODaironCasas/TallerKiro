import { describe, expect, it } from 'vitest';
import { createApp, type AppDependencies } from '../app.js';
import {
  InMemoryAgentDirectory,
  InMemorySupervisorNotifier,
  InMemoryTicketStore,
  type IdGenerator,
} from '../infrastructure/index.js';
import { FixedClock, requestAgainstApp } from '../test-utils/index.js';

interface TicketResponse {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  requester: string;
  responsibleId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  dueAt: string;
  resolutionNote: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  overdue: boolean;
  overdueCycle: number;
  escalations: unknown[];
  supervisorNotifications: unknown[];
}

type ApiClient = ReturnType<typeof requestAgainstApp>;

type TicketSeed = Pick<TicketResponse, 'category' | 'priority'> & {
  title: string;
};

interface QueryScenario {
  client: ApiClient;
  tickets: {
    infrastructureNew: TicketResponse;
    accessAssigned: TicketResponse;
    applicationsInProgress: TicketResponse;
    accessInProgress: TicketResponse;
    facilitiesNew: TicketResponse;
  };
}

const BASE_TIME = new Date('2025-01-01T00:00:00.000Z');

function createQueryApp(): ApiClient {
  let nextId = 0;
  const idGenerator: IdGenerator = {
    next: () => `ticket-${++nextId}`,
  };
  const dependencies: AppDependencies = {
    store: new InMemoryTicketStore(),
    clock: new FixedClock(BASE_TIME),
    idGenerator,
    agentDirectory: new InMemoryAgentDirectory(),
    supervisorNotifier: new InMemorySupervisorNotifier(),
  };

  return requestAgainstApp(createApp(dependencies));
}

async function createTicket(
  client: ApiClient,
  seed: TicketSeed,
): Promise<TicketResponse> {
  const response = await client.post('/tickets').send({
    ...seed,
    description: `${seed.title} description`,
    requester: `${seed.title}-requester`,
  });

  expect(response.status).toBe(201);
  expect(response.headers['content-type']).toMatch(/json/);
  return response.body as TicketResponse;
}

async function seedQueryScenario(): Promise<QueryScenario> {
  const client = createQueryApp();
  const infrastructureNew = await createTicket(client, {
    title: 'Router outage',
    category: 'INFRAESTRUCTURA',
    priority: 'CRITICA',
  });
  const accessAssigned = await createTicket(client, {
    title: 'VPN access request',
    category: 'ACCESOS',
    priority: 'ALTA',
  });
  const applicationsInProgress = await createTicket(client, {
    title: 'Billing application error',
    category: 'APLICACIONES',
    priority: 'MEDIA',
  });
  const accessInProgress = await createTicket(client, {
    title: 'Directory access error',
    category: 'ACCESOS',
    priority: 'ALTA',
  });
  const facilitiesNew = await createTicket(client, {
    title: 'Office light replacement',
    category: 'INSTALACIONES',
    priority: 'BAJA',
  });

  const assignmentResponses = await Promise.all([
    client
      .patch(`/tickets/${accessAssigned.id}/assignment`)
      .set('X-Actor-Id', 'agent-1')
      .send({ responsibleId: 'agent-1' }),
    client
      .patch(`/tickets/${applicationsInProgress.id}/assignment`)
      .set('X-Actor-Id', 'agent-1')
      .send({ responsibleId: 'agent-1' }),
    client
      .patch(`/tickets/${accessInProgress.id}/assignment`)
      .set('X-Actor-Id', 'agent-1')
      .send({ responsibleId: 'agent-1' }),
  ]);
  for (const response of assignmentResponses) {
    expect(response.status).toBe(200);
  }

  const statusResponses = await Promise.all([
    client
      .patch(`/tickets/${applicationsInProgress.id}/status`)
      .set('X-Actor-Id', 'agent-1')
      .send({ status: 'EN_PROGRESO' }),
    client
      .patch(`/tickets/${accessInProgress.id}/status`)
      .set('X-Actor-Id', 'agent-1')
      .send({ status: 'EN_PROGRESO' }),
  ]);
  for (const response of statusResponses) {
    expect(response.status).toBe(200);
  }

  return {
    client,
    tickets: {
      infrastructureNew,
      accessAssigned,
      applicationsInProgress,
      accessInProgress,
      facilitiesNew,
    },
  };
}

function expectJson(response: { headers: Record<string, string> }): void {
  expect(response.headers['content-type']).toMatch(/json/);
}

function ticketIds(body: TicketResponse[]): string[] {
  return body.map((ticket) => ticket.id);
}

describe('GET /tickets query integration', () => {
  it('returns an empty JSON collection when no tickets exist', async () => {
    const client = createQueryApp();

    const response = await client.get('/tickets');

    expect(response.status).toBe(200);
    expectJson(response);
    expect(response.body).toEqual([]);
  });

  it('returns all existing tickets as a JSON collection with coherent fields', async () => {
    const { client, tickets } = await seedQueryScenario();

    const response = await client.get('/tickets');

    expect(response.status).toBe(200);
    expectJson(response);
    expect(ticketIds(response.body as TicketResponse[])).toEqual([
      tickets.infrastructureNew.id,
      tickets.accessAssigned.id,
      tickets.applicationsInProgress.id,
      tickets.accessInProgress.id,
      tickets.facilitiesNew.id,
    ]);
    expect(response.body[0]).toEqual(
      expect.objectContaining({
        id: tickets.infrastructureNew.id,
        category: 'INFRAESTRUCTURA',
        priority: 'CRITICA',
        status: 'NUEVO',
        responsibleId: null,
      }),
    );
    expect(response.body[0]).toEqual(
      expect.objectContaining({
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
        updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
        dueAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      }),
    );
  });

  it('returns an existing ticket by id with HTTP 200 and JSON resource data', async () => {
    const { client, tickets } = await seedQueryScenario();

    const response = await client.get(`/tickets/${tickets.accessAssigned.id}`);

    expect(response.status).toBe(200);
    expectJson(response);
    expect(response.body).toEqual(
      expect.objectContaining({
        id: tickets.accessAssigned.id,
        title: 'VPN access request',
        category: 'ACCESOS',
        priority: 'ALTA',
        status: 'ASIGNADO',
        responsibleId: 'agent-1',
      }),
    );
  });

  it('returns a standard JSON 404 error for an unknown ticket id', async () => {
    const client = createQueryApp();

    const response = await client.get('/tickets/does-not-exist');

    expect(response.status).toBe(404);
    expectJson(response);
    expect(response.body).toEqual({
      error: {
        code: 'TICKET_NOT_FOUND',
        message: 'Ticket does-not-exist not found',
      },
    });
  });

  it.each([
    ['category', 'ACCESOS', ['ticket-2', 'ticket-4']],
    ['status', 'NUEVO', ['ticket-1', 'ticket-5']],
    ['priority', 'ALTA', ['ticket-2', 'ticket-4']],
  ] as const)(
    'applies the individual %s filter',
    async (field, value, expectedIds) => {
      const { client } = await seedQueryScenario();

      const response = await client.get('/tickets').query({ [field]: value });

      expect(response.status).toBe(200);
      expectJson(response);
      expect(ticketIds(response.body as TicketResponse[])).toEqual(expectedIds);
    },
  );

  it('combines category, status, and priority filters with AND semantics', async () => {
    const { client } = await seedQueryScenario();

    const response = await client.get('/tickets').query({
      category: 'ACCESOS',
      status: 'ASIGNADO',
      priority: 'ALTA',
    });

    expect(response.status).toBe(200);
    expectJson(response);
    expect(ticketIds(response.body as TicketResponse[])).toEqual(['ticket-2']);
  });

  it('returns an empty JSON collection when valid filters match no tickets', async () => {
    const { client } = await seedQueryScenario();

    const response = await client.get('/tickets').query({
      category: 'INFRAESTRUCTURA',
      status: 'ASIGNADO',
      priority: 'BAJA',
    });

    expect(response.status).toBe(200);
    expectJson(response);
    expect(response.body).toEqual([]);
  });

  it.each([
    ['category', 'UNKNOWN'],
    ['status', 'UNKNOWN'],
    ['priority', 'UNKNOWN'],
  ] as const)('rejects an invalid %s filter with a standard JSON 400 error', async (field, value) => {
    const client = createQueryApp();

    const response = await client.get('/tickets').query({ [field]: value });

    expect(response.status).toBe(400);
    expectJson(response);
    expect(response.body).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'INVALID_REQUEST',
          message: 'Request validation failed',
        }),
      }),
    );
  });
});
