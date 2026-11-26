import { describe, expect, it } from 'vitest';
import { evaluateOverdueCycle, isOverdueAt } from './temporal.js';
import type { Ticket, TicketStatus } from './types.js';

const dueAt = new Date('2025-01-01T08:00:00.000Z');
const now = new Date('2025-01-01T09:00:00.000Z');

function makeTicket(status: TicketStatus = 'EN_PROGRESO'): Ticket {
  const createdAt = new Date('2025-01-01T00:00:00.000Z');
  return {
    id: 'ticket-1',
    title: 'Network interruption',
    description: 'The office network is unavailable.',
    category: 'INFRAESTRUCTURA',
    priority: 'ALTA',
    requester: 'requester-1',
    responsibleId: 'agent-1',
    status,
    createdAt,
    updatedAt: new Date(createdAt),
    dueAt: new Date(dueAt),
    resolutionNote: null,
    resolvedAt: null,
    closedAt: null,
    overdue: false,
    overdueCycle: 1,
    escalations: [],
    supervisorNotifications: [],
  };
}

describe('temporal overdue rules', () => {
  it.each([
    ['before dueAt', new Date(dueAt.getTime() - 1), false],
    ['exactly at dueAt', new Date(dueAt), false],
    ['after dueAt', new Date(dueAt.getTime() + 1), true],
  ])('uses strict comparison for %s', (_case, instant, expected) => {
    expect(isOverdueAt(instant, dueAt, 'EN_PROGRESO')).toBe(expected);
  });

  it.each(['RESUELTO', 'CERRADO'] as const)(
    'does not create overdue events for terminal status %s',
    (status) => {
      const ticket = makeTicket(status);
      const evaluated = evaluateOverdueCycle(ticket, now);

      expect(evaluated.overdue).toBe(false);
      expect(evaluated.escalations).toEqual([]);
      expect(evaluated.supervisorNotifications).toEqual([]);
    },
  );

  it('does not create events before or exactly at dueAt', () => {
    for (const instant of [
      new Date(dueAt.getTime() - 1),
      new Date(dueAt),
    ]) {
      const evaluated = evaluateOverdueCycle(makeTicket(), instant);

      expect(evaluated.overdue).toBe(false);
      expect(evaluated.escalations).toEqual([]);
      expect(evaluated.supervisorNotifications).toEqual([]);
    }
  });

  it('creates one event pair after dueAt and preserves existing events', () => {
    const ticket = makeTicket();
    ticket.escalations.push({
      ticketId: ticket.id,
      cycle: 1,
      escalatedAt: new Date('2025-01-01T08:30:00.000Z'),
      notifiedAt: new Date('2025-01-01T08:30:00.000Z'),
    });
    ticket.supervisorNotifications.push({
      ticketId: ticket.id,
      cycle: 1,
      notifiedAt: new Date('2025-01-01T08:30:00.000Z'),
    });
    ticket.overdue = true;

    const evaluated = evaluateOverdueCycle(ticket, now);

    expect(evaluated.overdue).toBe(true);
    expect(evaluated.escalations).toHaveLength(1);
    expect(evaluated.supervisorNotifications).toHaveLength(1);
    expect(evaluated.escalations[0]).toEqual(ticket.escalations[0]);
    expect(evaluated.supervisorNotifications[0]).toEqual(
      ticket.supervisorNotifications[0],
    );
  });

  it('does not mutate the input and isolates nested dates and event records', () => {
    const ticket = makeTicket();
    const evaluated = evaluateOverdueCycle(ticket, now);

    expect(evaluated).not.toBe(ticket);
    expect(evaluated.dueAt).not.toBe(ticket.dueAt);
    expect(evaluated.escalations).not.toBe(ticket.escalations);
    expect(evaluated.supervisorNotifications).not.toBe(
      ticket.supervisorNotifications,
    );

    evaluated.dueAt.setTime(0);
    evaluated.escalations[0].notifiedAt.setTime(0);
    evaluated.supervisorNotifications[0].notifiedAt.setTime(0);

    expect(ticket.dueAt.toISOString()).toBe(dueAt.toISOString());
    expect(ticket.escalations).toEqual([]);
    expect(ticket.supervisorNotifications).toEqual([]);
  });
});
