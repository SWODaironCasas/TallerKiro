import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Priority } from '../domain/types.js';
import { InMemoryAgentDirectory } from '../infrastructure/in-memory-agent-directory.js';
import { InMemorySupervisorNotifier } from '../infrastructure/in-memory-supervisor-notifier.js';
import { InMemoryTicketStore } from '../infrastructure/in-memory-ticket-store.js';
import { FixedClock } from '../test-utils/index.js';
import { TicketService } from './ticket-service.js';

const CREATED_AT = new Date('2025-01-01T00:00:00.000Z');
const PRIORITIES: readonly Priority[] = ['CRITICA', 'ALTA', 'MEDIA', 'BAJA'];

class TestIdGenerator {
  next(): string {
    return 'ticket-overdue-idempotence-property';
  }
}

const priorityArbitrary = fc.constantFrom(...PRIORITIES);
const overdueOffsetArbitrary = fc.integer({
  min: 1,
  max: 7 * 24 * 60 * 60 * 1000,
});
const evaluationCountArbitrary = fc.integer({ min: 1, max: 20 });

describe('TicketService overdue-cycle idempotence property', () => {
  it('records one escalation and notification for repeated evaluations of one cycle', () => {
    // Feature: ticketops-api, Property 13: Cada ciclo de vencimiento es idempotente
    fc.assert(
      fc.property(
        priorityArbitrary,
        overdueOffsetArbitrary,
        evaluationCountArbitrary,
        (priority, overdueOffset, evaluationCount) => {
          const store = new InMemoryTicketStore();
          const clock = new FixedClock(CREATED_AT);
          const supervisorNotifier = new InMemorySupervisorNotifier();
          const service = new TicketService({
            agentDirectory: new InMemoryAgentDirectory(),
            clock,
            idGenerator: new TestIdGenerator(),
            store,
            supervisorNotifier,
          });

          const ticket = service.create({
            title: 'VPN access failure',
            description: 'The user cannot connect to the VPN.',
            category: 'ACCESOS',
            priority,
            requester: 'requester-1',
          });
          const overdueAt = new Date(ticket.dueAt.getTime() + overdueOffset);
          clock.set(overdueAt);

          for (let evaluation = 0; evaluation < evaluationCount; evaluation += 1) {
            const overdueTickets = service.listOverdue(undefined, 'supervisor-1');

            expect(overdueTickets).toHaveLength(1);
            expect(overdueTickets[0]?.id).toBe(ticket.id);
            expect(overdueTickets[0]?.overdue).toBe(true);
          }

          const persistedTicket = store.get(ticket.id);
          const escalations = store.listEscalations(ticket.id);
          const notifications = store.listSupervisorNotifications(ticket.id);
          const emittedNotifications = supervisorNotifier.listNotifications();

          expect(persistedTicket?.escalations).toHaveLength(1);
          expect(persistedTicket?.supervisorNotifications).toHaveLength(1);
          expect(escalations).toHaveLength(1);
          expect(notifications).toHaveLength(1);
          expect(emittedNotifications).toHaveLength(1);

          const escalation = escalations[0];
          const notification = notifications[0];
          const emittedNotification = emittedNotifications[0];

          expect(escalation).toBeDefined();
          expect(notification).toBeDefined();
          expect(emittedNotification).toBeDefined();
          expect(escalation?.ticketId).toBe(ticket.id);
          expect(escalation?.cycle).toBe(1);
          expect(notification?.ticketId).toBe(ticket.id);
          expect(notification?.cycle).toBe(1);
          expect(emittedNotification?.ticketId).toBe(ticket.id);
          expect(emittedNotification?.cycle).toBe(1);
          expect(escalation?.escalatedAt).toEqual(overdueAt);
          expect(escalation?.notifiedAt).toEqual(overdueAt);
          expect(notification?.notifiedAt).toEqual(overdueAt);
          expect(emittedNotification?.notifiedAt).toEqual(overdueAt);
        },
      ),
      { numRuns: 100 },
    );
  });
});
