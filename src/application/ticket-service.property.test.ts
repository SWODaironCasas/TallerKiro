import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Category, Priority, Ticket, TicketStatus } from '../domain/types.js';
import { InMemoryAgentDirectory } from '../infrastructure/in-memory-agent-directory.js';
import { InMemoryTicketStore } from '../infrastructure/in-memory-ticket-store.js';
import { FixedClock } from '../test-utils/index.js';
import { TicketService, type CreateTicketInput } from './ticket-service.js';

const CREATED_AT = new Date('2025-01-01T00:00:00.000Z');

const STATUSES: readonly TicketStatus[] = [
  'NUEVO',
  'ASIGNADO',
  'EN_PROGRESO',
  'EN_ESPERA',
  'RESUELTO',
  'CERRADO',
];

const ticketStatusArbitrary = fc.constantFrom(...STATUSES);
const categoryArbitrary = fc.constantFrom<Category>(
  'INFRAESTRUCTURA',
  'ACCESOS',
  'APLICACIONES',
  'INSTALACIONES',
);
const priorityArbitrary = fc.constantFrom<Priority>(
  'CRITICA',
  'ALTA',
  'MEDIA',
  'BAJA',
);
const nonEmptyTextArbitrary = fc
  .string({ minLength: 1, maxLength: 32 })
  .filter((value) => value.trim().length > 0);

const ticketInputArbitrary: fc.Arbitrary<CreateTicketInput> = fc.record({
  title: nonEmptyTextArbitrary,
  description: nonEmptyTextArbitrary,
  category: categoryArbitrary,
  priority: priorityArbitrary,
  requester: nonEmptyTextArbitrary,
});

class TestIdGenerator {
  private sequence = 0;

  next(): string {
    this.sequence += 1;
    return `ticket-${this.sequence}`;
  }
}

function createService(clock: FixedClock) {
  const store = new InMemoryTicketStore();
  const service = new TicketService({
    agentDirectory: new InMemoryAgentDirectory(),
    clock,
    idGenerator: new TestIdGenerator(),
    store,
  });

  return { service, store };
}

function prepareTicket(
  service: TicketService,
  input: CreateTicketInput,
  targetStatus: TicketStatus,
): Ticket {
  const created = service.create(input);
  if (targetStatus === 'NUEVO') {
    return created;
  }

  service.assign(created.id, 'agent-1', 'supervisor-1');
  if (targetStatus === 'ASIGNADO') {
    return service.get(created.id);
  }

  service.changeStatus(created.id, 'EN_PROGRESO', undefined, 'agent-1');
  if (targetStatus === 'EN_PROGRESO') {
    return service.get(created.id);
  }

  if (targetStatus === 'EN_ESPERA') {
    service.changeStatus(created.id, 'EN_ESPERA', undefined, 'agent-1');
    return service.get(created.id);
  }

  service.changeStatus(created.id, 'RESUELTO', 'Resolution recorded', 'agent-1');
  if (targetStatus === 'RESUELTO') {
    return service.get(created.id);
  }

  service.changeStatus(created.id, 'CERRADO', undefined, 'supervisor-1');
  return service.get(created.id);
}

describe('TicketService Property 8: no-op and history invariants', () => {
  it('keeps status, ticket content, and history unchanged for same-status operations', () => {
    // Feature: ticketops-api, Property 8: Las operaciones sin cambio no añaden historial.
    fc.assert(
      fc.property(ticketInputArbitrary, ticketStatusArbitrary, (input, status) => {
        const clock = new FixedClock(CREATED_AT);
        const { service, store } = createService(clock);
        const before = prepareTicket(service, input, status);
        const historyBefore = store.listHistory(before.id);

        const result = service.changeStatus(
          before.id,
          status,
          undefined,
          'supervisor-1',
        );

        expect(result.status).toBe(before.status);
        expect(result).toEqual(before);
        expect(store.listHistory(before.id)).toEqual(historyBefore);
        expect(store.listHistory(before.id)).toHaveLength(historyBefore.length);
      }),
      { numRuns: 100 },
    );
  });

  it('limits a reassignment without a state change to responsibleId and updatedAt', () => {
    // Feature: ticketops-api, Property 8: Las operaciones sin cambio no añaden historial.
    fc.assert(
      fc.property(
        ticketInputArbitrary,
        fc.constantFrom<TicketStatus>(
          'ASIGNADO',
          'EN_PROGRESO',
          'EN_ESPERA',
          'RESUELTO',
          'CERRADO',
        ),
        fc.integer({ min: 1, max: 60 * 60 * 1000 }),
        (input, status, elapsedMilliseconds) => {
          const clock = new FixedClock(CREATED_AT);
          const { service, store } = createService(clock);
          const before = prepareTicket(service, input, status);
          const historyBefore = store.listHistory(before.id);
          clock.advanceBy(elapsedMilliseconds);
          const expectedUpdatedAt = clock.now();

          const result = service.assign(
            before.id,
            'agent-2',
            'supervisor-1',
          );

          expect(result.status).toBe(before.status);
          expect(result).toEqual({
            ...before,
            responsibleId: 'agent-2',
            updatedAt: expectedUpdatedAt,
          });
          expect(store.listHistory(before.id)).toEqual(historyBefore);
          expect(store.listHistory(before.id)).toHaveLength(historyBefore.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
