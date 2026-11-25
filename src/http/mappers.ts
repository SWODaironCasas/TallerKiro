import type {
  EscalationRecord,
  StateHistoryEntry,
  SupervisorNotification,
  Ticket,
} from '../domain/index.js';

export interface HttpEscalation {
  ticketId: string;
  cycle: number;
  escalatedAt: string;
  notifiedAt: string;
}

export interface HttpSupervisorNotification {
  ticketId: string;
  cycle: number;
  notifiedAt: string;
}

export interface HttpStateHistoryEntry {
  sequence: number;
  ticketId: string;
  from: StateHistoryEntry['from'];
  to: StateHistoryEntry['to'];
  changedAt: string;
  actorId: string;
}

export interface HttpTicket {
  id: string;
  title: string;
  description: string;
  category: Ticket['category'];
  priority: Ticket['priority'];
  requester: string;
  responsibleId: string | null;
  status: Ticket['status'];
  createdAt: string;
  updatedAt: string;
  dueAt: string;
  resolutionNote: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  overdue: boolean;
  overdueCycle: number;
  escalations: HttpEscalation[];
  supervisorNotifications: HttpSupervisorNotification[];
}

function toIsoUtc(value: Date): string {
  return value.toISOString();
}

function toNullableIsoUtc(value: Date | null | undefined): string | null {
  return value === null || value === undefined ? null : toIsoUtc(value);
}

export function mapEscalationToResponse(
  escalation: EscalationRecord,
): HttpEscalation {
  return {
    ticketId: escalation.ticketId,
    cycle: escalation.cycle,
    escalatedAt: toIsoUtc(escalation.escalatedAt),
    notifiedAt: toIsoUtc(escalation.notifiedAt),
  };
}

export function mapSupervisorNotificationToResponse(
  notification: SupervisorNotification,
): HttpSupervisorNotification {
  return {
    ticketId: notification.ticketId,
    cycle: notification.cycle,
    notifiedAt: toIsoUtc(notification.notifiedAt),
  };
}

export function mapHistoryEntryToResponse(
  entry: StateHistoryEntry,
): HttpStateHistoryEntry {
  return {
    sequence: entry.sequence,
    ticketId: entry.ticketId,
    from: entry.from,
    to: entry.to,
    changedAt: toIsoUtc(entry.changedAt),
    actorId: entry.actorId,
  };
}

export function mapTicketToResponse(ticket: Ticket): HttpTicket {
  return {
    id: ticket.id,
    title: ticket.title,
    description: ticket.description,
    category: ticket.category,
    priority: ticket.priority,
    requester: ticket.requester,
    responsibleId: ticket.responsibleId ?? null,
    status: ticket.status,
    createdAt: toIsoUtc(ticket.createdAt),
    updatedAt: toIsoUtc(ticket.updatedAt),
    dueAt: toIsoUtc(ticket.dueAt),
    resolutionNote: ticket.resolutionNote ?? null,
    resolvedAt: toNullableIsoUtc(ticket.resolvedAt),
    closedAt: toNullableIsoUtc(ticket.closedAt),
    overdue: ticket.overdue,
    overdueCycle: ticket.overdueCycle,
    escalations: ticket.escalations.map(mapEscalationToResponse),
    supervisorNotifications: ticket.supervisorNotifications.map(
      mapSupervisorNotificationToResponse,
    ),
  };
}

export const mapTicket = mapTicketToResponse;
export const mapHistory = mapHistoryEntryToResponse;
export const mapEscalation = mapEscalationToResponse;
export const mapSupervisorNotification = mapSupervisorNotificationToResponse;
