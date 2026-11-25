import {
  ActorRequiredError,
  ActorUnknownError,
  AgentUnavailableError,
  calculateDueAt,
  evaluateOverdueCycle,
  InvalidRequestError,
  InvalidTransitionError,
  isAllowedTransition,
  isNoOpTransition,
  isReopenTransition,
  isTicketOverdue,
  normalizeResolutionNote,
  startOverdueCycle,
  SupervisorRequiredError,
  TicketNotFoundError,
} from '../domain/index.js';
import type {
  Category,
  Priority,
  StateHistoryEntry,
  Ticket,
  TicketStatus,
} from '../domain/index.js';
import type {
  AgentDirectory,
  Clock,
  IdGenerator,
  SupervisorNotifier,
  TicketStore,
} from '../infrastructure/index.js';
import {
  InMemoryAgentDirectory,
  InMemorySupervisorNotifier,
} from '../infrastructure/index.js';

export type CreateTicketInput = Pick<
  Ticket,
  'title' | 'description' | 'category' | 'priority' | 'requester'
>;

export interface TicketFilters {
  category?: Category;
  status?: TicketStatus;
  priority?: Priority;
}

export interface TicketServiceDependencies {
  agentDirectory?: AgentDirectory;
  clock: Clock;
  idGenerator: IdGenerator;
  store: TicketStore;
  supervisorNotifier?: SupervisorNotifier;
}

/** Application service for creating and reading tickets. */
export class TicketService {
  private readonly agentDirectory: AgentDirectory;

  private readonly clock: Clock;

  private readonly idGenerator: IdGenerator;

  private readonly store: TicketStore;

  private readonly supervisorNotifier: SupervisorNotifier;

  constructor(dependencies: TicketServiceDependencies);
  constructor(
    store: TicketStore,
    clock: Clock,
    idGenerator: IdGenerator,
    supervisorNotifier?: SupervisorNotifier,
  );
  constructor(
    dependenciesOrStore: TicketServiceDependencies | TicketStore,
    clock?: Clock,
    idGenerator?: IdGenerator,
    supervisorNotifier?: SupervisorNotifier,
  ) {
    if (clock !== undefined && idGenerator !== undefined) {
      this.agentDirectory = new InMemoryAgentDirectory();
      this.store = dependenciesOrStore as TicketStore;
      this.clock = clock;
      this.idGenerator = idGenerator;
      this.supervisorNotifier =
        supervisorNotifier ?? new InMemorySupervisorNotifier();
      return;
    }

    const dependencies = dependenciesOrStore as TicketServiceDependencies;
    this.agentDirectory =
      dependencies.agentDirectory ?? new InMemoryAgentDirectory();
    this.store = dependencies.store;
    this.clock = dependencies.clock;
    this.idGenerator = dependencies.idGenerator;
    this.supervisorNotifier =
      dependencies.supervisorNotifier ?? new InMemorySupervisorNotifier();
  }

  create(input: CreateTicketInput): Ticket {
    const title = input.title.trim();
    const description = input.description.trim();
    const requester = input.requester.trim();
    const createdAt = this.clock.now();

    const ticket: Ticket = {
      id: this.idGenerator.next(),
      title,
      description,
      category: input.category,
      priority: input.priority,
      requester,
      responsibleId: null,
      status: 'NUEVO',
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt),
      dueAt: calculateDueAt(createdAt, input.priority),
      resolutionNote: null,
      resolvedAt: null,
      closedAt: null,
      overdue: false,
      overdueCycle: 1,
      escalations: [],
      supervisorNotifications: [],
    };

