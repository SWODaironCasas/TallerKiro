import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import {
  InMemoryAgentDirectory,
  InMemorySupervisorNotifier,
  InMemoryTicketStore,
} from '../infrastructure/index.js';
import { createIsolatedDependencies, FixedClock } from '../test-utils/index.js';

const CREATED_AT = new Date('2025-01-01T00:00:00.000Z');
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RESOLUTION_NOTE = '  VPN reiniciada correctamente  ';

interface TicketBody {
  status: string;
  updatedAt: string;
  resolutionNote: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  overdue: boolean;
  overdueCycle: number;
  escalations: Array<{ cycle: number }>;
  supervisorNotifications: Array<{ cycle: number }>;
}

interface HistoryBody {
  sequence: number;
  from: string;
  to: string;
  changedAt: string;
  actorId: string;
}

function createTestContext() {
  const clock = new FixedClock(CREATED_AT);
  let nextId = 0;
  const dependencies = createIsolatedDependencies({
    store: () => new InMemoryTicketStore(),
    clock: () => clock,
    idGenerator: () => ({ next: () => `ticket-${++nextId}` }),
    agentDirectory: () => new InMemoryAgentDirectory(),
    supervisorNotifier: () => new InMemorySupervisorNotifier(),
  });

  return { client: request(createApp(dependencies)), clock };
}

async function postTicket(
  client: ReturnType<typeof request>,
  priority: 'ALTA' | 'CRITICA' = 'ALTA',
): Promise<TicketBody & { id: string }> {
  const response = await client.post('/tickets').send({
    title: `Ticket ${priority}`,
    description: 'Descripción del ticket',
    category: 'ACCESOS',
    priority,
    requester: 'user-123',
  });

  expect(response.status).toBe(201);
  return response.body as TicketBody & { id: string };
}

async function patchStatus(
  client: ReturnType<typeof request>,
  ticketId: string,
  status: string,
  actorId = 'agent-1',
  resolutionNote?: string,
) {
  const body = resolutionNote === undefined
    ? { status }
    : { status, resolutionNote };

  return client
    .patch(`/tickets/${ticketId}/status`)
    .set('X-Actor-Id', actorId)
    .send(body);
}

function expectError(
  response: { status: number; body: Record<string, unknown> },
  status: number,
  code: string,
): void {
  expect(response.status).toBe(status);
  expect(response.body).toEqual({
    error: expect.objectContaining({
      code,
      message: expect.any(String),
    }),
  });
  expect(response.body).not.toHaveProperty('stack');
}

