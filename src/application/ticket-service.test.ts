import { describe, expect, it } from 'vitest';
import type { Category, Priority } from '../domain/types.js';
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

const CREATED_AT = new Date('2025-01-01T00:00:00.000Z');

function createService(clock = new FixedClock(CREATED_AT)) {
  const store = new InMemoryTicketStore();
  const supervisorNotifier = new InMemorySupervisorNotifier();

  return {
    clock,
    store,
    supervisorNotifier,
    service: new TicketService({
      agentDirectory: new InMemoryAgentDirectory(),
      clock,
      idGenerator: new TestIdGenerator(),
      store,
      supervisorNotifier,
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

  it('evaluates overdue state before returning a ticket from get', () => {
    const clock = new FixedClock(CREATED_AT);
    const { service } = createService(clock);
    const created = service.create(createInput('ACCESOS', 'CRITICA'));

    clock.set(new Date('2025-01-01T04:00:00.001Z'));

    expect(service.get(created.id)).toMatchObject({
      id: created.id,
      overdue: true,
      overdueCycle: 1,
    });
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