    this.store.save(ticket);
    return this.store.get(ticket.id) as Ticket;
  }

  assign(id: string, responsibleId: string, actorId: string): Ticket {
    const actor = this.resolveActor(actorId);
    const ticket = this.store.get(id);
    if (ticket === undefined) {
      throw new TicketNotFoundError(id);
    }

    if (!this.agentDirectory.isActiveAgent(responsibleId)) {
      throw new AgentUnavailableError();
    }

    const now = this.clock.now();
    const evaluatedTicket = this.evaluateAndSave(ticket, now);
    const previousStatus = evaluatedTicket.status;
    const changesStatus = previousStatus === 'NUEVO';
    const assignedTicket: Ticket = {
      ...evaluatedTicket,
      responsibleId,
      status: changesStatus ? 'ASIGNADO' : previousStatus,
      updatedAt: new Date(now),
    };

    this.store.save(assignedTicket);

    if (changesStatus) {
      this.store.saveHistory({
        sequence: this.nextHistorySequence(id),
        ticketId: id,
        from: previousStatus,
        to: 'ASIGNADO',
        changedAt: new Date(now),
        actorId: actor.id,
      });
    }

    return this.store.get(id) as Ticket;
  }

  changeStatus(
    id: string,
    target: TicketStatus,
    resolutionNote: string | undefined,
    actorId: string,
  ): Ticket {
    const actor = this.resolveActor(actorId);
    const ticket = this.store.get(id);
    if (ticket === undefined) {
      throw new TicketNotFoundError(id);
    }

    if (isNoOpTransition(ticket.status, target)) {
      return this.evaluateAndSave(ticket, this.clock.now());
    }

    if (!isAllowedTransition(ticket.status, target)) {
      throw new InvalidTransitionError();
    }

    let normalizedResolutionNote: string | undefined;
    if (target === 'RESUELTO') {
      if (typeof resolutionNote !== 'string') {
        throw new InvalidRequestError('Resolution note is required');
      }

      normalizedResolutionNote = normalizeResolutionNote(resolutionNote);
      if (normalizedResolutionNote === '') {
        throw new InvalidRequestError('Resolution note is required');
      }
    }

    if (target === 'CERRADO' && ticket.status !== 'RESUELTO') {
      throw new InvalidTransitionError();
    }

    const now = this.clock.now();
    const evaluatedTicket = this.evaluateAndSave(ticket, now);
    const reopened = isReopenTransition(evaluatedTicket.status, target);
    let updatedTicket = reopened
      ? startOverdueCycle(evaluatedTicket)
      : evaluatedTicket;

    updatedTicket = {
      ...updatedTicket,
      status: target,
      updatedAt: new Date(now),
    };

    if (target === 'RESUELTO') {
      updatedTicket = {
        ...updatedTicket,
        resolutionNote: normalizedResolutionNote as string,
        resolvedAt: new Date(now),
        closedAt: null,
      };
    } else if (target === 'CERRADO') {
      updatedTicket = {
        ...updatedTicket,
        closedAt: new Date(now),
      };
    } else if (reopened) {
      updatedTicket = {
        ...updatedTicket,
        resolutionNote: null,
        resolvedAt: null,
        closedAt: null,
      };
    }

    this.store.save(updatedTicket);
    this.store.saveHistory({
      sequence: this.nextHistorySequence(id),
      ticketId: id,
      from: evaluatedTicket.status,
      to: target,
      changedAt: new Date(now),
      actorId: actor.id,
    });

    return this.store.get(id) as Ticket;
  }

  list(filters: TicketFilters = {}): Ticket[] {
    const now = this.clock.now();

    return this.store
      .list()
      .map((ticket) => this.evaluateAndSave(ticket, now))
      .filter((ticket) => this.matchesFilters(ticket, filters));
  }

  get(id: string): Ticket {
    const ticket = this.store.get(id);
    if (ticket === undefined) {
      throw new TicketNotFoundError(id);
    }

    return this.evaluateAndSave(ticket, this.clock.now());
  }

  history(id: string): StateHistoryEntry[] {
    if (this.store.get(id) === undefined) {
      throw new TicketNotFoundError(id);
    }

    return this.store.listHistory(id);
  }

  listOverdue(category?: Category, supervisorId?: string): Ticket[] {
    this.requireSupervisor(supervisorId);
    const now = this.clock.now();

    return this.store
      .list()
      .map((ticket) => this.evaluateAndSave(ticket, now))
      .filter(
        (ticket) =>
          isTicketOverdue(ticket, now) &&
          (category === undefined || ticket.category === category),
      );
  }

  /** Compatibility alias for the application design's overdue use case name. */
  overdue(category?: Category, supervisorId?: string): Ticket[] {
    return this.listOverdue(category, supervisorId);
  }

  private resolveActor(actorId: string) {
    if (typeof actorId !== 'string' || actorId.trim() === '') {
      throw new ActorRequiredError();
    }

    const actor = this.agentDirectory.find(actorId.trim());
    if (actor === undefined) {
      throw new ActorUnknownError();
    }

    return actor;
  }

  private requireSupervisor(supervisorId: string | undefined): void {
    if (typeof supervisorId !== 'string' || supervisorId.trim() === '') {
      throw new SupervisorRequiredError();
    }

    const actor = this.agentDirectory.find(supervisorId.trim());
    if (actor?.role !== 'SUPERVISOR' || !actor.active) {
      throw new SupervisorRequiredError();
    }
  }

  private nextHistorySequence(ticketId: string): number {
    const history = this.store.listHistory(ticketId);
    return history.reduce(
      (highest, entry) => Math.max(highest, entry.sequence),
      0,
    ) + 1;
  }

  private evaluateAndSave(ticket: Ticket, now: Date): Ticket {
    const evaluated = evaluateOverdueCycle(ticket, now);
    const storedEscalationCycles = new Set(
      this.store
        .listEscalations(ticket.id)
        .map((record) => record.cycle),
    );
    const storedNotificationCycles = new Set(
      this.store
        .listSupervisorNotifications(ticket.id)
        .map((record) => record.cycle),
    );
    const previousNotificationCycles = new Set(
      ticket.supervisorNotifications.map((record) => record.cycle),
    );

    this.store.save(evaluated);
    for (const escalation of evaluated.escalations) {
      if (!storedEscalationCycles.has(escalation.cycle)) {
        this.store.saveEscalation(escalation);
      }
    }
    for (const notification of evaluated.supervisorNotifications) {
      if (!storedNotificationCycles.has(notification.cycle)) {
        this.store.saveSupervisorNotification(notification);
      }
      if (
        !previousNotificationCycles.has(notification.cycle) &&
        !storedNotificationCycles.has(notification.cycle)
      ) {
        this.supervisorNotifier.notify(notification);
      }
    }

    return this.store.get(ticket.id) as Ticket;
  }

  private matchesFilters(ticket: Ticket, filters: TicketFilters): boolean {
    return (
      (filters.category === undefined || ticket.category === filters.category) &&
      (filters.status === undefined || ticket.status === filters.status) &&
      (filters.priority === undefined || ticket.priority === filters.priority)
    );
  }
}