describe('PATCH /tickets/:id/status integration', () => {
  it('accepts all seven normal transitions with resolution and closure timestamps', async () => {
    const { client, clock } = createTestContext();
    const first = await postTicket(client);

    const firstTransitions: Array<[string, string]> = [
      ['ASIGNADO', 'agent-1'],
      ['EN_PROGRESO', 'agent-1'],
      ['EN_ESPERA', 'agent-2'],
      ['EN_PROGRESO', 'agent-2'],
      ['RESUELTO', 'agent-1'],
      ['CERRADO', 'agent-1'],
    ];

    for (const [status, actorId] of firstTransitions) {
      clock.advanceBy(1_000);
      const response = await patchStatus(
        client,
        first.id,
        status,
        actorId,
        status === 'RESUELTO' ? RESOLUTION_NOTE : undefined,
      );

      expect(response.status).toBe(200);
      const body = response.body as TicketBody;
      expect(body.status).toBe(status);
      expect(body.updatedAt).toBe(clock.now().toISOString());
      expect(body.updatedAt).toMatch(ISO_UTC);

      if (status === 'RESUELTO') {
        expect(body.resolutionNote).toBe('VPN reiniciada correctamente');
        expect(body.resolvedAt).toBe(clock.now().toISOString());
        expect(body.resolvedAt).toMatch(ISO_UTC);
        expect(body.closedAt).toBeNull();
      }

      if (status === 'CERRADO') {
        expect(body.closedAt).toBe(clock.now().toISOString());
        expect(body.closedAt).toMatch(ISO_UTC);
      }
    }

    const second = await postTicket(client);
    for (const status of ['ASIGNADO', 'EN_PROGRESO', 'EN_ESPERA'] as const) {
      clock.advanceBy(1_000);
      expect(
        (await patchStatus(client, second.id, status, 'agent-2')).status,
      ).toBe(200);
    }

    clock.advanceBy(1_000);
    const resolvedFromWaiting = await patchStatus(
      client,
      second.id,
      'RESUELTO',
      'agent-2',
      '  Acceso restaurado  ',
    );
    expect(resolvedFromWaiting.status).toBe(200);
    expect((resolvedFromWaiting.body as TicketBody).resolutionNote).toBe(
      'Acceso restaurado',
    );

    const firstHistory = await client.get(`/tickets/${first.id}/history`);
    expect(firstHistory.status).toBe(200);
    expect(
      (firstHistory.body as HistoryBody[]).map(({ from, to, actorId }) => [
        from,
        to,
        actorId,
      ]),
    ).toEqual([
      ['NUEVO', 'ASIGNADO', 'agent-1'],
      ['ASIGNADO', 'EN_PROGRESO', 'agent-1'],
      ['EN_PROGRESO', 'EN_ESPERA', 'agent-2'],
      ['EN_ESPERA', 'EN_PROGRESO', 'agent-2'],
      ['EN_PROGRESO', 'RESUELTO', 'agent-1'],
      ['RESUELTO', 'CERRADO', 'agent-1'],
    ]);

    const secondHistory = await client.get(`/tickets/${second.id}/history`);
    expect(secondHistory.status).toBe(200);
    expect(
      (secondHistory.body as HistoryBody[]).map(({ from, to }) => [from, to]),
    ).toEqual([
      ['NUEVO', 'ASIGNADO'],
      ['ASIGNADO', 'EN_PROGRESO'],
      ['EN_PROGRESO', 'EN_ESPERA'],
      ['EN_ESPERA', 'RESUELTO'],
    ]);
  });

  it('treats same-state requests as no-ops and rejects conflicts without growing history', async () => {
    const { client, clock } = createTestContext();
    const ticket = await postTicket(client);
    const initialUpdatedAt = ticket.updatedAt;

    clock.advanceBy(1_000);
    const noOp = await patchStatus(client, ticket.id, 'NUEVO');
    expect(noOp.status).toBe(200);
    expect((noOp.body as TicketBody).status).toBe('NUEVO');
    expect((noOp.body as TicketBody).updatedAt).toBe(initialUpdatedAt);

    const invalidFromNew = await patchStatus(
      client,
      ticket.id,
      'EN_PROGRESO',
    );
    expectError(invalidFromNew, 409, 'INVALID_TRANSITION');

    expect((await client.get(`/tickets/${ticket.id}/history`)).body).toEqual(
      [],
    );

    expect((await patchStatus(client, ticket.id, 'ASIGNADO')).status).toBe(200);
    expect((await patchStatus(client, ticket.id, 'EN_PROGRESO')).status).toBe(
      200,
    );

    const missingResolutionNote = await patchStatus(
      client,
      ticket.id,
      'RESUELTO',
    );
    expectError(missingResolutionNote, 400, 'INVALID_REQUEST');

    const invalidClose = await patchStatus(client, ticket.id, 'CERRADO');
    expectError(invalidClose, 409, 'INVALID_TRANSITION');

    const history = await client.get(`/tickets/${ticket.id}/history`);
    expect(history.status).toBe(200);
    expect((history.body as HistoryBody[]).map(({ from, to }) => [from, to])).toEqual([
      ['NUEVO', 'ASIGNADO'],
      ['ASIGNADO', 'EN_PROGRESO'],
    ]);
  });

  it('supports both reopenings while clearing resolution fields and preserving SLA events', async () => {
    const { client, clock } = createTestContext();
    const ticket = await postTicket(client, 'CRITICA');

    clock.advanceBy(4 * 60 * 60 * 1_000 + 1);
    const overdue = await client
      .get('/tickets/overdue')
      .set('X-Actor-Id', 'supervisor-1');
    expect(overdue.status).toBe(200);
    expect(overdue.body).toHaveLength(1);
    const overdueBody = overdue.body[0] as TicketBody;
    expect(overdueBody.overdue).toBe(true);
    expect(overdueBody.overdueCycle).toBe(1);
    expect(overdueBody.escalations.map(({ cycle }) => cycle)).toEqual([1]);
    expect(overdueBody.supervisorNotifications.map(({ cycle }) => cycle)).toEqual([
      1,
    ]);

    for (const status of ['ASIGNADO', 'EN_PROGRESO'] as const) {
      expect((await patchStatus(client, ticket.id, status)).status).toBe(200);
    }

    const resolved = await patchStatus(
      client,
      ticket.id,
      'RESUELTO',
      'agent-1',
      RESOLUTION_NOTE,
    );
    expect(resolved.status).toBe(200);
    expect((resolved.body as TicketBody).overdue).toBe(true);
    expect((resolved.body as TicketBody).escalations).toHaveLength(1);

    const closed = await patchStatus(client, ticket.id, 'CERRADO');
    expect(closed.status).toBe(200);
    const closedBody = closed.body as TicketBody;
    expect(closedBody.closedAt).toBe(clock.now().toISOString());
    expect(closedBody.resolvedAt).toMatch(ISO_UTC);
    expect(closedBody.resolutionNote).toBe('VPN reiniciada correctamente');
    expect(closedBody.overdue).toBe(true);
    expect(closedBody.overdueCycle).toBe(1);
    expect(closedBody.escalations).toHaveLength(1);
    expect(closedBody.supervisorNotifications).toHaveLength(1);

    const historyBeforeReopen = await client.get(`/tickets/${ticket.id}/history`);
    expect(historyBeforeReopen.body).toHaveLength(4);

    clock.advanceBy(1_000);
    const reopenedFromClosed = await patchStatus(
      client,
      ticket.id,
      'EN_PROGRESO',
      'agent-2',
    );
    expect(reopenedFromClosed.status).toBe(200);
    const firstReopenBody = reopenedFromClosed.body as TicketBody;
    expect(firstReopenBody.status).toBe('EN_PROGRESO');
    expect(firstReopenBody.overdue).toBe(false);
    expect(firstReopenBody.overdueCycle).toBe(2);
    expect(firstReopenBody.resolutionNote).toBeNull();
    expect(firstReopenBody.resolvedAt).toBeNull();
    expect(firstReopenBody.closedAt).toBeNull();
    expect(firstReopenBody.escalations.map(({ cycle }) => cycle)).toEqual([1]);
    expect(firstReopenBody.supervisorNotifications.map(({ cycle }) => cycle)).toEqual([
      1,
    ]);

    const historyAfterClosedReopen = await client.get(`/tickets/${ticket.id}/history`);
    expect(historyAfterClosedReopen.body).toHaveLength(5);
    expect(historyAfterClosedReopen.body[4]).toMatchObject({
      from: 'CERRADO',
      to: 'EN_PROGRESO',
      actorId: 'agent-2',
    });

    const overdueAgain = await client.get(`/tickets/${ticket.id}`);
    expect(overdueAgain.status).toBe(200);
    const secondCycleBody = overdueAgain.body as TicketBody;
    expect(secondCycleBody.overdue).toBe(true);
    expect(secondCycleBody.overdueCycle).toBe(2);
    expect(secondCycleBody.escalations.map(({ cycle }) => cycle)).toEqual([1, 2]);
    expect(secondCycleBody.supervisorNotifications.map(({ cycle }) => cycle)).toEqual([
      1,
      2,
    ]);

    const resolvedAgain = await patchStatus(
      client,
      ticket.id,
      'RESUELTO',
      'agent-1',
      '  Resuelto por segunda vez  ',
    );
    expect(resolvedAgain.status).toBe(200);
    expect((resolvedAgain.body as TicketBody).resolvedAt).toMatch(ISO_UTC);
    expect((resolvedAgain.body as TicketBody).closedAt).toBeNull();

    const reopenedFromResolved = await patchStatus(
      client,
      ticket.id,
      'EN_PROGRESO',
      'agent-1',
    );
    expect(reopenedFromResolved.status).toBe(200);
    const secondReopenBody = reopenedFromResolved.body as TicketBody;
    expect(secondReopenBody.status).toBe('EN_PROGRESO');
    expect(secondReopenBody.overdue).toBe(false);
    expect(secondReopenBody.overdueCycle).toBe(3);
    expect(secondReopenBody.resolutionNote).toBeNull();
    expect(secondReopenBody.resolvedAt).toBeNull();
    expect(secondReopenBody.closedAt).toBeNull();
    expect(secondReopenBody.escalations.map(({ cycle }) => cycle)).toEqual([1, 2]);
    expect(secondReopenBody.supervisorNotifications.map(({ cycle }) => cycle)).toEqual([
      1,
      2,
    ]);

    const finalEvaluation = await client.get(`/tickets/${ticket.id}`);
    expect(finalEvaluation.status).toBe(200);
    const thirdCycleBody = finalEvaluation.body as TicketBody;
    expect(thirdCycleBody.overdue).toBe(true);
    expect(thirdCycleBody.overdueCycle).toBe(3);
    expect(thirdCycleBody.escalations.map(({ cycle }) => cycle)).toEqual([1, 2, 3]);
    expect(thirdCycleBody.supervisorNotifications.map(({ cycle }) => cycle)).toEqual([
      1,
      2,
      3,
    ]);

    const finalHistory = await client.get(`/tickets/${ticket.id}/history`);
    const entries = finalHistory.body as HistoryBody[];
    expect(entries).toHaveLength(7);
    expect(entries.map(({ from, to, actorId }) => [from, to, actorId])).toEqual([
      ['NUEVO', 'ASIGNADO', 'agent-1'],
      ['ASIGNADO', 'EN_PROGRESO', 'agent-1'],
      ['EN_PROGRESO', 'RESUELTO', 'agent-1'],
      ['RESUELTO', 'CERRADO', 'agent-1'],
      ['CERRADO', 'EN_PROGRESO', 'agent-2'],
      ['EN_PROGRESO', 'RESUELTO', 'agent-1'],
      ['RESUELTO', 'EN_PROGRESO', 'agent-1'],
    ]);
    expect(entries.every(({ changedAt }) => ISO_UTC.test(changedAt))).toBe(true);
  });
});
