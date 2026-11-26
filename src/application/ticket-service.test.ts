import { describe, expect, it } from 'vitest';
import type { Category, Priority } from '../domain/types.js';
import type { SupervisorNotifier } from '../infrastructure/contracts.js';
import {
  ActorRequiredError,
  ActorUnknownError,
  AgentUnavailableError,
  InvalidRequestError,
  InvalidTransitionError,
  SupervisorRequiredError,
  TicketNotFoundError,
} from '../domain/errors.js';
import { InMemoryAgentDirectory } from '../infrastructure/in-memory-agent-directory.js';
import { InMemorySupervisorNotifier } from '../infrastructure/in-memory-supervisor-notifier.js';
import { InMemoryTicketStore } from '../infrastructure/in-memory-ticket-store.js';
import { FixedClock } from '../test-utils/index.js';
import { TicketService } from './ticket-service.js';

class TestIdGenerator {
  private sequence = 0;

  next(): string {
    this.sequence += 1;
    return `ticket-${this.sequence}`;
  }
}

class FailingNotificationStore extends InMemoryTicketStore {
  override saveSupervisorNotification(): void {
    throw new Error('notification persistence failed');
  }
}

class FailingSupervisorNotifier implements SupervisorNotifier {
  notify(): void {
    throw new Error('notification delivery failed');
  }
}

class PersistenceCheckingNotifier implements SupervisorNotifier {
  readonly notifications: Parameters<SupervisorNotifier['notify']>[0][] = [];

  constructor(private readonly store: InMemoryTicketStore) {}

  notify(record: Parameters<SupervisorNotifier['notify']>[0]): void {
    expect(this.store.listSupervisorNotifications()).toContainEqual(record);
    this.notifications.push(record);
  }
}

const CREATED_AT = new Date('2025-01-01T00:00:00.000Z');

function createService(
  clock = new FixedClock(CREATED_AT),
  supervisorNotifier?: SupervisorNotifier,
  store = new InMemoryTicketStore(),
) {
  const notifier = supervisorNotifier ?? new InMemorySupervisorNotifier();

  return {
    clock,
    store,
    supervisorNotifier: notifier,
    service: new TicketService({
      agentDirectory: new InMemoryAgentDirectory(),
      clock,
      idGenerator: new TestIdGenerator(),
      store,
      supervisorNotifier: notifier,
    }),
  };
}

function createInput(
  category: Category,
  priority: Priority,
  title = 'VPN access',
) {
  return {
    title,
    description: 'Cannot connect from the office',
    category,
    priority,
    requester: 'user-123',
  };
}

function snapshotStore(
  store: InMemoryTicketStore,
  supervisorNotifier: InMemorySupervisorNotifier,
) {
  const tickets = store.list();

  return {
    tickets,
    history: tickets.map((ticket) => ({
      ticketId: ticket.id,
      entries: store.listHistory(ticket.id),
    })),
    escalations: store.listEscalations(),
    supervisorNotifications: store.listSupervisorNotifications(),
    emittedNotifications: supervisorNotifier.listNotifications(),
  };
}

