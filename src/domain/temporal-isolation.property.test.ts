import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evaluateOverdueCycle } from './temporal.js';
import type { Ticket } from './types.js';
import { InMemoryTicketStore } from '../infrastructure/in-memory-ticket-store.js';

const timestampArbitrary = fc.integer({
  min: Date.parse('2020-01-01T00:00:00.000Z'),
  max: Date.parse('2030-01-01T00:00:00.000Z'),
});

const ticketArbitrary: fc.Arbitrary<Ticket> = fc
  .record({
    id: fc.stringMatching(/^ticket-[a-z0-9]{1,12}$/),
    createdAt: timestampArbitrary,
    dueAt: timestampArbitrary,
    cycle: fc.integer({ min: 1, max: 10 }),
    eventTime: timestampArbitrary,
  })
  .map(({ id, createdAt, dueAt, cycle, eventTime }) => {
    const created = new Date(createdAt);
    const due = new Date(dueAt);
    const event = new Date(eventTime);

    return {
      id,
      title: 'Generated ticket',
      description: 'Generated description',
      category: 'INFRAESTRUCTURA',
      priority: 'MEDIA',
      requester: 'requester-1',
      responsibleId: 'agent-1',
      status: 'EN_PROGRESO',
      createdAt: created,
      updatedAt: new Date(created),
      dueAt: due,
      resolutionNote: null,
      resolvedAt: null,
      closedAt: null,
      overdue: false,
      overdueCycle: cycle,
      escalations: [
        {
          ticketId: id,
          cycle,
          escalatedAt: new Date(event),
          notifiedAt: new Date(event),
        },
      ],
      supervisorNotifications: [
        {
          ticketId: id,
          cycle,
          notifiedAt: new Date(event),
        },
      ],
    } satisfies Ticket;
  });

describe('Property 4: overdue evaluation preserves isolation', () => {
  it('does not share nested dates or records between input, result, and stored data', () => {
    // Feature: ticket-expiry-supervisor-notifications, Property 4: La evaluación no muta la entrada
    fc.assert(
      fc.property(ticketArbitrary, timestampArbitrary, (ticket, nowTimestamp) => {
        const store = new InMemoryTicketStore();
        const evaluated = evaluateOverdueCycle(ticket, new Date(nowTimestamp));
        store.save(evaluated);

        const evaluatedSnapshot = structuredClone(evaluated);
        const storedSnapshot = store.get(ticket.id);

        ticket.dueAt.setTime(0);
        ticket.updatedAt.setTime(0);
        ticket.escalations[0].notifiedAt.setTime(0);
        ticket.supervisorNotifications[0].notifiedAt.setTime(0);
        const inputAfterMutation = structuredClone(ticket);

        expect(evaluated).toEqual(evaluatedSnapshot);
        expect(ticket).toEqual(inputAfterMutation);

        evaluated.dueAt.setTime(0);
        evaluated.escalations[0].escalatedAt.setTime(0);
        evaluated.supervisorNotifications[0].notifiedAt.setTime(0);

        expect(ticket).toEqual(inputAfterMutation);
        expect(store.get(ticket.id)).toEqual(storedSnapshot);
      }),
      { numRuns: 100 },
    );
  });
});
