export type Category =
  | 'INFRAESTRUCTURA'
  | 'ACCESOS'
  | 'APLICACIONES'
  | 'INSTALACIONES';

export type Priority = 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAJA';

export type TicketStatus =
  | 'NUEVO'
  | 'ASIGNADO'
  | 'EN_PROGRESO'
  | 'EN_ESPERA'
  | 'RESUELTO'
  | 'CERRADO';

export type ActorRole = 'AGENT' | 'SUPERVISOR';

export interface EscalationRecord {
  ticketId: string;
  cycle: number;
  escalatedAt: Date;
  notifiedAt: Date;
}

export interface SupervisorNotification {
  ticketId: string;
  cycle: number;
  notifiedAt: Date;
}

export interface Ticket {
  id: string;
  title: string;
  description: string;
  category: Category;
  priority: Priority;
  requester: string;
  responsibleId: string | null;
  status: TicketStatus;
  createdAt: Date;
  updatedAt: Date;
  dueAt: Date;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  overdue: boolean;
  overdueCycle: number;
  escalations: EscalationRecord[];
  supervisorNotifications: SupervisorNotification[];
}

export interface StateHistoryEntry {
  sequence: number;
  ticketId: string;
  from: TicketStatus;
  to: TicketStatus;
  changedAt: Date;
  actorId: string;
}

export interface ActorRecord {
  id: string;
  role: ActorRole;
  active: boolean;
}
