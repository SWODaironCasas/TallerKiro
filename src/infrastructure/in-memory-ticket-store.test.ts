import { describe, expect, it } from 'vitest';
import type {
  EscalationRecord,
  SupervisorNotification,
  Ticket,
} from '../domain/types.js';
import { InMemorySupervisorNotifier } from './in-memory-supervisor-notifier.js';
import { InMemoryTicketStore } from './in-memory-ticket-store.js';

const CREATED_AT = new Date('2025-01-01T00:00:00.000Z');
const UPDATED_AT = new Date('2025-01-01T01:00:00.000Z');
const DUE_AT = new Date('2025-01-01T08:00:00.000Z');
const ESCALATED_AT = new Date('2025-01-01T08:00:00.001Z');
const NOTIFIED_AT = new Date('2025-01-01T08:00:00.002Z');

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'ticket-1',
    title: 'VPN access failure',
    description: 'The requester cannot connect to the VPN.',
    category: 'ACCESOS',
    priority: 'ALTA',
    requester: 'user-1',
    responsibleId: null,
    status: 'NUEVO',
    createdAt: new Date(CREATED_AT),
    updatedAt: new Date(UPDATED_AT),
    dueAt: new Date(DUE_AT),
    resolutionNote: null,
    resolvedAt: null,
    closedAt: null,
    overdue: false,
    overdueCycle: 1,
    escalations: [],
    supervisorNotifications: [],
    ...overrides,
  };
}

function makeEscalation(
  overrides: Partial<EscalationRecord> = {},
): EscalationRecord {
  return {
    ticketId: 'ticket-1',
    cycle: 1,
    escalatedAt: new Date(ESCALATED_AT),
    notifiedAt: new Date(NOTIFIED_AT),
    ...overrides,
  };
}

function makeNotification(
  overrides: Partial<SupervisorNotification> = {},
): SupervisorNotification {
  return {
    ticketId: 'ticket-1',
    cycle: 1,
    notifiedAt: new Date(NOTIFIED_AT),
    ...overrides,
  };
}

// Feature: ticketops-api, Task 3.3: pruebas unitarias de aislamiento y observabilidad

