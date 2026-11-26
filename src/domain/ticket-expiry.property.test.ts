import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Ticket, TicketStatus } from './types.js';
import { evaluateOverdueCycle, isTicketOverdue } from './temporal.js';

const TICKET_STATUSES: readonly TicketStatus[] = [
  'NUEVO',
  'ASIGNADO',
  'EN_PROGRESO',
  'EN_ESPERA',
  'RESUELTO',
  'CERRADO',
];

const NON_TERMINAL_STATUSES: readonly TicketStatus[] = [
  'NUEVO',
  'ASIGNADO',
  'EN_PROGRESO',
  'EN_ESPERA',
];

const validTimestampArbitrary = fc.integer({
  min: Date.parse('2020-01-01T00:00:00.000Z'),
  max: Date.parse('2030-01-01T00:00:00.000Z'),
});

const statusArbitrary = fc.constantFrom(...TICKET_STATUSES);
const ticketArbitrary = fc.record({
  id: fc.string({ minLength: 1 }),
  status: statusArbitrary,
  dueAtMilliseconds: validTimestampArbitrary,
  cycle: fc.integer({ min: 1, max: 20 }),
}).map(({ id, status, dueAtMilliseconds, cycle }): Ticket => {
  const createdAt = new Date(dueAtMilliseconds - 1_000);
  const dueAt = new Date(dueAtMilliseconds);
  return {
    id,
    title: 'Property ticket',
    description: 'Property ticket description',
    category: 'APLICACIONES',
    priority: 'MEDIA',
    requester: 'requester',
    responsibleId: null,
    status,
    createdAt,
    updatedAt: new Date(createdAt),
    dueAt,
    resolutionNote: null,
    resolvedAt: null,
    closedAt: null,
    overdue: false,
    overdueCycle: cycle,
    escalations: [],
    supervisorNotifications: [],
  };
});

// Feature: ticket-expiry-supervisor-notifications, Property 1: Vencimiento estricto y exclusión de estados terminales
describe('Property 1: strict expiry and terminal-state exclusion', () => {
  it('evaluates tickets consistently before, at, and after dueAt', () => {
    fc.assert(
      fc.property(ticketArbitrary, fc.constantFrom(-1, 0, 1), (ticket, offset) => {
        const now = new Date(ticket.dueAt.getTime() + offset);
        const expectedOverdue =
          offset > 0 && NON_TERMINAL_STATUSES.includes(ticket.status);
        const evaluated = evaluateOverdueCycle(ticket, now);

        expect(isTicketOverdue(ticket, now)).toBe(expectedOverdue);
        expect(evaluated.overdue).toBe(expectedOverdue);
        expect(ticket.overdue).toBe(false);

        if (!expectedOverdue) {
          expect(evaluated.escalations).toEqual([]);
          expect(evaluated.supervisorNotifications).toEqual([]);
        } else {
          expect(evaluated.escalations).toHaveLength(1);
          expect(evaluated.supervisorNotifications).toHaveLength(1);
        }
      }),
      { numRuns: 100 },
    );
  });
});

const nonTerminalTicketArbitrary = ticketArbitrary.filter((ticket) =>
  NON_TERMINAL_STATUSES.includes(ticket.status),
);
const overdueOffsetArbitrary = fc.integer({ min: 1, max: 1_000_000 });

// Feature: ticket-expiry-supervisor-notifications, Property 2: El primer vencimiento crea un par coherente
describe('Property 2: first overdue evaluation creates a coherent pair', () => {
  it('creates one matching escalation and supervisor notification', () => {
    fc.assert(
      fc.property(
        nonTerminalTicketArbitrary,
        overdueOffsetArbitrary,
        (ticket, overdueOffset) => {
          const now = new Date(ticket.dueAt.getTime() + overdueOffset);
          const evaluated = evaluateOverdueCycle(ticket, now);
          const escalation = evaluated.escalations[0];
          const notification = evaluated.supervisorNotifications[0];

          expect(evaluated.overdue).toBe(true);
          expect(evaluated.escalations).toHaveLength(1);
          expect(evaluated.supervisorNotifications).toHaveLength(1);
          expect(escalation).toBeDefined();
          expect(notification).toBeDefined();
          expect(escalation?.ticketId).toBe(ticket.id);
          expect(notification?.ticketId).toBe(ticket.id);
          expect(escalation?.cycle).toBe(ticket.overdueCycle);
          expect(notification?.cycle).toBe(ticket.overdueCycle);
          expect(escalation?.notifiedAt).toEqual(notification?.notifiedAt);
          expect(escalation?.notifiedAt).toEqual(now);
          expect(escalation?.escalatedAt).toEqual(now);
        },
      ),
      { numRuns: 100 },
    );
  });
});
