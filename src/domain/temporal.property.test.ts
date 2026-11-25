import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TicketStatus } from './types.js';
import { isTicketOverdue } from './temporal.js';

const TICKET_STATUSES: readonly TicketStatus[] = [
  'NUEVO',
  'ASIGNADO',
  'EN_PROGRESO',
  'EN_ESPERA',
  'RESUELTO',
  'CERRADO',
];

const statusArbitrary = fc.constantFrom(...TICKET_STATUSES);
const dueAtMillisecondsArbitrary = fc.integer({
  min: Date.parse('2020-01-01T00:00:00.000Z'),
  max: Date.parse('2030-01-01T00:00:00.000Z'),
});
const offsetMillisecondsArbitrary = fc.integer({
  min: -1_000_000,
  max: 1_000_000,
});

// Feature: ticketops-api, Property 12: El predicado de vencimiento usa tiempo estricto y estado actual.
describe('Property 12: overdue uses strict time and current status', () => {
  it('is true exactly after dueAt for non-terminal current statuses', () => {
    fc.assert(
      fc.property(
        dueAtMillisecondsArbitrary,
        offsetMillisecondsArbitrary,
        statusArbitrary,
        (dueAtMilliseconds, offsetMilliseconds, status) => {
          const dueAt = new Date(dueAtMilliseconds);
          const now = new Date(dueAtMilliseconds + offsetMilliseconds);
          const ticket = { dueAt, status };
          const expected =
            offsetMilliseconds > 0 &&
            status !== 'RESUELTO' &&
            status !== 'CERRADO';

          expect(isTicketOverdue(ticket, now)).toBe(expected);

          if (offsetMilliseconds === 0) {
            expect(isTicketOverdue(ticket, new Date(dueAt))).toBe(false);
          }

          if (status === 'RESUELTO' || status === 'CERRADO') {
            expect(
              isTicketOverdue(ticket, new Date(dueAtMilliseconds + 1)),
            ).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
