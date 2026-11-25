import { describe, expect, it } from 'vitest';
import type {
  StateHistoryEntry,
  Ticket,
} from '../domain/index.js';
import { app, ROUTE_CATALOG } from '../app.js';
import {
  errorStatusCode,
  formatError,
} from './error-handler.js';
import {
  mapEscalationToResponse,
  mapHistoryEntryToResponse,
  mapSupervisorNotificationToResponse,
  mapTicketToResponse,
} from './mappers.js';
import {
  actorHeaderSchema,
  actorHeadersSchema,
  assignmentSchema,
  categoryFilterSchema,
  createTicketSchema,
  statusSchema,
  ticketFilterSchema,
} from './schemas.js';
import { requestAgainstApp } from '../test-utils/index.js';

function validCreateBody(): Record<string, unknown> {
  return {
    title: 'VPN access failure',
    description: 'The user cannot connect from the office.',
    category: 'ACCESOS',
    priority: 'ALTA',
    requester: 'user-123',
  };
}

function sampleTicket(): Ticket {
  return {
    id: 'ticket-1',
    title: 'VPN access failure',
    description: 'The user cannot connect from the office.',
    category: 'ACCESOS',
    priority: 'ALTA',
    requester: 'user-123',
    responsibleId: null,
    status: 'NUEVO',
    createdAt: new Date('2025-01-02T03:04:05.006Z'),
    updatedAt: new Date('2025-01-02T04:04:05.006Z'),
    dueAt: new Date('2025-01-02T11:04:05.006Z'),
    resolutionNote: null,
    resolvedAt: null,
    closedAt: null,
    overdue: true,
    overdueCycle: 2,
    escalations: [
      {
        ticketId: 'ticket-1',
        cycle: 2,
        escalatedAt: new Date('2025-01-02T12:00:00.000Z'),
        notifiedAt: new Date('2025-01-02T12:00:01.000Z'),
      },
    ],
    supervisorNotifications: [
      {
        ticketId: 'ticket-1',
        cycle: 2,
        notifiedAt: new Date('2025-01-02T12:00:01.000Z'),
      },
    ],
  };
}

