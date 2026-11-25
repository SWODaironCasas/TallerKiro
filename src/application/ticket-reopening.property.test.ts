import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Priority, StateHistoryEntry } from '../domain/types.js';
import { InMemoryAgentDirectory } from '../infrastructure/in-memory-agent-directory.js';
import { InMemorySupervisorNotifier } from '../infrastructure/in-memory-supervisor-notifier.js';
import { InMemoryTicketStore } from '../infrastructure/in-memory-ticket-store.js';
import { FixedClock } from '../test-utils/index.js';
import { TicketService, type CreateTicketInput } from './ticket-service.js';

const CREATED_AT = new Date('2025-01-01T00:00:00.000Z');
const ACTIVE_AGENT = 'agent-1';
const SUPERVISOR = 'supervisor-1';

const priorityArbitrary = fc.constantFrom<Priority>(
  'CRITICA',
  'ALTA',
  'MEDIA',
  'BAJA',
);

const terminalStatusArbitrary = fc.constantFrom<'RESUELTO' | 'CERRADO'>(
  'RESUELTO',
  'CERRADO',
);

const breachOffsetArbitrary = fc.integer({ min: 1, max: 24 * 60 * 60 * 1000 });
const reopenDelayArbitrary = fc.integer({ min: 0, max: 24 * 60 * 60 * 1000 });

const SLA_BY_PRIORITY: Record<Priority, number> = {
  CRITICA: 4 * 60 * 60 * 1000,
  ALTA: 8 * 60 * 60 * 1000,
  MEDIA: 24 * 60 * 60 * 1000,
  BAJA: 72 * 60 * 60 * 1000,
};

class TestIdGenerator {
  private sequence = 0;

  next(): string {
    this.sequence += 1;
    return `ticket-${this.sequence}`;
  }
}

function createService(clock: FixedClock) {
  const store = new InMemoryTicketStore();
  const supervisorNotifier = new InMemorySupervisorNotifier();
  const service = new TicketService({
    agentDirectory: new InMemoryAgentDirectory(),
    clock,
    idGenerator: new TestIdGenerator(),
    store,
    supervisorNotifier,
  });

  return { service, store, supervisorNotifier };
}

function createInput(priority: Priority): CreateTicketInput {
  return {
    title: 'VPN access',
    description: 'Cannot connect from the office',
    category: 'ACCESOS',
    priority,
    requester: 'user-123',
  };
}

function historySnapshot(
  entries: StateHistoryEntry[],
): StateHistoryEntry[] {
  return entries.map((entry) => ({
    ...entry,
    changedAt: new Date(entry.changedAt),
  }));
}

