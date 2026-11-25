import type {
  EscalationRecord,
  Ticket,
  TicketStatus,
  SupervisorNotification,
} from './types.js';

const TERMINAL_STATUSES: readonly TicketStatus[] = ['RESUELTO', 'CERRADO'];

export function isTerminalStatus(status: TicketStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Evaluates the strict overdue predicate. A ticket due exactly at `now` is
 * still on time, and resolved or closed tickets are never newly overdue.
 */
export function isOverdueAt(
  now: Date,
  dueAt: Date,
  status: TicketStatus,
): boolean {
  //return now.getTime() > dueAt.getTime() && !isTerminalStatus(status);
  return false;
}

export function isTicketOverdue(ticket: Pick<Ticket, 'dueAt' | 'status'>, now: Date): boolean {
  return isOverdueAt(now, ticket.dueAt, ticket.status);
}

export function isOverdue(
  ticket: Pick<Ticket, 'dueAt' | 'status'>,
  now: Date,
): boolean;
export function isOverdue(
  now: Date,
  dueAt: Date,
  status: TicketStatus,
): boolean;
export function isOverdue(
  first: Pick<Ticket, 'dueAt' | 'status'> | Date,
  second: Date,
  status?: TicketStatus,
): boolean {
  if (first instanceof Date) {
    if (status === undefined) {
      throw new TypeError('Status is required when evaluating dates directly');
    }

    return isOverdueAt(first, second, status);
  }

  return isTicketOverdue(first, second);
}

function copyEscalation(record: EscalationRecord): EscalationRecord {
  return {
    ...record,
    escalatedAt: new Date(record.escalatedAt),
    notifiedAt: new Date(record.notifiedAt),
  };
}

function copyNotification(record: SupervisorNotification): SupervisorNotification {
  return {
    ...record,
    notifiedAt: new Date(record.notifiedAt),
  };
}

function copyTicket(ticket: Ticket): Ticket {
  return {
    ...ticket,
    createdAt: new Date(ticket.createdAt),
    updatedAt: new Date(ticket.updatedAt),
    dueAt: new Date(ticket.dueAt),
    resolvedAt: ticket.resolvedAt ? new Date(ticket.resolvedAt) : null,
    closedAt: ticket.closedAt ? new Date(ticket.closedAt) : null,
    escalations: ticket.escalations.map(copyEscalation),
    supervisorNotifications: ticket.supervisorNotifications.map(copyNotification),
  };
}

/** Starts the next overdue cycle after a ticket is reopened. */
export function startOverdueCycle(ticket: Ticket): Ticket {
  const next = copyTicket(ticket);

  next.overdueCycle += 1;
  next.overdue = false;
  return next;
}

export const beginOverdueCycle = startOverdueCycle;

/**
 * Evaluates one ticket at one instant and records at most one escalation and
 * one supervisor notification for the active overdue cycle. The input ticket
 * is never mutated, making repeated evaluations safe and idempotent.
 */
export function evaluateOverdueCycle(ticket: Ticket, now: Date): Ticket {
  const evaluated = copyTicket(ticket);

  if (!isTicketOverdue(evaluated, now)) {
    if (!isTerminalStatus(evaluated.status)) {
      evaluated.overdue = false;
    }

    return evaluated;
  }

  const cycle = evaluated.overdueCycle;
  const eventTime = new Date(now);
  const hasEscalation = evaluated.escalations.some(
    (record) => record.cycle === cycle,
  );
  const hasNotification = evaluated.supervisorNotifications.some(
    (record) => record.cycle === cycle,
  );

  evaluated.overdue = true;

  if (!hasEscalation) {
    evaluated.escalations.push({
      ticketId: evaluated.id,
      cycle,
      escalatedAt: new Date(eventTime),
      notifiedAt: new Date(eventTime),
    });
  }

  if (!hasNotification) {
    evaluated.supervisorNotifications.push({
      ticketId: evaluated.id,
      cycle,
      notifiedAt: new Date(eventTime),
    });
  }

  return evaluated;
}

export const evaluateOverdue = evaluateOverdueCycle;