describe('InMemoryTicketStore', () => {
  it('keeps saved tickets isolated from both input and returned object mutations', () => {
    const store = new InMemoryTicketStore();
    const ticket = makeTicket({
      escalations: [makeEscalation()],
      supervisorNotifications: [makeNotification()],
    });

    store.save(ticket);

    ticket.title = 'mutated input';
    ticket.createdAt.setUTCDate(2);
    ticket.escalations[0].notifiedAt.setUTCDate(2);
    ticket.supervisorNotifications[0].notifiedAt.setUTCDate(2);

    const observed = store.get('ticket-1');
    expect(observed).toBeDefined();
    expect(observed?.title).toBe('VPN access failure');
    expect(observed?.createdAt.toISOString()).toBe(CREATED_AT.toISOString());
    expect(observed?.escalations[0].notifiedAt.toISOString()).toBe(
      NOTIFIED_AT.toISOString(),
    );
    expect(observed?.supervisorNotifications[0].notifiedAt.toISOString()).toBe(
      NOTIFIED_AT.toISOString(),
    );

    if (observed) {
      observed.title = 'mutated copy';
      observed.updatedAt.setUTCDate(3);
      observed.escalations[0].escalatedAt.setUTCDate(3);
      observed.supervisorNotifications[0].notifiedAt.setUTCDate(3);
    }

    const reread = store.get('ticket-1');
    expect(reread?.title).toBe('VPN access failure');
    expect(reread?.updatedAt.toISOString()).toBe(UPDATED_AT.toISOString());
    expect(reread?.escalations[0].escalatedAt.toISOString()).toBe(
      ESCALATED_AT.toISOString(),
    );
    expect(reread?.supervisorNotifications[0].notifiedAt.toISOString()).toBe(
      NOTIFIED_AT.toISOString(),
    );
  });

  it('persists observable escalation and notification records with ticket, cycle, and dates', () => {
    const store = new InMemoryTicketStore();
    const escalation = makeEscalation();
    const notification = makeNotification();

    store.saveEscalation(escalation);
    store.saveSupervisorNotification(notification);

    expect(store.listEscalations('ticket-1')).toEqual([escalation]);
    expect(store.listSupervisorNotifications('ticket-1')).toEqual([notification]);

    const observedEscalation = store.listEscalations()[0];
    const observedNotification = store.listSupervisorNotifications()[0];
    expect(observedEscalation).toMatchObject({
      ticketId: 'ticket-1',
      cycle: 1,
      escalatedAt: ESCALATED_AT,
      notifiedAt: NOTIFIED_AT,
    });
    expect(observedNotification).toMatchObject({
      ticketId: 'ticket-1',
      cycle: 1,
      notifiedAt: NOTIFIED_AT,
    });

    observedEscalation.escalatedAt.setUTCDate(2);
    observedNotification.notifiedAt.setUTCDate(2);
    expect(store.listEscalations('ticket-1')[0].escalatedAt).toEqual(
      ESCALATED_AT,
    );
    expect(store.listSupervisorNotifications('ticket-1')[0].notifiedAt).toEqual(
      NOTIFIED_AT,
    );
  });

  it('isolates history records on save and read', () => {
    const store = new InMemoryTicketStore();
    const entry = {
      sequence: 1,
      ticketId: 'ticket-1',
      from: 'NUEVO' as const,
      to: 'EN_PROGRESO' as const,
      changedAt: new Date('2025-01-01T02:00:00.000Z'),
      actorId: 'agent-1',
    };

    store.saveHistory(entry);
    entry.changedAt.setUTCDate(2);
    entry.actorId = 'mutated-input';

    const observed = store.listHistory('ticket-1');
    observed[0].changedAt.setUTCDate(3);
    observed[0].actorId = 'mutated-copy';

    expect(store.listHistory('ticket-1')).toEqual([
      {
        ...entry,
        changedAt: new Date('2025-01-01T02:00:00.000Z'),
        actorId: 'agent-1',
      },
    ]);
  });

  it('partitions tickets and event records by ticket id', () => {
    const store = new InMemoryTicketStore();

    store.save(makeTicket({ id: 'ticket-1' }));
    store.save(makeTicket({ id: 'ticket-2' }));
    store.saveEscalation(makeEscalation({ ticketId: 'ticket-1', cycle: 1 }));
    store.saveEscalation(makeEscalation({ ticketId: 'ticket-2', cycle: 2 }));
    store.saveSupervisorNotification(
      makeNotification({ ticketId: 'ticket-1', cycle: 1 }),
    );
    store.saveSupervisorNotification(
      makeNotification({ ticketId: 'ticket-2', cycle: 2 }),
    );

    expect(store.listEscalations('ticket-1')).toEqual([
      makeEscalation({ ticketId: 'ticket-1', cycle: 1 }),
    ]);
    expect(store.listEscalations('ticket-2')).toEqual([
      makeEscalation({ ticketId: 'ticket-2', cycle: 2 }),
    ]);
    expect(store.listSupervisorNotifications('ticket-1')).toEqual([
      makeNotification({ ticketId: 'ticket-1', cycle: 1 }),
    ]);
    expect(store.listSupervisorNotifications('ticket-2')).toEqual([
      makeNotification({ ticketId: 'ticket-2', cycle: 2 }),
    ]);
  });

  it('keeps two store instances isolated, including SLA event collections', () => {
    const first = new InMemoryTicketStore();
    const second = new InMemoryTicketStore();

    first.save(makeTicket());
    first.saveEscalation(makeEscalation());
    first.saveSupervisorNotification(makeNotification());

    expect(second.get('ticket-1')).toBeUndefined();
    expect(second.list()).toEqual([]);
    expect(second.listEscalations()).toEqual([]);
    expect(second.listSupervisorNotifications()).toEqual([]);

    second.save(makeTicket({ id: 'ticket-2' }));
    expect(first.get('ticket-2')).toBeUndefined();
    expect(first.list()).toHaveLength(1);
    expect(second.list()).toHaveLength(1);
  });
});

describe('InMemorySupervisorNotifier', () => {
  it('receives at most one observable notification for each overdue cycle', () => {
    const notifier = new InMemorySupervisorNotifier();
    const notifications = [
      makeNotification({ cycle: 1 }),
      makeNotification({ cycle: 2, notifiedAt: new Date('2025-01-02T08:00:00.000Z') }),
    ];

    for (const notification of notifications) {
      notifier.notify(notification);
    }

    const received = notifier.list();
    const countsByCycle = new Map<number, number>();
    for (const notification of received) {
      countsByCycle.set(
        notification.cycle,
        (countsByCycle.get(notification.cycle) ?? 0) + 1,
      );
    }

    expect(received).toHaveLength(2);
    expect([...countsByCycle.entries()]).toEqual([
      [1, 1],
      [2, 1],
    ]);
    expect(Math.max(...countsByCycle.values())).toBeLessThanOrEqual(1);
  });

  it('exposes the ticket, cycle, and notification date for each received record', () => {
    const notifier = new InMemorySupervisorNotifier();
    const notification = makeNotification({
      ticketId: 'ticket-42',
      cycle: 3,
      notifiedAt: new Date('2025-01-03T12:34:56.789Z'),
    });

    notifier.notify(notification);

    expect(notifier.listNotifications()).toEqual([notification]);
    expect(notifier.notifications[0]).toMatchObject({
      ticketId: 'ticket-42',
      cycle: 3,
      notifiedAt: new Date('2025-01-03T12:34:56.789Z'),
    });
  });
});