describe('HTTP validation schemas', () => {
  it.each(['title', 'description', 'category', 'priority', 'requester'])(
    'rejects a missing required field: %s',
    (field) => {
      const body = validCreateBody();
      delete body[field];

      expect(createTicketSchema.safeParse(body).success).toBe(false);
    },
  );

  it.each(['title', 'description', 'requester'])(
    'rejects a non-string text field: %s',
    (field) => {
      const body = validCreateBody();
      body[field] = 123;

      expect(createTicketSchema.safeParse(body).success).toBe(false);
    },
  );

  it.each([
    ['category', 123],
    ['priority', 123],
  ] as const)('rejects a non-string catalog field: %s', (field, value) => {
    const body = validCreateBody();
    body[field] = value;

    expect(createTicketSchema.safeParse(body).success).toBe(false);
  });

  it.each(['title', 'description', 'requester'])(
    'rejects text that is empty after trimming: %s',
    (field) => {
      const body = validCreateBody();
      body[field] = '   \t  ';

      expect(createTicketSchema.safeParse(body).success).toBe(false);
    },
  );

  it('trims all required text fields before returning parsed data', () => {
    const result = createTicketSchema.parse({
      ...validCreateBody(),
      title: '  VPN access failure  ',
      description: '\tThe user cannot connect.  ',
      requester: '  user-123 ',
    });

    expect(result.title).toBe('VPN access failure');
    expect(result.description).toBe('The user cannot connect.');
    expect(result.requester).toBe('user-123');
  });

  it.each(['responsibleId', 'responsible', 'responsable'] as const)(
    'rejects the creation-only responsible property %s',
    (property) => {
      const body = {
        ...validCreateBody(),
        [property]: 'agent-1',
      };

      expect(createTicketSchema.safeParse(body).success).toBe(false);
    },
  );

  it('accepts a trimmed title of exactly 120 characters', () => {
    const result = createTicketSchema.safeParse({
      ...validCreateBody(),
      title: `  ${'x'.repeat(120)}  `,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toHaveLength(120);
    }
  });

  it('rejects a trimmed title of 121 characters', () => {
    const result = createTicketSchema.safeParse({
      ...validCreateBody(),
      title: `  ${'x'.repeat(121)}  `,
    });

    expect(result.success).toBe(false);
  });

  it('validates optional ticket filters and rejects invalid catalog values', () => {
    expect(
      ticketFilterSchema.parse({
        category: 'ACCESOS',
        status: 'EN_PROGRESO',
        priority: 'ALTA',
      }),
    ).toEqual({
      category: 'ACCESOS',
      status: 'EN_PROGRESO',
      priority: 'ALTA',
    });

    for (const [field, value] of [
      ['category', 'UNKNOWN'],
      ['status', 'UNKNOWN'],
      ['priority', 'UNKNOWN'],
    ] as const) {
      expect(ticketFilterSchema.safeParse({ [field]: value }).success).toBe(
        false,
      );
    }
  });

  it('validates assignment and trims its responsible identifier', () => {
    expect(assignmentSchema.parse({ responsibleId: '  agent-1  ' })).toEqual({
      responsibleId: 'agent-1',
    });
    expect(assignmentSchema.safeParse({}).success).toBe(false);
    expect(assignmentSchema.safeParse({ responsibleId: '   ' }).success).toBe(
      false,
    );
    expect(
      assignmentSchema.safeParse({ responsibleId: 123 }).success,
    ).toBe(false);
  });

  it('validates status values and the optional resolution note type', () => {
    expect(
      statusSchema.parse({ status: 'RESUELTO', resolutionNote: 'Fixed' }),
    ).toEqual({ status: 'RESUELTO', resolutionNote: 'Fixed' });
    expect(statusSchema.safeParse({}).success).toBe(false);
    expect(statusSchema.safeParse({ status: 'UNKNOWN' }).success).toBe(false);
    expect(
      statusSchema.safeParse({ status: 'NUEVO', resolutionNote: 123 }).success,
    ).toBe(false);
  });

  it('validates actor identifiers and trims header values', () => {
    expect(actorHeaderSchema.parse('  agent-1  ')).toBe('agent-1');
    expect(actorHeadersSchema.parse({ 'X-Actor-Id': '  agent-1  ' })).toEqual({
      'X-Actor-Id': 'agent-1',
    });
    expect(actorHeaderSchema.safeParse('   ').success).toBe(false);
    expect(actorHeaderSchema.safeParse(123).success).toBe(false);
    expect(actorHeadersSchema.safeParse({}).success).toBe(false);
  });

  it('validates the optional overdue category filter', () => {
    expect(categoryFilterSchema.parse({})).toEqual({});
    expect(categoryFilterSchema.parse({ category: 'ACCESOS' })).toEqual({
      category: 'ACCESOS',
    });
    expect(
      categoryFilterSchema.safeParse({ category: 'UNKNOWN' }).success,
    ).toBe(false);
    expect(categoryFilterSchema.safeParse({ category: 123 }).success).toBe(
      false,
    );
  });
});

describe('HTTP mappers and error contracts', () => {
  it('serializes ticket, history, escalation, and notification dates as UTC ISO strings', () => {
    const ticket = sampleTicket();
    const history: StateHistoryEntry = {
      sequence: 1,
      ticketId: 'ticket-1',
      from: 'NUEVO',
      to: 'ASIGNADO',
      changedAt: new Date('2025-01-02T05:06:07.008Z'),
      actorId: 'agent-1',
    };

    expect(mapTicketToResponse(ticket)).toMatchObject({
      createdAt: '2025-01-02T03:04:05.006Z',
      updatedAt: '2025-01-02T04:04:05.006Z',
      dueAt: '2025-01-02T11:04:05.006Z',
      resolvedAt: null,
      closedAt: null,
      escalations: [
        {
          escalatedAt: '2025-01-02T12:00:00.000Z',
          notifiedAt: '2025-01-02T12:00:01.000Z',
        },
      ],
      supervisorNotifications: [
        { notifiedAt: '2025-01-02T12:00:01.000Z' },
      ],
    });
    expect(mapHistoryEntryToResponse(history).changedAt).toBe(
      '2025-01-02T05:06:07.008Z',
    );
    expect(mapEscalationToResponse(ticket.escalations[0]!)).toMatchObject({
      escalatedAt: '2025-01-02T12:00:00.000Z',
      notifiedAt: '2025-01-02T12:00:01.000Z',
    });
    expect(
      mapSupervisorNotificationToResponse(ticket.supervisorNotifications[0]!)
        .notifiedAt,
    ).toBe('2025-01-02T12:00:01.000Z');
  });

  it('formats validation failures with the standard error envelope', () => {
    const result = createTicketSchema.safeParse({});
    if (result.success) {
      throw new Error('Expected validation to fail');
    }

    const body = formatError(result.error);

    expect(body).toEqual({
      error: expect.objectContaining({
        code: 'INVALID_REQUEST',
        message: 'Request validation failed',
        details: expect.any(Array),
      }),
    });
    expect(body.error).not.toHaveProperty('stack');
    expect(errorStatusCode(result.error)).toBe(400);
  });
});

describe('HTTP route catalog and method contract', () => {
  it('publishes the complete required route catalog', () => {
    expect(ROUTE_CATALOG).toEqual([
      'GET /',
      'GET /health',
      'POST /tickets',
      'GET /tickets',
      'GET /tickets/:id',
      'PATCH /tickets/:id/assignment',
      'PATCH /tickets/:id/status',
      'GET /tickets/:id/history',
      'GET /tickets/overdue',
    ]);
  });

  it('returns 405 with the Allow header for a known route and wrong method', async () => {
    const response = await requestAgainstApp(app).post('/health');

    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe('GET');
    expect(response.body).toEqual({
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Method not allowed',
      },
    });
  });
});
