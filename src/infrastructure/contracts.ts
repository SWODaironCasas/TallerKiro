import type {
  ActorRecord,
  EscalationRecord,
  StateHistoryEntry,
  SupervisorNotification,
  Ticket,
} from '../domain/types.js';

export interface Clock {
  now(): Date;
}

export interface TicketStore {
  get(id: string): Ticket | undefined;
  list(): Ticket[];
  save(ticket: Ticket): void;
  saveHistory(entry: StateHistoryEntry): void;
  listHistory(ticketId: string): StateHistoryEntry[];
  saveEscalation(record: EscalationRecord): void;
  listEscalations(ticketId?: string): EscalationRecord[];
  saveSupervisorNotification(record: SupervisorNotification): void;
  listSupervisorNotifications(ticketId?: string): SupervisorNotification[];
}

export interface AgentDirectory {
  find(actorId: string): ActorRecord | undefined;
  isActiveAgent(agentId: string): boolean;
}

export interface SupervisorNotifier {
  notify(record: SupervisorNotification): void;
}

export interface IdGenerator {
  next(): string;
}
