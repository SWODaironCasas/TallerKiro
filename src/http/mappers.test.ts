import { describe, expect, it } from 'vitest';
import type { Ticket } from '../domain/index.js';
import {
  mapEscalationToResponse,
  mapSupervisorNotificationToResponse,
  mapTicketToResponse,
} from './mappers.js';

function ticketWithEvents(
  escalations: Ticket['escalations'] = [],
  supervisorNotifications: Ticket['supervisorNotifications'] = [],
): Ticket {
  return {
    id: 'ticket-42',
    title: 'Printer unavailable',
    description: 'The shared printer is unavailable.',
    category: 'EQUIPOS',
    priority: 'MEDIA',
    requester: 'requester-7',
    responsibleId: null,
    status: 'EN_PROGRESO',
    createdAt: new Date('2025-03-01T10:11:12.013Z'),
    updatedAt: new Date('2025-03-01T10:12:13.014Z'),
    dueAt: new Date('2025-03-01T18:12:13.015Z'),
    resolutionNote: null,
    resolvedAt: null,
    closedAt: null,
    overdue: escalations.length > 0,
    overdueCycle: 3,
    escalations,
    supervisorNotifications,
  };
}

describe('HTTP mappers', () => {
  it('maps a ticket without events to empty event collections', () => {
    const response = mapTicketToResponse(ticketWithEvents());

    expect(response.escalations).toEqual([]);
    expect(response.supervisorNotifications).toEqual([]);
    expect(response.overdue).toBe(false);
    expect(response.overdueCycle).toBe(3);
  });

  it('preserves identifiers and cycles while mapping multiple events', () => {
    const escalations: Ticket['escalations'] = [
      {
        ticketId: 'ticket-42',
        cycle: 1,
        escalatedAt: new Date('2025-03-01T19:20:21.016Z'),
        notifiedAt: new Date('2025-03-01T19:20:22.017Z'),
      },
      {
        ticketId: 'ticket-42',
        cycle: 3,
        escalatedAt: new Date('2025-03-02T19:20:21.018Z'),
        notifiedAt: new Date('2025-03-02T19:20:22.019Z'),
      },
    ];
    const notifications: Ticket['supervisorNotifications'] = [
      {
        ticketId: 'ticket-42',
        cycle: 1,
        notifiedAt: new Date('2025-03-01T19:20:22.017Z'),
      },
      {
        ticketId: 'ticket-42',
        cycle: 3,
        notifiedAt: new Date('2025-03-02T19:20:22.019Z'),
      },
    ];

    const response = mapTicketToResponse(
      ticketWithEvents(escalations, notifications),
    );

    expect(response.id).toBe('ticket-42');
    expect(response.escalations).toEqual([
      {
        ticketId: 'ticket-42',
        cycle: 1,
        escalatedAt: '2025-03-01T19:20:21.016Z',
        notifiedAt: '2025-03-01T19:20:22.017Z',
      },
      {
        ticketId: 'ticket-42',
        cycle: 3,
        escalatedAt: '2025-03-02T19:20:21.018Z',
        notifiedAt: '2025-03-02T19:20:22.019Z',
      },
    ]);
    expect(response.supervisorNotifications).toEqual([
      {
        ticketId: 'ticket-42',
        cycle: 1,
        notifiedAt: '2025-03-01T19:20:22.017Z',
      },
      {
        ticketId: 'ticket-42',
        cycle: 3,
        notifiedAt: '2025-03-02T19:20:22.019Z',
      },
    ]);
  });

  it('serializes event dates with millisecond precision as UTC ISO strings', () => {
    const escalation = {
      ticketId: 'ticket-42',
      cycle: 3,
      escalatedAt: new Date('2025-03-01T19:20:21.016Z'),
      notifiedAt: new Date('2025-03-01T19:20:22.017Z'),
    };
    const notification = {
      ticketId: 'ticket-42',
      cycle: 3,
      notifiedAt: new Date('2025-03-01T19:20:22.017Z'),
    };

    expect(mapEscalationToResponse(escalation)).toEqual({
      ticketId: 'ticket-42',
      cycle: 3,
      escalatedAt: '2025-03-01T19:20:21.016Z',
      notifiedAt: '2025-03-01T19:20:22.017Z',
    });
    expect(mapSupervisorNotificationToResponse(notification)).toEqual({
      ticketId: 'ticket-42',
      cycle: 3,
      notifiedAt: '2025-03-01T19:20:22.017Z',
    });
  });

  it('propagates an invalid event date instead of hiding it', () => {
    const invalidEscalation = {
      ticketId: 'ticket-42',
      cycle: 3,
      escalatedAt: new Date('invalid'),
      notifiedAt: new Date('2025-03-01T19:20:22.017Z'),
    };

    expect(() => mapEscalationToResponse(invalidEscalation)).toThrow(
      RangeError,
    );
  });
});
