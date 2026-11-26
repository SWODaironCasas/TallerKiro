import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type {
  Category,
  EscalationRecord,
  Priority,
  SupervisorNotification,
  Ticket,
  TicketStatus,
} from '../domain/index.js';
import { mapTicketToResponse } from './mappers.js';

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

const statusArbitrary = fc.constantFrom<TicketStatus>(
  'NUEVO',
  'ASIGNADO',
  'EN_PROGRESO',
  'EN_ESPERA',
  'RESUELTO',
  'CERRADO',
);

const dateArbitrary = fc
  .integer({
    min: Date.parse('2000-01-01T00:00:00.000Z'),
    max: Date.parse('2100-12-31T23:59:59.999Z'),
  })
  .map((timestamp) => new Date(timestamp));
const eventDateArbitrary = fc.record({
  escalatedAt: dateArbitrary,
  notifiedAt: dateArbitrary,
});

const ticketArbitrary: fc.Arbitrary<Ticket> = fc
  .record({
    id: fc.string({ minLength: 1 }),
    title: fc.string({ minLength: 1 }),
    description: fc.string({ minLength: 1 }),
    category: categoryArbitrary,
    priority: priorityArbitrary,
    requester: fc.string({ minLength: 1 }),
    status: statusArbitrary,
    createdAt: dateArbitrary,
    updatedAt: dateArbitrary,
    dueAt: dateArbitrary,
    overdue: fc.boolean(),
    overdueCycle: fc.integer({ min: 1, max: 100 }),
    eventData: fc.array(eventDateArbitrary, { maxLength: 10 }),
  })
  .map(({ eventData, ...ticket }) => {
    const escalations: EscalationRecord[] = eventData.map(
      ({ escalatedAt, notifiedAt }, index) => ({
        ticketId: ticket.id,
        cycle: index + 1,
        escalatedAt,
        notifiedAt,
      }),
    );
    const supervisorNotifications: SupervisorNotification[] = escalations.map(
      ({ ticketId, cycle, notifiedAt }) => ({ ticketId, cycle, notifiedAt }),
    );

    return {
      ...ticket,
      responsibleId: null,
      resolutionNote: null,
      resolvedAt: null,
      closedAt: null,
      escalations,
      supervisorNotifications,
    };
  });

describe('Property 8: La serialización conserva identidad, ciclos y tiempo', () => {
  it('preserves event identity, cycles, timestamps, and empty collections', () => {
    // Feature: ticket-expiry-supervisor-notifications, Property 8: La serialización conserva identidad, ciclos y tiempo
    fc.assert(
      fc.property(ticketArbitrary, (ticket) => {
        const response = mapTicketToResponse(ticket);

        expect(response.id).toBe(ticket.id);
        expect(response.overdueCycle).toBe(ticket.overdueCycle);
        expect(response.escalations).toEqual(
          ticket.escalations.map((event) => ({
            ticketId: event.ticketId,
            cycle: event.cycle,
            escalatedAt: event.escalatedAt.toISOString(),
            notifiedAt: event.notifiedAt.toISOString(),
          })),
        );
        expect(response.supervisorNotifications).toEqual(
          ticket.supervisorNotifications.map((event) => ({
            ticketId: event.ticketId,
            cycle: event.cycle,
            notifiedAt: event.notifiedAt.toISOString(),
          })),
        );

        if (ticket.escalations.length === 0) {
          expect(response.escalations).toEqual([]);
          expect(response.supervisorNotifications).toEqual([]);
        }
      }),
      { numRuns: 100 },
    );
  });
});