describe('TicketService Property 14: reapertura y nuevos ciclos', () => {
  it('preserves prior history and SLA events while opening a fresh overdue cycle', () => {
    // Feature: ticketops-api, Property 14: La reapertura conserva eventos y comienza un ciclo nuevo.
    fc.assert(
      fc.property(
        priorityArbitrary,
        terminalStatusArbitrary,
        breachOffsetArbitrary,
        reopenDelayArbitrary,
        (priority, terminalStatus, breachOffset, reopenDelay) => {
          const clock = new FixedClock(CREATED_AT);
          const { service, store, supervisorNotifier } = createService(clock);
          const created = service.create(createInput(priority));
          const dueAt = new Date(
            CREATED_AT.getTime() + SLA_BY_PRIORITY[priority],
          );

          clock.set(new Date(dueAt.getTime() + breachOffset));
          const overdueBeforeResolution = service.listOverdue(
            undefined,
            SUPERVISOR,
          )[0];

          expect(overdueBeforeResolution).toBeDefined();
          expect(overdueBeforeResolution).toMatchObject({
            id: created.id,
            overdue: true,
            overdueCycle: 1,
            escalations: [{ cycle: 1 }],
            supervisorNotifications: [{ cycle: 1 }],
          });

          service.assign(created.id, ACTIVE_AGENT, SUPERVISOR);
          service.changeStatus(
            created.id,
            'EN_PROGRESO',
            undefined,
            ACTIVE_AGENT,
          );
          service.changeStatus(
            created.id,
            'RESUELTO',
            '  VPN reiniciada correctamente  ',
            ACTIVE_AGENT,
          );
          if (terminalStatus === 'CERRADO') {
            service.changeStatus(
              created.id,
              'CERRADO',
              undefined,
              SUPERVISOR,
            );
          }

          const terminal = service.get(created.id);
          const historyBeforeReopen = historySnapshot(
            store.listHistory(created.id),
          );
          const escalationsBeforeReopen = store.listEscalations(created.id);
          const notificationsBeforeReopen =
            store.listSupervisorNotifications(created.id);
          const emittedNotificationsBeforeReopen = supervisorNotifier.list();

          expect(terminal.status).toBe(terminalStatus);
          expect(terminal.resolutionNote).toBe('VPN reiniciada correctamente');
          expect(terminal.resolvedAt).toBeInstanceOf(Date);
          if (terminalStatus === 'CERRADO') {
            expect(terminal.closedAt).toBeInstanceOf(Date);
          } else {
            expect(terminal.closedAt).toBeNull();
          }
          expect(terminal.overdue).toBe(true);
          expect(terminal.overdueCycle).toBe(1);
          expect(terminal.escalations).toEqual(escalationsBeforeReopen);
          expect(terminal.supervisorNotifications).toEqual(
            notificationsBeforeReopen,
          );
          expect(historyBeforeReopen.length).toBe(
            terminalStatus === 'CERRADO' ? 4 : 3,
          );
          expect(escalationsBeforeReopen).toHaveLength(1);
          expect(notificationsBeforeReopen).toHaveLength(1);
          expect(emittedNotificationsBeforeReopen).toHaveLength(1);

          clock.advanceBy(reopenDelay);
          const reopened = service.changeStatus(
            created.id,
            'EN_PROGRESO',
            undefined,
            ACTIVE_AGENT,
          );

          expect(reopened).toMatchObject({
            id: created.id,
            status: 'EN_PROGRESO',
            dueAt,
            overdue: false,
            overdueCycle: 2,
            resolutionNote: null,
            resolvedAt: null,
            closedAt: null,
          });
          expect(reopened.escalations).toEqual(escalationsBeforeReopen);
          expect(reopened.supervisorNotifications).toEqual(
            notificationsBeforeReopen,
          );
          expect(store.listEscalations(created.id)).toEqual(
            escalationsBeforeReopen,
          );
          expect(store.listSupervisorNotifications(created.id)).toEqual(
            notificationsBeforeReopen,
          );
          expect(supervisorNotifier.list()).toEqual(
            emittedNotificationsBeforeReopen,
          );

          const historyAfterReopen = store.listHistory(created.id);
          expect(historyAfterReopen.slice(0, historyBeforeReopen.length)).toEqual(
            historyBeforeReopen,
          );
          expect(historyAfterReopen).toHaveLength(historyBeforeReopen.length + 1);
          expect(historyAfterReopen.at(-1)).toMatchObject({
            from: terminalStatus,
            to: 'EN_PROGRESO',
            actorId: ACTIVE_AGENT,
          });

          const overdueAfterRebreach = service.listOverdue(
            undefined,
            SUPERVISOR,
          )[0];

          expect(overdueAfterRebreach).toMatchObject({
            id: created.id,
            status: 'EN_PROGRESO',
            overdue: true,
            overdueCycle: 2,
            escalations: [
              ...escalationsBeforeReopen,
              expect.objectContaining({ cycle: 2 }),
            ],
            supervisorNotifications: [
              ...notificationsBeforeReopen,
              expect.objectContaining({ cycle: 2 }),
            ],
          });
          expect(overdueAfterRebreach.escalations).toHaveLength(2);
          expect(overdueAfterRebreach.supervisorNotifications).toHaveLength(2);
          expect(overdueAfterRebreach.escalations[1].escalatedAt).toEqual(
            overdueAfterRebreach.escalations[1].notifiedAt,
          );
          expect(
            overdueAfterRebreach.supervisorNotifications[1].notifiedAt,
          ).toEqual(overdueAfterRebreach.escalations[1].notifiedAt);
          expect(store.listEscalations(created.id)).toHaveLength(2);
          expect(store.listSupervisorNotifications(created.id)).toHaveLength(2);
          expect(supervisorNotifier.list()).toHaveLength(2);

          service.listOverdue(undefined, SUPERVISOR);
          expect(store.listEscalations(created.id)).toHaveLength(2);
          expect(store.listSupervisorNotifications(created.id)).toHaveLength(2);
          expect(supervisorNotifier.list()).toHaveLength(2);
          expect(store.listHistory(created.id)).toEqual(historyAfterReopen);
        },
      ),
      { numRuns: 100 },
    );
  });
});
