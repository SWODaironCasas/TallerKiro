import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import {
  InMemoryAgentDirectory,
  InMemorySupervisorNotifier,
  InMemoryTicketStore,
} from '../infrastructure/index.js';
import {
  createIsolatedDependencies,
  FixedClock,
} from '../test-utils/index.js';

const CREATED_AT = new Date('2025-01-01T00:00:00.000Z');
const VALID_TICKET = {
  title: '  No funciona el acceso VPN  ',
  description: '  El usuario no puede conectarse desde la oficina.  ',
  category: 'ACCESOS',
  priority: 'ALTA',
  requester: '  user-123  ',
} as const;

type CreateTicketBody = Record<string, unknown>;
type RequiredField = keyof typeof VALID_TICKET;

function createTestClient() {
  const dependencies = createIsolatedDependencies({
    store: () => new InMemoryTicketStore(),
    clock: () => new FixedClock(CREATED_AT),
    idGenerator: () => ({ next: () => 'ticket-1' }),
    agentDirectory: () => new InMemoryAgentDirectory(),
    supervisorNotifier: () => new InMemorySupervisorNotifier(),
  });

  return request(createApp(dependencies));
}

async function postTicket(body: CreateTicketBody) {
  return createTestClient().post('/tickets').send(body);
}

function expectStandardInvalidRequest(response: {
  status: number;
  body: Record<string, unknown>;
}): void {
  expect(response.status).toBe(400);
  expect(response.body).toEqual({
    error: expect.objectContaining({
      code: 'INVALID_REQUEST',
      message: expect.any(String),
    }),
  });
  expect(response.body).not.toHaveProperty('stack');
}

describe('POST /tickets integration', () => {
  it('creates a ticket with required fields, null responsibility, and UTC ISO dates', async () => {
    const response = await postTicket(VALID_TICKET);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      id: 'ticket-1',
      title: 'No funciona el acceso VPN',
      description: 'El usuario no puede conectarse desde la oficina.',
      category: 'ACCESOS',
      priority: 'ALTA',
      requester: 'user-123',
      responsibleId: null,
      status: 'NUEVO',
      resolutionNote: null,
      resolvedAt: null,
      closedAt: null,
      overdue: false,
      overdueCycle: 1,
      escalations: [],
      supervisorNotifications: [],
    });

    expect(response.body.createdAt).toBe('2025-01-01T00:00:00.000Z');
    expect(response.body.updatedAt).toBe('2025-01-01T00:00:00.000Z');
    expect(response.body.dueAt).toBe('2025-01-01T08:00:00.000Z');

    for (const field of ['createdAt', 'updatedAt', 'dueAt']) {
      expect(response.body[field]).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    }
  });

  it.each([
    'title',
    'description',
    'category',
    'priority',
    'requester',
  ] as RequiredField[])('rejects a request missing %s', async (field) => {
    const body: CreateTicketBody = { ...VALID_TICKET };
    delete body[field];

    expectStandardInvalidRequest(await postTicket(body));
  });

  it.each([
    ['title', 123],
    ['description', false],
    ['category', { value: 'ACCESOS' }],
    ['priority', ['ALTA']],
    ['requester', null],
  ] as Array<[RequiredField, unknown]>)
    ('rejects %s with an invalid type', async (field, value) => {
      expectStandardInvalidRequest(
        await postTicket({ ...VALID_TICKET, [field]: value }),
      );
    });

  it.each(['title', 'description', 'requester'] as Array<
    'title' | 'description' | 'requester'
  >)('rejects %s when it is empty after trimming', async (field) => {
    expectStandardInvalidRequest(
      await postTicket({ ...VALID_TICKET, [field]: ' \t\n ' }),
    );
  });

  it('accepts a title of 120 characters after trimming', async () => {
    const title = `  ${'t'.repeat(120)}  `;
    const response = await postTicket({ ...VALID_TICKET, title });

    expect(response.status).toBe(201);
    expect(response.body.title).toBe('t'.repeat(120));
  });

  it('rejects a title of 121 characters after trimming', async () => {
    const title = `  ${'t'.repeat(121)}  `;

    expectStandardInvalidRequest(
      await postTicket({ ...VALID_TICKET, title }),
    );
  });

  it.each(['responsibleId', 'responsible', 'responsable'])(
    'rejects %s during creation',
    async (field) => {
      expectStandardInvalidRequest(
        await postTicket({ ...VALID_TICKET, [field]: 'agent-1' }),
      );
    },
  );
});
