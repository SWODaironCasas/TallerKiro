import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TicketStatus } from '../domain/types.js';
import { InMemoryAgentDirectory } from '../infrastructure/in-memory-agent-directory.js';
import { InMemoryTicketStore } from '../infrastructure/in-memory-ticket-store.js';
import { FixedClock } from '../test-utils/index.js';
import { TicketService } from './ticket-service.js';

const CREATED_AT = new Date('2025-01-01T00:00:00.000Z');
const HISTORY_ACTOR_IDS = [
  'history-actor-1',
  'history-actor-2',
  'history-actor-3',
  'history-actor-4',
  'history-actor-5',
] as const;

type TransitionStep = {
  readonly transitionChoice: number;
  readonly actorIndex: number;
  readonly offsetMilliseconds: number;
};

type ExpectedHistoryEntry = {
  readonly sequence: number;
  readonly ticketId: string;
  readonly from: TicketStatus;
  readonly to: TicketStatus;
  readonly changedAt: Date;
  readonly actorId: string;
};

const transitionTargets: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  NUEVO: ['ASIGNADO'],
  ASIGNADO: ['EN_PROGRESO'],
  EN_PROGRESO: ['EN_ESPERA', 'RESUELTO'],
  EN_ESPERA: ['EN_PROGRESO', 'RESUELTO'],
  RESUELTO: ['CERRADO', 'EN_PROGRESO'],
  CERRADO: ['EN_PROGRESO'],
};

const transitionSequenceArbitrary: fc.Arbitrary<TransitionStep[]> = fc.array(
  fc.record({
    transitionChoice: fc.nat(),
    actorIndex: fc.integer({ min: 0, max: HISTORY_ACTOR_IDS.length - 1 }),
    offsetMilliseconds: fc.nat({ max: 1_000 }),
  }),
  { minLength: 1, maxLength: 30 },
);

class TestIdGenerator {
  next(): string {
    return 'ticket-history-property';
  }
}

function nextTarget(status: TicketStatus, transitionChoice: number): TicketStatus {
  const targets = transitionTargets[status];
  return targets[transitionChoice % targets.length] as TicketStatus;
}

function createHistoryFixture(): {
  clock: FixedClock;
  service: TicketService;
  store: InMemoryTicketStore;
  ticketId: string;
} {
  const clock = new FixedClock(CREATED_AT);
  const store = new InMemoryTicketStore();
  const service = new TicketService({
    agentDirectory: new InMemoryAgentDirectory({
      actors: HISTORY_ACTOR_IDS.map((id) => ({
        id,
        role: 'AGENT' as const,
        active: true,
      })),
    }),
    clock,
    idGenerator: new TestIdGenerator(),
    store,
  });
  const created = service.create({
    title: 'History property ticket',
    description: 'Exercises attributable state history',
    category: 'APLICACIONES',
    priority: 'BAJA',
    requester: 'history-requester',
  });

  return { clock, service, store, ticketId: created.id };
}

function compareHistoryEntries(
  left: ExpectedHistoryEntry,
  right: ExpectedHistoryEntry,
): number {
  return (
    left.changedAt.getTime() - right.changedAt.getTime() ||
    left.sequence - right.sequence
  );
}

describe('TicketService Property 15: attributable ordered history', () => {
  it('records every valid real change with its actor and chronological sequence', () => {
    // Feature: ticketops-api, Property 15: Cada cambio real genera historial ordenado y atribuible
    fc.assert(
      fc.property(transitionSequenceArbitrary, (steps) => {
        const { clock, service, store, ticketId } = createHistoryFixture();
        const expectedEntries: ExpectedHistoryEntry[] = [];
        let currentStatus: TicketStatus = 'NUEVO';

        steps.forEach((step, index) => {
          const changedAt = new Date(
            CREATED_AT.getTime() + step.offsetMilliseconds,
          );
          const target = nextTarget(currentStatus, step.transitionChoice);
          const actorId = HISTORY_ACTOR_IDS[step.actorIndex];

          clock.set(changedAt);
          service.changeStatus(
            ticketId,
            target,
            target === 'RESUELTO' ? `Resolution ${index}` : undefined,
            actorId,
          );

          expectedEntries.push({
            sequence: index + 1,
            ticketId,
            from: currentStatus,
            to: target,
            changedAt,
            actorId,
          });
          currentStatus = target;
        });

        const history = store.listHistory(ticketId);
        const expectedInHistoryOrder = [...expectedEntries].sort(
          compareHistoryEntries,
        );

        expect(history).toHaveLength(steps.length);
        expect(history).toEqual(expectedInHistoryOrder);
        expect(history).toEqual(
          [...history].sort((left, right) => {
            return (
              left.changedAt.getTime() - right.changedAt.getTime() ||
              left.sequence - right.sequence
            );
          }),
        );
      }),
      { numRuns: 100 },
    );
  });
});
