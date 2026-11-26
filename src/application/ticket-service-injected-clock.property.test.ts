import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { InMemoryAgentDirectory } from '../infrastructure/in-memory-agent-directory.js';
import { InMemorySupervisorNotifier } from '../infrastructure/in-memory-supervisor-notifier.js';
import { InMemoryTicketStore } from '../infrastructure/in-memory-ticket-store.js';
import { FixedClock } from '../test-utils/index.js';
import { TicketService } from './ticket-service.js';

const CREATED_AT = new Date('2025-01-01T00:00:00.000Z');
const OVERDUE_AFTER_DUE_AT = fc.integer({ min: 1, max: 30 * 24 * 60 * 60 * 1000 });

class TestIdGenerator {
  private sequence = 0;

  next(): string {
    this.sequence += 1;
    return `ticket-${this.sequence}`;
  }
}

describe('TicketService injected clock', () => {
  // Feature: ticket-expiry-supervisor-notifications, Property 7: El instante inyectado gobierna el cálculo y los registros.
  it('uses the controlled Clock instant for overdue state and notification timestamps', () => {
    fc.assert(
      fc.property(OVERDUE_AFTER_DUE_AT, (millisecondsAfterDueAt) => {
        const clock = new FixedClock(CREATED_AT);
        const notifier = new InMemorySupervisorNotifier();
        const store = new InMemoryTicketStore();
        const service = new TicketService({
          agentDirectory: new InMemoryAgentDirectory(),
          clock,
          idGenerator: new TestIdGenerator(),
          store,
          supervisorNotifier: notifier,
        });

        const created = service.create({
          title: 'VPN access',
          description: 'Cannot connect from the office',
          category: 'ACCESOS',
          priority: 'CRITICA',
          requester: 'user-123',
        });
        const evaluationInstant = new Date(
          created.dueAt.getTime() + millisecondsAfterDueAt,
        );
        clock.set(evaluationInstant);

        const evaluated = service.get(created.id);
        const escalations = store.listEscalations(created.id);
        const notifications = store.listSupervisorNotifications(created.id);
        const emitted = notifier.listNotifications();

        expect(evaluated.overdue).toBe(true);
        expect(escalations).toHaveLength(1);
        expect(notifications).toHaveLength(1);
        expect(emitted).toHaveLength(1);
        expect(escalations[0]?.escalatedAt).toEqual(evaluationInstant);
        expect(escalations[0]?.notifiedAt).toEqual(evaluationInstant);
        expect(notifications[0]?.notifiedAt).toEqual(evaluationInstant);
        expect(emitted[0]?.notifiedAt).toEqual(evaluationInstant);
      }),
      { numRuns: 100 },
    );
  });
});
