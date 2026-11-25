import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { InvalidRequestError } from '../domain/errors.js';
import { InMemoryAgentDirectory } from '../infrastructure/in-memory-agent-directory.js';
import { InMemoryTicketStore } from '../infrastructure/in-memory-ticket-store.js';
import { FixedClock } from '../test-utils/index.js';
import { TicketService } from './ticket-service.js';

const CREATED_AT = new Date('2025-01-01T00:00:00.000Z');

const whitespaceArbitrary = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r', '\f'), {
    minLength: 0,
    maxLength: 8,
  })
  .map((characters) => characters.join(''));

const whitespaceOnlyNoteArbitrary = fc.oneof(
  fc.constant(''),
  fc
    .array(fc.constantFrom(' ', '\t', '\n', '\r', '\f'), {
      minLength: 1,
      maxLength: 16,
    })
    .map((characters) => characters.join('')),
);

const noteBodyArbitrary = fc
  .array(
    fc.constantFrom(
      'a',
      'b',
      'c',
      'd',
      'e',
      'r',
      's',
      'o',
      'l',
      'u',
      't',
      'i',
      'n',
      '0',
      '1',
      '-',
      '_',
    ),
    { minLength: 1, maxLength: 40 },
  )
  .map((characters) => characters.join(''));

const resolutionStatusArbitrary = fc.constantFrom(
  'EN_PROGRESO' as const,
  'EN_ESPERA' as const,
);

class TestIdGenerator {
  next(): string {
    return 'ticket-1';
  }
}

function createResolutionFixture(
  status: 'EN_PROGRESO' | 'EN_ESPERA',
): {
  clock: FixedClock;
  service: TicketService;
  ticketId: string;
} {
  const clock = new FixedClock(CREATED_AT);
  const service = new TicketService({
    agentDirectory: new InMemoryAgentDirectory(),
    clock,
    idGenerator: new TestIdGenerator(),
    store: new InMemoryTicketStore(),
  });
  const created = service.create({
    title: 'VPN access',
    description: 'Cannot connect from the office',
    category: 'ACCESOS',
    priority: 'ALTA',
    requester: 'user-123',
  });

  service.assign(created.id, 'agent-1', 'supervisor-1');
  service.changeStatus(created.id, 'EN_PROGRESO', undefined, 'agent-1');
  if (status === 'EN_ESPERA') {
    service.changeStatus(created.id, 'EN_ESPERA', undefined, 'agent-1');
  }

  return { clock, service, ticketId: created.id };
}

// Feature: ticketops-api, Property 10: Resolver exige y conserva una nota

describe('Property 10: resolution notes are required and preserved', () => {
  it('rejects every whitespace-only resolution note from either resolvable state', () => {
    fc.assert(
      fc.property(
        resolutionStatusArbitrary,
        whitespaceOnlyNoteArbitrary,
        (status, resolutionNote) => {
          const { service, ticketId } = createResolutionFixture(status);
          const before = service.get(ticketId);
          const historyBefore = service
            .get(ticketId)
            .status;

          expect(() =>
            service.changeStatus(
              ticketId,
              'RESUELTO',
              resolutionNote,
              'agent-1',
            ),
          ).toThrow(InvalidRequestError);

          const after = service.get(ticketId);
          expect(after).toEqual(before);
          expect(after.status).toBe(historyBefore);
          expect(after.resolutionNote).toBeNull();
          expect(after.resolvedAt).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('trims and preserves every valid resolution note and records resolvedAt', () => {
    fc.assert(
      fc.property(
        resolutionStatusArbitrary,
        whitespaceArbitrary,
        noteBodyArbitrary,
        whitespaceArbitrary,
        (status, leftPadding, noteBody, rightPadding) => {
          const { clock, service, ticketId } = createResolutionFixture(status);
          const resolutionNote = `${leftPadding}${noteBody}${rightPadding}`;
          const resolved = service.changeStatus(
            ticketId,
            'RESUELTO',
            resolutionNote,
            'agent-1',
          );

          expect(resolved.status).toBe('RESUELTO');
          expect(resolved.resolutionNote).toBe(noteBody);
          expect(resolved.resolvedAt).toEqual(clock.now());
          expect(resolved.resolvedAt).toBeInstanceOf(Date);
          expect(resolved.resolvedAt?.toISOString()).toBe(
            clock.now().toISOString(),
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
