import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Ticket, TicketStatus } from './types.js';
import { evaluateOverdueCycle, startOverdueCycle } from './temporal.js';

const terminalStatusArbitrary = fc.constantFrom<TicketStatus>('RESUELTO', 'CERRADO');
const timestampArbitrary = fc.integer({
  min: Date.parse('2020-01-01T00:00:00.000Z'),
  max: Date.parse('2030-01-01T00:00:00.000Z'),
});

const ticketWithHistoryArbitrary = fc
  .record({
    id: fc.string({ minLength: 1 }),
    status: terminalStatusArbitrary,
    dueAt: timestampArbitrary,
    cycle: fc.integer({ min: 1, max: 10 }),
    historyTime: timestampArbitrary,
  })
  .map(({ id, status, dueAt, cycle, historyTime }): Ticket => {
    const createdAt = new Date(dueAt - 1_000);
    const historicalEvents = Array.from({ length: cycle }, (_, index) => {
      const eventCycle = index + 1;
      const eventTime = new Date(historyTime + eventCycle);
      return {
        escalation: {
          ticketId: id,
          cycle: eventCycle,
          escalatedAt: new Date(eventTime),
          notifiedAt: new Date(eventTime),
        },
        notification: {
          ticketId: id,
          cycle: eventCycle,
          notifiedAt: new Date(eventTime),
        },
      };
    });

    return {
      id,
      title: 'Property ticket',
      description: 'Property ticket description',
      category: 'APLICACIONES',
      priority: 'MEDIA',
      requester: 'requester',
      responsibleId: 'agent-1',
      status,
      createdAt,
      updatedAt: new Date(createdAt),
      dueAt: new Date(dueAt),
      resolutionNote: status === 'RESUELTO' ? 'Resolved' : null,
      resolvedAt: status === 'RESUELTO' ? new Date(historyTime) : null,
      closedAt: status === 'CERRADO' ? new Date(historyTime) : null,
      overdue: true,
      overdueCycle: cycle,
      escalations: historicalEvents.map(({ escalation }) => escalation),
      supervisorNotifications: historicalEvents.map(({ notification }) => notification),
    };
  });

// Feature: ticket-expiry-supervisor-notifications, Property 6: La reapertura conserva la historia e inicia un ciclo
describe('Property 6: reopening preserves history and starts a cycle', () => {
  it('increments the cycle, resets overdue, and keeps historical events available', () => {
    fc.assert(
      fc.property(ticketWithHistoryArbitrary, (ticket) => {
        const historicalEscalations = structuredClone(ticket.escalations);
        const historicalNotifications = structuredClone(ticket.supervisorNotifications);
        const reopened = {
          ...startOverdueCycle(ticket),
          status: 'EN_PROGRESO' as const,
        };

        expect(reopened.overdueCycle).toBe(ticket.overdueCycle + 1);
        expect(reopened.overdue).toBe(false);
        expect(reopened.escalations).toEqual(historicalEscalations);
        expect(reopened.supervisorNotifications).toEqual(historicalNotifications);
        expect(ticket.overdueCycle).not.toBe(reopened.overdueCycle);

        const beforeDueAt = evaluateOverdueCycle(
          reopened,
          new Date(reopened.dueAt.getTime()),
        );
        expect(beforeDueAt.escalations).toEqual(historicalEscalations);
        expect(beforeDueAt.supervisorNotifications).toEqual(historicalNotifications);

        const afterDueAt = evaluateOverdueCycle(
          reopened,
          new Date(reopened.dueAt.getTime() + 1),
        );
        expect(afterDueAt.overdue).toBe(true);
        expect(afterDueAt.escalations).toHaveLength(historicalEscalations.length + 1);
        expect(afterDueAt.supervisorNotifications).toHaveLength(
          historicalNotifications.length + 1,
        );
        expect(afterDueAt.escalations.slice(0, historicalEscalations.length)).toEqual(
          historicalEscalations,
        );
        expect(
          afterDueAt.supervisorNotifications.slice(0, historicalNotifications.length),
        ).toEqual(historicalNotifications);
        expect(afterDueAt.escalations.at(-1)?.cycle).toBe(reopened.overdueCycle);
        expect(afterDueAt.supervisorNotifications.at(-1)?.cycle).toBe(
          reopened.overdueCycle,
        );
      }),
      { numRuns: 100 },
    );
  });
});
