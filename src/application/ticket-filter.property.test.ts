import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Category, Priority, TicketStatus } from '../domain/types.js';
import { InMemoryAgentDirectory } from '../infrastructure/in-memory-agent-directory.js';
import { InMemorySupervisorNotifier } from '../infrastructure/in-memory-supervisor-notifier.js';
import { InMemoryTicketStore } from '../infrastructure/in-memory-ticket-store.js';
import { FixedClock } from '../test-utils/index.js';
import { TicketService, type TicketFilters } from './ticket-service.js';

const CATEGORIES: readonly Category[] = [
  'INFRAESTRUCTURA',
  'ACCESOS',
  'APLICACIONES',
  'INSTALACIONES',
];

const PRIORITIES: readonly Priority[] = ['CRITICA', 'ALTA', 'MEDIA', 'BAJA'];

const STATUSES: readonly TicketStatus[] = [
  'NUEVO',
  'ASIGNADO',
  'EN_PROGRESO',
  'EN_ESPERA',
  'RESUELTO',
  'CERRADO',
];

interface TicketSeed {
  category: Category;
  priority: Priority;
  status: TicketStatus;
}

class TestIdGenerator {
  private sequence = 0;

  next(): string {
    this.sequence += 1;
    return `ticket-${this.sequence}`;
  }
}

const ticketSeedArbitrary: fc.Arbitrary<TicketSeed> = fc.record({
  category: fc.constantFrom(...CATEGORIES),
  priority: fc.constantFrom(...PRIORITIES),
  status: fc.constantFrom(...STATUSES),
});

const ticketFiltersArbitrary: fc.Arbitrary<TicketFilters> = fc.record({
  category: fc.option(fc.constantFrom(...CATEGORIES), { nil: undefined }),
  status: fc.option(fc.constantFrom(...STATUSES), { nil: undefined }),
  priority: fc.option(fc.constantFrom(...PRIORITIES), { nil: undefined }),
});

function createService() {
  const store = new InMemoryTicketStore();
  const clock = new FixedClock(new Date('2025-01-01T00:00:00.000Z'));
  const service = new TicketService({
    agentDirectory: new InMemoryAgentDirectory(),
    clock,
    idGenerator: new TestIdGenerator(),
    store,
    supervisorNotifier: new InMemorySupervisorNotifier(),
  });

  return { service, store };
}

describe('Property 5: ticket filters use intersection semantics', () => {
  it('returns exactly the tickets matching every supplied filter', () => {
    // Feature: ticketops-api, Property 5: Los filtros se aplican por intersección
    fc.assert(
      fc.property(
        fc.array(ticketSeedArbitrary, { maxLength: 30 }),
        ticketFiltersArbitrary,
        (seeds, filters) => {
          const { service, store } = createService();
          const tickets = seeds.map((seed, index) => {
            const created = service.create({
              title: `Generated ticket ${index}`,
              description: 'Generated for filter property testing',
              category: seed.category,
              priority: seed.priority,
              requester: `requester-${index}`,
            });
            const ticket = { ...created, status: seed.status };
            store.save(ticket);
            return ticket;
          });

          const expected = tickets.filter(
            (ticket) =>
              (filters.category === undefined ||
                ticket.category === filters.category) &&
              (filters.status === undefined || ticket.status === filters.status) &&
              (filters.priority === undefined ||
                ticket.priority === filters.priority),
          );
          const actual = service.list(filters);

          expect(actual).toEqual(expected);
          expect(actual.map((ticket) => ticket.id)).toEqual(
            expected.map((ticket) => ticket.id),
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
