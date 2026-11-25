import type {
  EscalationRecord,
  StateHistoryEntry,
  SupervisorNotification,
  Ticket,
} from '../domain/types.js';
import type { TicketStore } from './contracts.js';

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

function copyHistoryEntry(entry: StateHistoryEntry): StateHistoryEntry {
  return {
    ...entry,
    changedAt: new Date(entry.changedAt),
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

/** In-memory ticket storage with isolated copies at every boundary. */
export class InMemoryTicketStore implements TicketStore {
  private readonly tickets = new Map<string, Ticket>();

  private readonly history = new Map<string, StateHistoryEntry[]>();

  private readonly escalations = new Map<string, EscalationRecord[]>();

  private readonly supervisorNotifications = new Map<
    string,
    SupervisorNotification[]
  >();

  get(id: string): Ticket | undefined {
    const ticket = this.tickets.get(id);
    return ticket ? copyTicket(ticket) : undefined;
  }

  list(): Ticket[] {
    return Array.from(this.tickets.values(), copyTicket);
  }

  save(ticket: Ticket): void {
    this.tickets.set(ticket.id, copyTicket(ticket));
  }

  saveHistory(entry: StateHistoryEntry): void {
    const entries = this.history.get(entry.ticketId) ?? [];
    entries.push(copyHistoryEntry(entry));
    this.history.set(entry.ticketId, entries);
  }

  listHistory(ticketId: string): StateHistoryEntry[] {
    return (this.history.get(ticketId) ?? [])
      .map(copyHistoryEntry)
      .sort((left, right) => {
        const dateDifference = left.changedAt.getTime() - right.changedAt.getTime();
        return dateDifference || left.sequence - right.sequence;
      });
  }

  saveEscalation(record: EscalationRecord): void {
    const records = this.escalations.get(record.ticketId) ?? [];
    records.push(copyEscalation(record));
    this.escalations.set(record.ticketId, records);
  }

  listEscalations(ticketId?: string): EscalationRecord[] {
    const records = ticketId
      ? this.escalations.get(ticketId) ?? []
      : Array.from(this.escalations.values()).flat();

    return records.map(copyEscalation);
  }

  saveSupervisorNotification(record: SupervisorNotification): void {
    const records = this.supervisorNotifications.get(record.ticketId) ?? [];
    records.push(copyNotification(record));
    this.supervisorNotifications.set(record.ticketId, records);
  }

  listSupervisorNotifications(ticketId?: string): SupervisorNotification[] {
    const records = ticketId
      ? this.supervisorNotifications.get(ticketId) ?? []
      : Array.from(this.supervisorNotifications.values()).flat();

    return records.map(copyNotification);
  }
}