describe('TicketService creation and queries', () => {
  it('creates a trimmed, new ticket with an opaque generated id and SLA dates', () => {
    const { service } = createService();

    const ticket = service.create({
      ...createInput('ACCESOS', 'ALTA', '  VPN access  '),
      description: '  Cannot connect from the office  ',
      requester: '  user-123  ',
    });

    expect(ticket).toMatchObject({
      id: 'ticket-1',
      title: 'VPN access',
      description: 'Cannot connect from the office',
      category: 'ACCESOS',
      priority: 'ALTA',
      requester: 'user-123',
      responsibleId: null,
      status: 'NUEVO',
      overdue: false,
      overdueCycle: 1,
      resolutionNote: null,
      resolvedAt: null,
      closedAt: null,
      escalations: [],
      supervisorNotifications: [],
    });
    expect(ticket.createdAt).toEqual(CREATED_AT);
    expect(ticket.updatedAt).toEqual(CREATED_AT);
    expect(ticket.dueAt).toEqual(new Date('2025-01-01T08:00:00.000Z'));
  });

  it.each([
    ['CRITICA', 4],
    ['ALTA', 8],
    ['MEDIA', 24],
    ['BAJA', 72],
  ] as const)('calculates dueAt from the %s resolution SLA', (priority, hours) => {
    const { service } = createService();

    const ticket = service.create(createInput('ACCESOS', priority));

    expect(ticket.dueAt).toEqual(
      new Date(CREATED_AT.getTime() + hours * 60 * 60 * 1_000),
    );
  });

  it('evaluates overdue tickets in list and before a mutating assignment returns', () => {
    const clock = new FixedClock(CREATED_AT);
    const { service, store } = createService(clock);
    const created = service.create(createInput('ACCESOS', 'CRITICA'));
    clock.set(new Date('2025-01-01T04:00:00.001Z'));

    expect(service.list()).toEqual([
      expect.objectContaining({ id: created.id, overdue: true }),
    ]);

    const assigned = service.assign(created.id, 'agent-1', 'supervisor-1');

    expect(assigned).toMatchObject({
      id: created.id,
      status: 'ASIGNADO',
      overdue: true,
      escalations: [{ ticketId: created.id, cycle: 1 }],
      supervisorNotifications: [{ ticketId: created.id, cycle: 1 }],
    });
    expect(store.get(created.id)).toEqual(assigned);
  });

  it('persists the notification before notifying and returns the final stored state', () => {
    const clock = new FixedClock(CREATED_AT);
    const store = new InMemoryTicketStore();
    const notifier = new PersistenceCheckingNotifier(store);
    const { service } = createService(clock, notifier, store);
    const created = service.create(createInput('ACCESOS', 'CRITICA'));
    clock.set(new Date('2025-01-01T04:00:00.001Z'));

    const evaluated = service.get(created.id);

    expect(evaluated).toEqual(store.get(created.id));
    expect(store.listSupervisorNotifications(created.id)).toHaveLength(1);
    expect(notifier.notifications).toHaveLength(1);
    expect(notifier.notifications[0]).toEqual(
      store.listSupervisorNotifications(created.id)[0],
    );
  });

  it('evaluates overdue state before applying AND filters in list', () => {
    const { service } = createService();
    service.create(createInput('ACCESOS', 'ALTA', 'Access'));
    const matching = service.create(
      createInput('APLICACIONES', 'ALTA', 'Application'),
    );
    service.create(createInput('APLICACIONES', 'BAJA', 'Facilities'));

    expect(service.list({ category: 'APLICACIONES', priority: 'ALTA' })).toEqual([
      expect.objectContaining({ id: matching.id }),
    ]);
    expect(service.list({ category: 'APLICACIONES', status: 'ASIGNADO' })).toEqual(
      [],
    );
  });

  it('assigns an active agent and records the automatic state transition', () => {
    const clock = new FixedClock(CREATED_AT);
    const { service, store } = createService(clock);
    const created = service.create(createInput('ACCESOS', 'ALTA'));
    clock.advanceBy(1_000);

    const assigned = service.assign(created.id, 'agent-1', 'supervisor-1');

    expect(assigned).toMatchObject({
      id: created.id,
      responsibleId: 'agent-1',
      status: 'ASIGNADO',
      updatedAt: new Date('2025-01-01T00:00:01.000Z'),
    });
    expect(store.listHistory(created.id)).toEqual([
      expect.objectContaining({
        from: 'NUEVO',
        to: 'ASIGNADO',
        actorId: 'supervisor-1',
      }),
    ]);
  });

  it('keeps an operational status and history unchanged when reassigning', () => {
    const clock = new FixedClock(CREATED_AT);
    const { service, store } = createService(clock);
    const created = service.create(createInput('ACCESOS', 'ALTA'));
    service.assign(created.id, 'agent-1', 'supervisor-1');
    const assigned = service.get(created.id);
    store.save({ ...assigned, status: 'EN_PROGRESO' });
    clock.advanceBy(1_000);

    const reassigned = service.assign(created.id, 'agent-2', 'supervisor-1');

    expect(reassigned).toMatchObject({
      responsibleId: 'agent-2',
      status: 'EN_PROGRESO',
      updatedAt: new Date('2025-01-01T00:00:01.000Z'),
    });
    expect(store.listHistory(created.id)).toHaveLength(1);
  });

  it('rejects missing or unknown actors and unavailable agents without mutation', () => {
    const { service, store, supervisorNotifier } = createService();
    const created = service.create(createInput('ACCESOS', 'ALTA'));
    const beforeActorErrors = snapshotStore(store, supervisorNotifier);

    expect(() => service.assign(created.id, 'agent-1', '')).toThrow(
      ActorRequiredError,
    );
    expect(() => service.assign(created.id, 'agent-1', 'unknown-actor')).toThrow(
      ActorUnknownError,
    );
    expect(snapshotStore(store, supervisorNotifier)).toEqual(beforeActorErrors);

    expect(() =>
      service.assign(created.id, 'agent-inactive', 'supervisor-1'),
    ).toThrow(AgentUnavailableError);
    expect(() =>
      service.assign(created.id, 'agent-does-not-exist', 'supervisor-1'),
    ).toThrow(AgentUnavailableError);
    expect(snapshotStore(store, supervisorNotifier)).toEqual(beforeActorErrors);
    expect(service.get(created.id)).toMatchObject({
      responsibleId: null,
      status: 'NUEVO',
    });
  });


  it('rejects an invalid Clock date without changing the ticket or event history', () => {
    let current = CREATED_AT;
    const clock = { now: () => current };
    const { service, store, supervisorNotifier } = createService(clock);
    const created = service.create(createInput('ACCESOS', 'CRITICA'));
    const before = snapshotStore(store, supervisorNotifier);
    current = new Date(Number.NaN);

    expect(() => service.get(created.id)).toThrow(InvalidRequestError);
    expect(snapshotStore(store, supervisorNotifier)).toEqual(before);
  });

  it('propagates Store failures before notifying the supervisor', () => {
    const clock = new FixedClock(CREATED_AT);
    const store = new FailingNotificationStore();
    const supervisorNotifier = new InMemorySupervisorNotifier();
    const service = new TicketService({
      agentDirectory: new InMemoryAgentDirectory(),
      clock,
      idGenerator: new TestIdGenerator(),
      store,
      supervisorNotifier,
    });
    const created = service.create(createInput('ACCESOS', 'CRITICA'));
    clock.set(new Date('2025-01-01T04:00:00.001Z'));

    expect(() => service.get(created.id)).toThrow('notification persistence failed');
    expect(store.listSupervisorNotifications()).toEqual([]);
    expect(supervisorNotifier.list()).toEqual([]);
  });

  it('keeps a persisted notification when Notifier delivery fails', () => {
    const clock = new FixedClock(CREATED_AT);
    const store = new InMemoryTicketStore();
    const service = new TicketService({
      agentDirectory: new InMemoryAgentDirectory(),
      clock,
      idGenerator: new TestIdGenerator(),
      store,
      supervisorNotifier: new FailingSupervisorNotifier(),
    });
    const created = service.create(createInput('ACCESOS', 'CRITICA'));
    clock.set(new Date('2025-01-01T04:00:00.001Z'));

    expect(() => service.get(created.id)).toThrow('notification delivery failed');
    expect(store.listEscalations(created.id)).toHaveLength(1);
    expect(store.listSupervisorNotifications(created.id)).toHaveLength(1);
    expect(store.get(created.id)).toMatchObject({ overdue: true });
  });

  it('throws when getting a ticket that does not exist', () => {
    const { service } = createService();

    expect(() => service.get('missing-ticket')).toThrow(TicketNotFoundError);
  });

  it('supports no-op status requests without changing timestamps or history', () => {
    const { service, store } = createService();
    const created = service.create(createInput('ACCESOS', 'ALTA'));

    const unchanged = service.changeStatus(
      created.id,
      'NUEVO',
      undefined,
      'supervisor-1',
    );

    expect(unchanged).toEqual(created);
    expect(store.listHistory(created.id)).toEqual([]);
  });

  it('rejects invalid status changes and resolution notes without mutation', () => {
    const { service, store, supervisorNotifier } = createService();
    const created = service.create(createInput('ACCESOS', 'ALTA'));
    const beforeInvalidTransition = snapshotStore(store, supervisorNotifier);

    expect(() =>
      service.changeStatus(created.id, 'RESUELTO', '  ', 'supervisor-1'),
    ).toThrow(InvalidTransitionError);
    expect(snapshotStore(store, supervisorNotifier)).toEqual(
      beforeInvalidTransition,
    );

    service.changeStatus(created.id, 'ASIGNADO', undefined, 'supervisor-1');
    service.changeStatus(created.id, 'EN_PROGRESO', undefined, 'supervisor-1');
    const beforeInvalidResolution = snapshotStore(store, supervisorNotifier);

    expect(() =>
      service.changeStatus(created.id, 'RESUELTO', '  ', 'supervisor-1'),
    ).toThrow(InvalidRequestError);
    expect(snapshotStore(store, supervisorNotifier)).toEqual(
      beforeInvalidResolution,
    );

    expect(() =>
      service.changeStatus(created.id, 'ASIGNADO', undefined, 'supervisor-1'),
    ).toThrow(InvalidTransitionError);
    expect(snapshotStore(store, supervisorNotifier)).toEqual(
      beforeInvalidResolution,
    );
    expect(service.get(created.id)).toMatchObject({
      status: 'EN_PROGRESO',
      resolutionNote: null,
      resolvedAt: null,
      closedAt: null,
    });
    expect(store.listHistory(created.id)).toHaveLength(2);
  });

  it('normalizes resolution notes and records resolution and closure times', () => {
    const clock = new FixedClock(CREATED_AT);
    const { service, store } = createService(clock);
    const created = service.create(createInput('ACCESOS', 'ALTA'));
    service.assign(created.id, 'agent-1', 'supervisor-1');
    clock.advanceBy(1_000);
    service.changeStatus(created.id, 'EN_PROGRESO', undefined, 'agent-1');
    clock.advanceBy(1_000);

    const resolved = service.changeStatus(
      created.id,
      'RESUELTO',
      '  VPN reiniciada correctamente  ',
      'agent-1',
    );

    expect(resolved).toMatchObject({
      status: 'RESUELTO',
      resolutionNote: 'VPN reiniciada correctamente',
      resolvedAt: new Date('2025-01-01T00:00:02.000Z'),
      closedAt: null,
    });

    clock.advanceBy(1_000);
    const closed = service.changeStatus(
      created.id,
      'CERRADO',
      undefined,
      'supervisor-1',
    );

    expect(closed).toMatchObject({
      status: 'CERRADO',
      resolutionNote: 'VPN reiniciada correctamente',
      resolvedAt: new Date('2025-01-01T00:00:02.000Z'),
      closedAt: new Date('2025-01-01T00:00:03.000Z'),
    });
    expect(store.listHistory(created.id)).toEqual([
      expect.objectContaining({ from: 'NUEVO', to: 'ASIGNADO' }),
      expect.objectContaining({ from: 'ASIGNADO', to: 'EN_PROGRESO' }),
      expect.objectContaining({ from: 'EN_PROGRESO', to: 'RESUELTO' }),
      expect.objectContaining({ from: 'RESUELTO', to: 'CERRADO' }),
    ]);
  });

  it('reopens resolved tickets as a new overdue cycle while preserving history and events', () => {
    const clock = new FixedClock(CREATED_AT);
    const { service, store } = createService(clock);
    const created = service.create(createInput('ACCESOS', 'ALTA'));
    service.assign(created.id, 'agent-1', 'supervisor-1');
    service.changeStatus(created.id, 'EN_PROGRESO', undefined, 'agent-1');
    service.changeStatus(
      created.id,
      'RESUELTO',
      '  Solución aplicada  ',
      'agent-1',
    );
    service.changeStatus(created.id, 'CERRADO', undefined, 'supervisor-1');

    const escalatedAt = new Date('2025-01-01T01:00:00.000Z');
    const notifiedAt = new Date('2025-01-01T01:00:01.000Z');
    const closed = service.get(created.id);
    store.save({
      ...closed,
      overdue: true,
      overdueCycle: 1,
      escalations: [
        { ticketId: created.id, cycle: 1, escalatedAt, notifiedAt },
      ],
      supervisorNotifications: [
        { ticketId: created.id, cycle: 1, notifiedAt },
      ],
    });
    clock.advanceBy(1_000);

    const reopened = service.changeStatus(
      created.id,
      'EN_PROGRESO',
      undefined,
      'agent-1',
    );

    expect(reopened).toMatchObject({
      status: 'EN_PROGRESO',
      overdue: false,
      overdueCycle: 2,
      resolutionNote: null,
      resolvedAt: null,
      closedAt: null,
      escalations: [
        { ticketId: created.id, cycle: 1, escalatedAt, notifiedAt },
      ],
      supervisorNotifications: [
        { ticketId: created.id, cycle: 1, notifiedAt },
      ],
    });
    expect(store.listHistory(created.id)).toHaveLength(5);
    expect(store.listHistory(created.id).at(-1)).toMatchObject({
      from: 'CERRADO',
      to: 'EN_PROGRESO',
      actorId: 'agent-1',
    });
  });

  it('validates the actor before changing status', () => {
    const { service } = createService();
    const created = service.create(createInput('ACCESOS', 'ALTA'));

    expect(() =>
      service.changeStatus(created.id, 'ASIGNADO', undefined, ''),
    ).toThrow(ActorRequiredError);
    expect(() =>
      service.changeStatus(created.id, 'ASIGNADO', undefined, 'unknown-actor'),
    ).toThrow(ActorUnknownError);
  });
});


