import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Category, Priority } from '../domain/types.js';
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
const ACTIVE_AGENT = 'agent-1';
const SUPERVISOR = 'supervisor-1';

function createService(clock: FixedClock): TicketService {
  return new TicketService({
    agentDirectory: new InMemoryAgentDirectory(),
    clock,
    idGenerator: new TestIdGenerator(),
    store: new InMemoryTicketStore(),
    supervisorNotifier: new InMemorySupervisorNotifier(),
  });
}

function createTicket(service: TicketService) {
  return service.create({
    title: 'VPN access',
    description: 'Cannot connect from the office',
    category: 'ACCESOS' as Category,
    priority: 'ALTA' as Priority,
    requester: 'user-123',
  });
}

describe('TicketService timestamp mutations', () => {
  // Feature: ticketops-api, Property 9: Las mutaciones reales actualizan el timestamp
  it('sets updatedAt to the later FixedClock instant for valid assignments and real transitions', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.integer({ min: 1, max: 7 * 24 * 60 * 60 * 1000 }),
        (usesStatusTransition, elapsedMilliseconds) => {
          const clock = new FixedClock(CREATED_AT);
          const service = createService(clock);
          const created = createTicket(service);

          clock.advanceBy(elapsedMilliseconds);
          const mutation = usesStatusTransition
            ? (() => {
                service.assign(created.id, ACTIVE_AGENT, SUPERVISOR);
                return service.changeStatus(
                  created.id,
                  'EN_PROGRESO',
                  undefined,
                  ACTIVE_AGENT,
                );
              })()
            : service.assign(created.id, ACTIVE_AGENT, SUPERVISOR);

          const laterInstant = clock.now();

          expect(laterInstant.getTime()).toBeGreaterThan(
            created.updatedAt.getTime(),
          );
          expect(mutation.updatedAt).toEqual(laterInstant);
        },
      ),
      { numRuns: 100 },
    );
  });
});
