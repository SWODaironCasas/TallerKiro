import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Ticket } from '../domain/types.js';
import { InMemoryTicketStore } from './in-memory-ticket-store.js';

const BASE_DATE = new Date('2025-01-01T00:00:00.000Z');

function makeTicket(id: string, cycles: number[]): Ticket {
  const escalations = cycles.map((cycle) => ({
    ticketId: id,
    cycle,
    escalatedAt: new Date(BASE_DATE.getTime() + cycle * 1_000),
    notifiedAt: new Date(BASE_DATE.getTime() + cycle * 2_000),
  }));
  const supervisorNotifications = cycles.map((cycle) => ({
    ticketId: id,
    cycle,
    notifiedAt: new Date(BASE_DATE.getTime() + cycle * 2_000),
  }));

  return {
    id,
    title: `Ticket ${id}`,
    description: 'Generated ticket for store isolation testing.',
    category: 'ACCESOS',
    priority: 'MEDIA',
    requester: 'requester-1',
    responsibleId: null,
    status: 'NUEVO',
    createdAt: new Date(BASE_DATE),
    updatedAt: new Date(BASE_DATE),
    dueAt: new Date(BASE_DATE.getTime() + 60_000),
    resolutionNote: null,
    resolvedAt: null,
    closedAt: null,
    overdue: cycles.length > 0,
    overdueCycle: cycles.length > 0 ? cycles[cycles.length - 1] : 1,
    escalations,
    supervisorNotifications,
  };
}

const ticketSetArbitrary = fc
  .uniqueArray(fc.stringMatching(/ticket-[a-z0-9]{1,8}/), {
    minLength: 2,
    maxLength: 6,
  })
  .chain((ids) =>
    fc.tuple(
      ...ids.map((id) =>
        fc.uniqueArray(fc.integer({ min: 1, max: 20 }), {
          minLength: 1,
          maxLength: 4,
        }).map((cycles) => ({ id, cycles })),
      ),
    ),
  );

// Feature: ticket-expiry-supervisor-notifications, Property 5: El Store aísla y particiona por Ticket

describe('Property 5: ticket store isolation and partitioning', () => {
  it('keeps tickets and events isolated by ticket id across mutated reads', () => {
    fc.assert(
      fc.property(ticketSetArbitrary, (entries) => {
        const store = new InMemoryTicketStore();
        const tickets = entries.map(({ id, cycles }) => makeTicket(id, cycles));

        for (const ticket of tickets) {
          store.save(ticket);
          for (const escalation of ticket.escalations) {
            store.saveEscalation(escalation);
          }
          for (const notification of ticket.supervisorNotifications) {
            store.saveSupervisorNotification(notification);
          }
        }

        for (const ticket of tickets) {
          const observed = store.get(ticket.id);
          expect(observed?.id).toBe(ticket.id);
          expect(observed?.escalations.every((event) => event.ticketId === ticket.id)).toBe(true);
          expect(observed?.supervisorNotifications.every((event) => event.ticketId === ticket.id)).toBe(true);

          const escalations = store.listEscalations(ticket.id);
          const notifications = store.listSupervisorNotifications(ticket.id);
          expect(escalations.every((event) => event.ticketId === ticket.id)).toBe(true);
          expect(notifications.every((event) => event.ticketId === ticket.id)).toBe(true);
          expect(escalations.map(({ cycle }) => cycle)).toEqual(ticket.escalations.map(({ cycle }) => cycle));
          expect(notifications.map(({ cycle }) => cycle)).toEqual(ticket.supervisorNotifications.map(({ cycle }) => cycle));

          if (observed) {
            observed.title = 'mutated read';
            observed.escalations[0].cycle = 999;
            observed.supervisorNotifications[0].cycle = 999;
          }
          if (escalations[0]) escalations[0].cycle = 999;
          if (notifications[0]) notifications[0].cycle = 999;
        }

        for (const ticket of tickets) {
          const reread = store.get(ticket.id);
          expect(reread?.title).toBe(`Ticket ${ticket.id}`);
          expect(store.listEscalations(ticket.id).map(({ cycle }) => cycle)).toEqual(
            ticket.escalations.map(({ cycle }) => cycle),
          );
          expect(store.listSupervisorNotifications(ticket.id).map(({ cycle }) => cycle)).toEqual(
            ticket.supervisorNotifications.map(({ cycle }) => cycle),
          );
        }

        const allTicketIds = new Set(tickets.map(({ id }) => id));
        expect(store.listEscalations().every((event) => allTicketIds.has(event.ticketId))).toBe(true);
        expect(store.listSupervisorNotifications().every((event) => allTicketIds.has(event.ticketId))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
