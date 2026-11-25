import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TicketStatus } from '../domain/types.js';
import { InMemoryAgentDirectory } from '../infrastructure/in-memory-agent-directory.js';
import { InMemoryTicketStore } from '../infrastructure/in-memory-ticket-store.js';
import { FixedClock } from '../test-utils/index.js';
import { TicketService } from './ticket-service.js';

const CREATED_AT = new Date('2025-01-01T00:00:00.000Z');
const TICKET_STATUSES: readonly TicketStatus[] = [
  'NUEVO',
  'ASIGNADO',
  'EN_PROGRESO',
  'EN_ESPERA',
  'RESUELTO',
  'CERRADO',
];

class TestIdGenerator {
  next(): string {
    return 'ticket-assignment-property';
  }
}

const statusArbitrary = fc.constantFrom(...TICKET_STATUSES);
const activeAgentArbitrary = fc
  .integer({ min: 1, max: 10_000 })
  .map((number) => `active-agent-${number}`);

function createService(status: TicketStatus, responsibleId: string) {
  const store = new InMemoryTicketStore();
  const clock = new FixedClock(CREATED_AT);
  const service = new TicketService({
    agentDirectory: new InMemoryAgentDirectory({
      actors: [
        { id: responsibleId, role: 'AGENT', active: true },
        { id: 'supervisor-1', role: 'SUPERVISOR', active: true },
      ],
    }),
    clock,
    idGenerator: new TestIdGenerator(),
    store,
  });
  const created = service.create({
    title: 'VPN access',
    description: 'Cannot connect from the office',
    category: 'ACCESOS',
    priority: 'ALTA',
    requester: 'user-123',
  });

  if (status !== 'NUEVO') {
    store.save({ ...created, status });
  }

  return { service, ticketId: created.id };
}

describe('TicketService assignment property', () => {
  it('stores active agents and applies only NUEVO to ASIGNADO automatically', () => {
    // Feature: ticketops-api, Property 6: La asignación aplica sólo la transición automática definida
    fc.assert(
      fc.property(statusArbitrary, activeAgentArbitrary, (status, responsibleId) => {
        const { service, ticketId } = createService(status, responsibleId);
        const assigned = service.assign(ticketId, responsibleId, 'supervisor-1');

        expect(assigned.responsibleId).toBe(responsibleId);
        expect(assigned.status).toBe(status === 'NUEVO' ? 'ASIGNADO' : status);
      }),
      { numRuns: 100 },
    );
  });
});
