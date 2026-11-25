import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calculateDueAt } from './sla.js';
import type { Category, Priority, Ticket } from './types.js';
import type { Clock, IdGenerator } from '../infrastructure/contracts.js';
import { FixedClock } from '../test-utils/index.js';

// Feature: ticketops-api, Property 1: Creación conserva invariantes y campos obligatorios

type CreateTicketInput = Pick<
  Ticket,
  'title' | 'description' | 'category' | 'priority' | 'requester'
>;

/**
 * Test-only creation subject until TicketService exists.
 * It uses the current domain contracts without implementing a later service.
 */
function createTicketForProperty(
  input: CreateTicketInput,
  clock: Clock,
  idGenerator: IdGenerator,
): Ticket {
  const createdAt = clock.now();

  return {
    ...input,
    id: idGenerator.next(),
    responsibleId: null,
    status: 'NUEVO',
    createdAt,
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
}

class OpaqueIdGenerator implements IdGenerator {
  private nextId = 0;

  next(): string {
    this.nextId += 1;
    return `opaque-ticket-${this.nextId}`;
  }
}

const validTextArbitrary = fc
  .string({ minLength: 1, maxLength: 120 })
  .filter((value) => value.trim() === value);

const createTicketInputArbitrary: fc.Arbitrary<CreateTicketInput> = fc.record({
  title: validTextArbitrary,
  description: validTextArbitrary,
  category: fc.constantFrom<Category>(
    'INFRAESTRUCTURA',
    'ACCESOS',
    'APLICACIONES',
    'INSTALACIONES',
  ),
  priority: fc.constantFrom<Priority>('CRITICA', 'ALTA', 'MEDIA', 'BAJA'),
  requester: validTextArbitrary,
});

function expectValidDate(value: Date): void {
  expect(value).toBeInstanceOf(Date);
  expect(Number.isNaN(value.getTime())).toBe(false);
  expect(value.toISOString()).toEqual(expect.any(String));
}

describe('Property 1: ticket creation invariants', () => {
  it('preserves required fields and initializes a new ticket invariantly', () => {
    const idGenerator = new OpaqueIdGenerator();
    const seenIds = new Set<string>();

    fc.assert(
      fc.property(createTicketInputArbitrary, (input) => {
        const ticket = createTicketForProperty(
          input,
          new FixedClock(new Date('2025-01-01T00:00:00.000Z')),
          idGenerator,
        );

        expect(ticket.title).toBe(input.title);
        expect(ticket.description).toBe(input.description);
        expect(ticket.category).toBe(input.category);
        expect(ticket.priority).toBe(input.priority);
        expect(ticket.requester).toBe(input.requester);
        expect(ticket.status).toBe('NUEVO');

        expect(typeof ticket.id).toBe('string');
        expect(ticket.id.length).toBeGreaterThan(0);
        expect(seenIds.has(ticket.id)).toBe(false);
        seenIds.add(ticket.id);

        expectValidDate(ticket.createdAt);
        expectValidDate(ticket.updatedAt);
        expectValidDate(ticket.dueAt);
        expect(ticket.responsibleId).toBeNull();
      }),
      { numRuns: 100 },
    );
  });
});
