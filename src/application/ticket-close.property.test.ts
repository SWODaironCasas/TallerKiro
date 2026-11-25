import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { InvalidTransitionError } from '../domain/errors.js';
import type { TicketStatus } from '../domain/types.js';
import { InMemoryAgentDirectory } from '../infrastructure/in-memory-agent-directory.js';
import { InMemoryTicketStore } from '../infrastructure/in-memory-ticket-store.js';
import { FixedClock } from '../test-utils/index.js';
import { TicketService } from './ticket-service.js';

const CREATED_AT = new Date('2025-01-01T00:00:00.000Z');

const closureOriginArbitrary = fc.constantFrom<TicketStatus>(
  'NUEVO',
  'ASIGNADO',
  'EN_PROGRESO',
  'EN_ESPERA',
  'RESUELTO',
);

const nonResolvedClosureOriginArbitrary = fc.constantFrom<TicketStatus>(
  'NUEVO',
  'ASIGNADO',
  'EN_PROGRESO',
  'EN_ESPERA',
);

class TestIdGenerator {
  next(): string {
    return 'ticket-1';
  }
}

function createService(): {
  clock: FixedClock;
  service: TicketService;
  store: InMemoryTicketStore;
} {
  const clock = new FixedClock(CREATED_AT);
  const store = new InMemoryTicketStore();
  const service = new TicketService({
    agentDirectory: new InMemoryAgentDirectory(),
    clock,
    idGenerator: new TestIdGenerator(),
    store,
  });

  return { clock, service, store };
}

function createTicketAtStatus(
  service: TicketService,
  status: TicketStatus,
): string {
  const created = service.create({
    title: 'VPN access',
    description: 'Cannot connect from the office',
    category: 'ACCESOS',
    priority: 'ALTA',
    requester: 'user-123',
  });

  if (status === 'NUEVO') {
    return created.id;
  }

  service.assign(created.id, 'agent-1', 'supervisor-1');
  if (status === 'ASIGNADO') {
    return created.id;
  }

  service.changeStatus(created.id, 'EN_PROGRESO', undefined, 'agent-1');
  if (status === 'EN_PROGRESO') {
    return created.id;
  }

  if (status === 'EN_ESPERA') {
    service.changeStatus(created.id, 'EN_ESPERA', undefined, 'agent-1');
    return created.id;
  }

  service.changeStatus(
    created.id,
    'RESUELTO',
    'Resolution recorded',
    'agent-1',
  );
  return created.id;
}

// Feature: ticketops-api, Property 11: Cerrar respeta la precondición de resolución.

describe('Property 11: closure requires a resolved ticket', () => {
  it('accepts only RESUELTO -> CERRADO and records closedAt', () => {
    fc.assert(
      fc.property(closureOriginArbitrary, (originStatus) => {
        const { clock, service } = createService();
        const ticketId = createTicketAtStatus(service, originStatus);
        const before = service.get(ticketId);

        if (originStatus === 'RESUELTO') {
          clock.advanceBy(1_000);
          const expectedClosedAt = clock.now();
          const closed = service.changeStatus(
            ticketId,
            'CERRADO',
            undefined,
            'supervisor-1',
          );

          expect(closed.status).toBe('CERRADO');
          expect(closed.closedAt).toEqual(expectedClosedAt);
          expect(closed.closedAt).toBeInstanceOf(Date);
          expect(closed.resolvedAt).toEqual(before.resolvedAt);
          return;
        }

        expect(() =>
          service.changeStatus(
            ticketId,
            'CERRADO',
            undefined,
            'supervisor-1',
          ),
        ).toThrow(InvalidTransitionError);
        expect(service.get(ticketId)).toEqual(before);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects every non-resolved origin without mutating the ticket or history', () => {
    fc.assert(
      fc.property(nonResolvedClosureOriginArbitrary, (originStatus) => {
        const { service, store } = createService();
        const ticketId = createTicketAtStatus(service, originStatus);
        const before = service.get(ticketId);
        const historyBefore = store.listHistory(ticketId);

        expect(() =>
          service.changeStatus(
            ticketId,
            'CERRADO',
            undefined,
            'supervisor-1',
          ),
        ).toThrow(InvalidTransitionError);

        expect(service.get(ticketId)).toEqual(before);
        expect(store.listHistory(ticketId)).toEqual(historyBefore);
      }),
      { numRuns: 100 },
    );
  });
});
