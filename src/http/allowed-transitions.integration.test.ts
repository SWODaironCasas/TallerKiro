import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp, type AppDependencies } from '../app.js';
import type { TicketStatus } from '../domain/index.js';
import {
  InMemoryAgentDirectory,
  InMemorySupervisorNotifier,
  InMemoryTicketStore,
} from '../infrastructure/index.js';
import type { HttpAllowedTransition } from './mappers.js';
import { FixedClock } from '../test-utils/index.js';

const CREATED_AT = new Date('2025-01-02T03:04:05.006Z');

interface TicketResponse {
  id: string;
  status: TicketStatus;
  allowedTransitions: HttpAllowedTransition[];
}

class TestIdGenerator {
  private sequence = 0;

  next(): string {
    this.sequence += 1;
    return `ticket-${this.sequence}`;
  }
}

function createClient() {
  const dependencies: AppDependencies = {
    store: new InMemoryTicketStore(),
    clock: new FixedClock(CREATED_AT),
    idGenerator: new TestIdGenerator(),
    agentDirectory: new InMemoryAgentDirectory(),
    supervisorNotifier: new InMemorySupervisorNotifier(),
  };

  return request(createApp(dependencies));
}

function expectedTransitions(
  ticketId: string,
  status: TicketStatus,
): HttpAllowedTransition[] {
  const assignment: HttpAllowedTransition = {
    action: 'ASSIGN',
    method: 'PATCH',
    href: `/tickets/${encodeURIComponent(ticketId)}/assignment`,
    targetStatus: null,
    input: 'RESPONSIBLE_ID',
  };
  const statusDescriptor = (
    action: HttpAllowedTransition['action'],
    targetStatus: TicketStatus,
    input: HttpAllowedTransition['input'] = 'NONE',
  ): HttpAllowedTransition => ({
    action,
    method: 'PATCH',
    href: `/tickets/${encodeURIComponent(ticketId)}/status`,
    targetStatus,
    input,
  });

  switch (status) {
    case 'NUEVO':
      return [assignment];
    case 'ASIGNADO':
      return [assignment, statusDescriptor('START', 'EN_PROGRESO')];
    case 'EN_PROGRESO':
      return [
        assignment,
        statusDescriptor('WAIT', 'EN_ESPERA'),
        statusDescriptor('RESOLVE', 'RESUELTO', 'RESOLUTION_NOTE'),
      ];
    case 'EN_ESPERA':
      return [
        assignment,
        statusDescriptor('RESUME', 'EN_PROGRESO'),
        statusDescriptor('RESOLVE', 'RESUELTO', 'RESOLUTION_NOTE'),
      ];
    case 'RESUELTO':
      return [
        assignment,
        statusDescriptor('CLOSE', 'CERRADO'),
        statusDescriptor('REOPEN', 'EN_PROGRESO'),
      ];
    case 'CERRADO':
      return [assignment, statusDescriptor('REOPEN', 'EN_PROGRESO')];
  }
}

function assertAllowedTransitions(
  response: { status: number; body: unknown },
  ticketId: string,
  status: TicketStatus,
): void {
  expect(response.status).toBe(200);
  const body = response.body as TicketResponse;
  expect(body.status).toBe(status);
  expect(body.allowedTransitions).toEqual(
    expectedTransitions(ticketId, status),
  );
}

async function createTicket(client: ReturnType<typeof request>): Promise<TicketResponse> {
  const response = await client.post('/tickets').send({
    title: 'VPN access failure',
    description: 'The user cannot connect from the office.',
    category: 'ACCESOS',
    priority: 'ALTA',
    requester: 'user-123',
  });

  expect(response.status).toBe(201);
  return response.body as TicketResponse;
}

describe('HTTP allowedTransitions contract', () => {
  it('includes the assignment descriptor in create, list, and detail responses', async () => {
    const client = createClient();
    const created = await createTicket(client);

    expect(created.allowedTransitions).toEqual(
      expectedTransitions(created.id, 'NUEVO'),
    );

    const list = await client.get('/tickets');
    expect(list.status).toBe(200);
    expect((list.body as TicketResponse[])[0]?.allowedTransitions).toEqual(
      expectedTransitions(created.id, 'NUEVO'),
    );

    const detail = await client.get(`/tickets/${created.id}`);
    expect(detail.status).toBe(200);
    expect((detail.body as TicketResponse).allowedTransitions).toEqual(
      expectedTransitions(created.id, 'NUEVO'),
    );
  });

  it('returns exact descriptors for assignment and every allowed state transition', async () => {
    const client = createClient();
    const created = await createTicket(client);
    const ticketId = created.id;

    const assignment = await client
      .patch(`/tickets/${ticketId}/assignment`)
      .set('X-Actor-Id', 'supervisor-1')
      .send({ responsibleId: 'agent-1' });
    assertAllowedTransitions(assignment, ticketId, 'ASIGNADO');

    const started = await client
      .patch(`/tickets/${ticketId}/status`)
      .set('X-Actor-Id', 'agent-1')
      .send({ status: 'EN_PROGRESO' });
    assertAllowedTransitions(started, ticketId, 'EN_PROGRESO');

    const waiting = await client
      .patch(`/tickets/${ticketId}/status`)
      .set('X-Actor-Id', 'agent-1')
      .send({ status: 'EN_ESPERA' });
    assertAllowedTransitions(waiting, ticketId, 'EN_ESPERA');

    const resumed = await client
      .patch(`/tickets/${ticketId}/status`)
      .set('X-Actor-Id', 'agent-1')
      .send({ status: 'EN_PROGRESO' });
    assertAllowedTransitions(resumed, ticketId, 'EN_PROGRESO');

    const resolved = await client
      .patch(`/tickets/${ticketId}/status`)
      .set('X-Actor-Id', 'agent-1')
      .send({ status: 'RESUELTO', resolutionNote: 'VPN restored' });
    assertAllowedTransitions(resolved, ticketId, 'RESUELTO');

    const closed = await client
      .patch(`/tickets/${ticketId}/status`)
      .set('X-Actor-Id', 'agent-1')
      .send({ status: 'CERRADO' });
    assertAllowedTransitions(closed, ticketId, 'CERRADO');

    const reopened = await client
      .patch(`/tickets/${ticketId}/status`)
      .set('X-Actor-Id', 'agent-1')
      .send({ status: 'EN_PROGRESO' });
    assertAllowedTransitions(reopened, ticketId, 'EN_PROGRESO');
  });

  it('does not expose actions that are not allowed by the current state', async () => {
    const client = createClient();
    const created = await createTicket(client);
    const ticketId = created.id;

    const response = await client.get(`/tickets/${ticketId}`);
    expect(response.status).toBe(200);

    const descriptors = (response.body as TicketResponse).allowedTransitions;
    expect(descriptors.map(({ action }) => action)).toEqual(['ASSIGN']);
    expect(descriptors.map(({ targetStatus }) => targetStatus)).toEqual([null]);
    expect(descriptors.some(({ action }) => action === 'START')).toBe(false);
    expect(descriptors.some(({ action }) => action === 'RESOLVE')).toBe(false);
    expect(descriptors.some(({ action }) => action === 'CLOSE')).toBe(false);
    expect(descriptors.some(({ action }) => action === 'REOPEN')).toBe(false);
  });
});