describe('TicketService overdue evaluation', () => {
  it('authorizes supervisors, filters after evaluation, and emits one event pair per cycle', () => {
    const clock = new FixedClock(CREATED_AT);
    const { service, store, supervisorNotifier } = createService(clock);
    const accessTicket = service.create(createInput('ACCESOS', 'CRITICA'));
    const applicationTicket = service.create(
      createInput('APLICACIONES', 'CRITICA'),
    );

    clock.set(new Date('2025-01-01T04:00:00.001Z'));
    const beforeSupervisorErrors = snapshotStore(store, supervisorNotifier);

    expect(() => service.listOverdue(undefined, 'agent-1')).toThrow(
      SupervisorRequiredError,
    );
    expect(() => service.listOverdue(undefined, 'unknown-actor')).toThrow(
      SupervisorRequiredError,
    );
    expect(snapshotStore(store, supervisorNotifier)).toEqual(
      beforeSupervisorErrors,
    );

    expect(service.listOverdue(undefined, 'supervisor-1')).toEqual([
      expect.objectContaining({ id: accessTicket.id, overdue: true }),
      expect.objectContaining({ id: applicationTicket.id, overdue: true }),
    ]);
    expect(service.listOverdue('ACCESOS', 'supervisor-1')).toEqual([
      expect.objectContaining({ id: accessTicket.id, overdue: true }),
    ]);
    expect(service.listOverdue(undefined, 'supervisor-1')).toHaveLength(2);

    expect(store.listEscalations()).toHaveLength(2);
    expect(store.listSupervisorNotifications()).toHaveLength(2);
    expect(supervisorNotifier.list()).toHaveLength(2);
    expect(store.listEscalations()[0].notifiedAt).toEqual(
      store.listSupervisorNotifications()[0].notifiedAt,
    );
  });

  it('preserves terminal overdue events and records a new cycle after reopening', () => {
    const clock = new FixedClock(CREATED_AT);
    const { service, store, supervisorNotifier } = createService(clock);
    const created = service.create(createInput('ACCESOS', 'CRITICA'));
    clock.set(new Date('2025-01-01T04:00:00.001Z'));

    service.listOverdue(undefined, 'supervisor-1');
    service.assign(created.id, 'agent-1', 'supervisor-1');
    service.changeStatus(created.id, 'EN_PROGRESO', undefined, 'agent-1');
    const resolved = service.changeStatus(
      created.id,
      'RESUELTO',
      'VPN reiniciada',
      'agent-1',
    );

    expect(resolved).toMatchObject({
      status: 'RESUELTO',
      overdue: true,
      escalations: [{ cycle: 1 }],
      supervisorNotifications: [{ cycle: 1 }],
    });
    expect(service.listOverdue(undefined, 'supervisor-1')).toEqual([]);
    expect(store.listEscalations(created.id)).toHaveLength(1);

    service.changeStatus(created.id, 'EN_PROGRESO', undefined, 'agent-1');
    const reopenedOverdue = service.listOverdue(undefined, 'supervisor-1');

    expect(reopenedOverdue[0]).toMatchObject({
      id: created.id,
      status: 'EN_PROGRESO',
      overdue: true,
      overdueCycle: 2,
      escalations: [{ cycle: 1 }, { cycle: 2 }],
      supervisorNotifications: [{ cycle: 1 }, { cycle: 2 }],
    });
    expect(store.listEscalations(created.id)).toHaveLength(2);
    expect(store.listSupervisorNotifications(created.id)).toHaveLength(2);
    expect(supervisorNotifier.list()).toHaveLength(2);
  });
});


