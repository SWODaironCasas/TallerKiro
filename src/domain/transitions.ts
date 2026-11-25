import type { TicketStatus } from './types.js';

export type StatusTransition = readonly [TicketStatus, TicketStatus];

/** The seven forward/operational transitions in the ticket state machine. */
export const NORMAL_TRANSITIONS: readonly StatusTransition[] = [
  ['NUEVO', 'ASIGNADO'],
  ['ASIGNADO', 'EN_PROGRESO'],
  ['EN_PROGRESO', 'EN_ESPERA'],
  ['EN_ESPERA', 'EN_PROGRESO'],
  ['EN_PROGRESO', 'RESUELTO'],
  ['EN_ESPERA', 'RESUELTO'],
  ['RESUELTO', 'CERRADO'],
];

/** Reopenings start a fresh overdue cycle. */
export const REOPEN_TRANSITIONS: readonly StatusTransition[] = [
  ['RESUELTO', 'EN_PROGRESO'],
  ['CERRADO', 'EN_PROGRESO'],
];

export const ALLOWED_TRANSITIONS: readonly StatusTransition[] = [
  ...NORMAL_TRANSITIONS,
  ...REOPEN_TRANSITIONS,
];

function sameTransition(
  [from, to]: StatusTransition,
  expectedFrom: TicketStatus,
  expectedTo: TicketStatus,
): boolean {
  return from === expectedFrom && to === expectedTo;
}

/** A same-state request is valid as a no-op and is not a state transition. */
export function isNoOpTransition(
  from: TicketStatus,
  to: TicketStatus,
): boolean {
  return from === to;
}

/** Returns true only for one of the nine actual state changes. */
export function isAllowedTransition(
  from: TicketStatus,
  to: TicketStatus,
): boolean {
  if (isNoOpTransition(from, to)) {
    return false;
  }

  return ALLOWED_TRANSITIONS.some((transition) =>
    sameTransition(transition, from, to),
  );
}

export const canTransition = isAllowedTransition;

export function isReopenTransition(
  from: TicketStatus,
  to: TicketStatus,
): boolean {
  return REOPEN_TRANSITIONS.some((transition) =>
    sameTransition(transition, from, to),
  );
}

/**
 * Resolving stores the trimmed note. Empty text remains empty so application
 * validation can distinguish normalization from the required-note rule.
 */
export function normalizeResolutionNote(note: string): string {
  return note.trim();
}
