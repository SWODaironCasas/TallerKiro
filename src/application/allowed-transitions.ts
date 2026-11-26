import {
  isAllowedTransition,
  isReopenTransition,
  type Ticket,
  type TicketStatus,
} from '../domain/index.js';

export type AllowedAction =
  | 'ASSIGN'
  | 'START'
  | 'RESUME'
  | 'WAIT'
  | 'RESOLVE'
  | 'CLOSE'
  | 'REOPEN';

export type AllowedInput =
  | 'RESPONSIBLE_ID'
  | 'NONE'
  | 'RESOLUTION_NOTE';

export interface AllowedTransitionDescriptor {
  action: AllowedAction;
  method: 'PATCH';
  href: string;
  targetStatus: TicketStatus | null;
  input: AllowedInput;
}

const STATUS_TARGETS: readonly TicketStatus[] = [
  'EN_PROGRESO',
  'EN_ESPERA',
  'RESUELTO',
  'CERRADO',
];

const ACTION_ORDER: readonly AllowedAction[] = [
  'ASSIGN',
  'START',
  'RESUME',
  'WAIT',
  'RESOLVE',
  'CLOSE',
  'REOPEN',
];

function statusAction(
  from: TicketStatus,
  target: TicketStatus,
): Exclude<AllowedAction, 'ASSIGN'> | null {
  if (isReopenTransition(from, target)) {
    return 'REOPEN';
  }

  if (from === 'ASIGNADO' && target === 'EN_PROGRESO') {
    return 'START';
  }

  if (from === 'EN_ESPERA' && target === 'EN_PROGRESO') {
    return 'RESUME';
  }

  if (target === 'EN_ESPERA') {
    return 'WAIT';
  }

  if (target === 'RESUELTO') {
    return 'RESOLVE';
  }

  if (target === 'CERRADO') {
    return 'CLOSE';
  }

  return null;
}

function inputForAction(
  action: Exclude<AllowedAction, 'ASSIGN'>,
): Exclude<AllowedInput, 'RESPONSIBLE_ID'> {
  return action === 'RESOLVE' ? 'RESOLUTION_NOTE' : 'NONE';
}

function hrefFor(ticketId: string, suffix: 'assignment' | 'status'): string {
  return `/tickets/${encodeURIComponent(ticketId)}/${suffix}`;
}

/**
 * Calculates the operations currently exposed by the TicketService.
 * Assignment remains available for every status because the service supports
 * both first assignment and reassignment without a separate capability rule.
 */
export function calculateAllowedTransitions(
  ticket: Pick<Ticket, 'id' | 'status'>,
): AllowedTransitionDescriptor[] {
  const descriptors: AllowedTransitionDescriptor[] = [
    {
      action: 'ASSIGN',
      method: 'PATCH',
      href: hrefFor(ticket.id, 'assignment'),
      targetStatus: null,
      input: 'RESPONSIBLE_ID',
    },
  ];

  for (const target of STATUS_TARGETS) {
    if (!isAllowedTransition(ticket.status, target)) {
      continue;
    }

    const action = statusAction(ticket.status, target);
    if (action === null) {
      continue;
    }

    descriptors.push({
      action,
      method: 'PATCH',
      href: hrefFor(ticket.id, 'status'),
      targetStatus: target,
      input: inputForAction(action),
    });
  }

  return descriptors.sort(
    (left, right) =>
      ACTION_ORDER.indexOf(left.action) - ACTION_ORDER.indexOf(right.action),
  );
}

export const getAllowedTransitions = calculateAllowedTransitions;