describe('TicketService terminal lifecycle and reopening', () => {
  it('preserves a non-overdue terminal ticket without creating expiry events', () => {
    const clock = new FixedClock(CREATED_AT);
    const { service, store, supervisorNotifier } = createService(clock);
    const created = service.create(createInput('ACCESOS', 'CRITICA'));

    service.assign(created.id, 'agent-1', 'supervisor-1');
    service.changeStatus(created.id, 'EN_PROGRESO', undefined, 'agent-1');
    const resolved = service.changeStatus(
      created.id,
      'RESUELTO',
      'Resolved before SLA deadline',
      'agent-1',
    );

    expect(resolved).toMatchObject({
      status: 'RESUELTO',
      overdue: false,
      overdueCycle: 1,
      escalations: [],
      supervisorNotifications: [],
    });
    expect(store.listEscalations(created.id)).toEqual([]);
    expect(store.listSupervisorNotifications(created.id)).toEqual([]);
    expect(supervisorNotifier.listNotifications()).toEqual([]);

    const closed = service.changeStatus(
      created.id,
      'CERRADO',
      undefined,
      'supervisor-1',
    );

    expect(closed).toMatchObject({
      status: 'CERRADO',
      overdue: false,
      overdueCycle: 1,
      escalations: [],
      supervisorNotifications: [],
    });
  });

  it('preserves expiry events when a ticket is terminalized after its deadline', () => {
    const clock = new FixedClock(CREATED_AT);
    const { service, store, supervisorNotifier } = createService(clock);
    const created = service.create(createInput('ACCESOS', 'CRITICA'));
    clock.set(new Date('2025-01-01T04:00:00.001Z'));

    const overdue = service.get(created.id);
    const escalation = overdue.escalations[0];
    const notification = overdue.supervisorNotifications[0];
    service.assign(created.id, 'agent-1', 'supervisor-1');
    service.changeStatus(created.id, 'EN_PROGRESO', undefined, 'agent-1');

    const resolved = service.changeStatus(
      created.id,
      'RESUELTO',
      'Resolved after SLA deadline',
      'supervisor-1',
    );
    const closed = service.changeStatus(
      created.id,
      'CERRADO',
      undefined,
      'supervisor-1',
    );

    expect(resolved).toMatchObject({
      status: 'RESUELTO',
      overdue: true,
      overdueCycle: 1,
      escalations: [escalation],
      supervisorNotifications: [notification],
    });
    expect(closed).toMatchObject({
      status: 'CERRADO',
      overdue: true,
      overdueCycle: 1,
      escalations: [escalation],
      supervisorNotifications: [notification],
    });
    expect(store.listEscalations(created.id)).toHaveLength(1);
    expect(store.listSupervisorNotifications(created.id)).toHaveLength(1);
    expect(supervisorNotifier.listNotifications()).toHaveLength(1);
  });

  it.each([
    ['RESUELTO', 'agent-1'],
    ['CERRADO', 'supervisor-1'],
  ] as const)('reopens a %s ticket into a new cycle and preserves prior events', (terminalStatus, reopenActor) => {
    const clock = new FixedClock(CREATED_AT);
    const { service, store, supervisorNotifier } = createService(clock);
    const created = service.create(createInput('ACCESOS', 'CRITICA'));
    clock.set(new Date('2025-01-01T04:00:00.001Z'));

    service.get(created.id);
    service.assign(created.id, 'agent-1', 'supervisor-1');
    service.changeStatus(created.id, 'EN_PROGRESO', undefined, 'agent-1');
    service.changeStatus(
      created.id,
      'RESUELTO',
      'Initial resolution',
      'agent-1',
    );
    if (terminalStatus === 'CERRADO') {
      service.changeStatus(created.id, 'CERRADO', undefined, 'supervisor-1');
    }

    const beforeReopening = service.get(created.id);
    const firstCycleEscalation = beforeReopening.escalations[0];
    const firstCycleNotification = beforeReopening.supervisorNotifications[0];
    const reopened = service.changeStatus(
      created.id,
      'EN_PROGRESO',
      undefined,
      reopenActor,
    );

    expect(reopened).toMatchObject({
      status: 'EN_PROGRESO',
      overdue: false,
      overdueCycle: 2,
      escalations: [firstCycleEscalation],
      supervisorNotifications: [firstCycleNotification],
    });

    const secondCycle = service.get(created.id);
    expect(secondCycle).toMatchObject({
      overdue: true,
      overdueCycle: 2,
      escalations: [
        firstCycleEscalation,
        expect.objectContaining({ ticketId: created.id, cycle: 2 }),
      ],
      supervisorNotifications: [
        firstCycleNotification,
        expect.objectContaining({ ticketId: created.id, cycle: 2 }),
      ],
    });
    expect(store.listEscalations(created.id)).toHaveLength(2);
    expect(store.listSupervisorNotifications(created.id)).toHaveLength(2);
    expect(supervisorNotifier.listNotifications()).toHaveLength(2);
    expect(store.listHistory(created.id).at(-1)).toMatchObject({
      from: terminalStatus,
      to: 'EN_PROGRESO',
    });
  });
});
