import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { InvalidTransitionError } from './errors.js';
import {
  isAllowedTransition,
  isNoOpTransition,
  type StatusTransition,
} from './transitions.js';
import type { TicketStatus } from './types.js';

const STATES: readonly TicketStatus[] = [
  'NUEVO',
  'ASIGNADO',
  'EN_PROGRESO',
  'EN_ESPERA',
  'RESUELTO',
  'CERRADO',
];

const EXPECTED_NORMAL_TRANSITIONS: readonly StatusTransition[] = [
  ['NUEVO', 'ASIGNADO'],
  ['ASIGNADO', 'EN_PROGRESO'],
  ['EN_PROGRESO', 'EN_ESPERA'],
  ['EN_ESPERA', 'EN_PROGRESO'],
  ['EN_PROGRESO', 'RESUELTO'],
  ['EN_ESPERA', 'RESUELTO'],
  ['RESUELTO', 'CERRADO'],
];

const EXPECTED_REOPEN_TRANSITIONS: readonly StatusTransition[] = [
  ['RESUELTO', 'EN_PROGRESO'],
  ['CERRADO', 'EN_PROGRESO'],
];

const ALL_STATE_PAIRS: readonly StatusTransition[] = STATES.flatMap((from) =>
  STATES.map((to) => [from, to] as const),
);

const EXPECTED_CHANGES = new Set(
  [...EXPECTED_NORMAL_TRANSITIONS, ...EXPECTED_REOPEN_TRANSITIONS].map(
    ([from, to]) => `${from}->${to}`,
  ),
);

type TicketState = {
  status: TicketStatus;
  revision: number;
};

/** Projects the current pure transition predicate onto the status operation contract. */
function attemptStatusChange(
  ticket: TicketState,
  target: TicketStatus,
): TicketState {
  if (isNoOpTransition(ticket.status, target)) {
    return ticket;
  }

  if (!isAllowedTransition(ticket.status, target)) {
    throw new InvalidTransitionError();
  }

  return {
    status: target,
    revision: ticket.revision + 1,
  };
}

describe('state transition machine property', () => {
  it('accepts exactly the allowed transitions and preserves conflicts', () => {
    const initialRevisionArbitrary = fc.nat({ max: 1_000 });

    // Feature: ticketops-api, Property 7: La máquina acepta exactamente las transiciones permitidas
    fc.assert(
      fc.property(initialRevisionArbitrary, (initialRevision) => {
        expect(ALL_STATE_PAIRS).toHaveLength(STATES.length ** 2);

        for (const [from, to] of ALL_STATE_PAIRS) {
          const ticket: TicketState = { status: from, revision: initialRevision };
          const before = { ...ticket };
          const key = `${from}->${to}`;

          if (from === to) {
            expect(isNoOpTransition(from, to)).toBe(true);
            expect(isAllowedTransition(from, to)).toBe(false);
            expect(attemptStatusChange(ticket, to)).toBe(ticket);
            expect(ticket).toEqual(before);
            continue;
          }

          expect(isNoOpTransition(from, to)).toBe(false);

          if (EXPECTED_CHANGES.has(key)) {
            expect(isAllowedTransition(from, to)).toBe(true);
            expect(attemptStatusChange(ticket, to)).toEqual({
              status: to,
              revision: before.revision + 1,
            });
          } else {
            expect(isAllowedTransition(from, to)).toBe(false);
            expect(() => attemptStatusChange(ticket, to)).toThrowError(
              InvalidTransitionError,
            );
            expect(ticket).toEqual(before);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
