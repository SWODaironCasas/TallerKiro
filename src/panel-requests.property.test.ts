import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

type Action = 'ASSIGN' | 'START' | 'RESUME' | 'WAIT' | 'RESOLVE' | 'CLOSE' | 'REOPEN';
type Input = 'RESPONSIBLE_ID' | 'NONE' | 'RESOLUTION_NOTE';

type Descriptor = {
  action: Action;
  method: 'PATCH';
  href: string;
  targetStatus: string | null;
  input: Input;
};

type MutationRequest = {
  method: string;
  href: string;
  actorId: string;
  headers: Record<string, string>;
  body: Record<string, string | null>;
};

interface PanelTestSurface {
  buildMutationRequest(
    descriptor: Descriptor,
    actorId: string,
    draft?: { responsibleId?: string; resolutionNote?: string },
  ): MutationRequest;
  readonly ACTION_DESCRIPTOR_CONTRACT: Readonly<
    Record<Action, { targetStatus: string | null; input: Input }>
  >;
}

const ACTIONS: readonly Action[] = [
  'ASSIGN',
  'START',
  'RESUME',
  'WAIT',
  'RESOLVE',
  'CLOSE',
  'REOPEN',
];

const nonEmptyTextArbitrary = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((value) => value.trim().length > 0);

const descriptorArbitrary = fc
  .record({
    action: fc.constantFrom(...ACTIONS),
    ticketId: nonEmptyTextArbitrary,
  })
  .map(({ action, ticketId }) => {
    const contract = descriptorContract[action];
    const endpoint = action === 'ASSIGN' ? 'assignment' : 'status';
    return {
      action,
      method: 'PATCH' as const,
      href: `/tickets/${encodeURIComponent(ticketId)}/${endpoint}`,
      targetStatus: contract.targetStatus,
      input: contract.input,
    };
  });

const actorArbitrary = nonEmptyTextArbitrary;
const draftArbitrary = fc.record({
  responsibleId: nonEmptyTextArbitrary,
  resolutionNote: nonEmptyTextArbitrary,
});

const panel = loadPanelTestSurface();
const descriptorContract = panel.ACTION_DESCRIPTOR_CONTRACT;

function loadPanelTestSurface(): PanelTestSurface {
  const panelScript = readFileSync(
    new URL('../public/panel/panel.js', import.meta.url),
    'utf8',
  );
  const context: Record<string, unknown> = {};
  runInNewContext(panelScript, context, { filename: 'public/panel/panel.js' });
  return context.TicketOpsPanelTest as PanelTestSurface;
}

function expectedBody(
  descriptor: Descriptor,
  draft: { responsibleId: string; resolutionNote: string },
): Record<string, string | null> {
  switch (descriptor.input) {
    case 'RESPONSIBLE_ID':
      return { responsibleId: draft.responsibleId.trim() };
    case 'RESOLUTION_NOTE':
      return {
        status: 'RESUELTO',
        resolutionNote: draft.resolutionNote.trim(),
      };
    case 'NONE':
      return { status: descriptor.targetStatus };
  }
}

// Feature: ticketops-panel, Property 6: Requests compatibles con el input del descriptor

describe('Property 6: requests compatibles con el input del descriptor', () => {
  it('usa método, ruta relativa, actor normalizado y sólo el body permitido', () => {
    // **Validates: Requirements 8.11, 9.3, 10.1, 10.4, 12.4, 15.3**
    fc.assert(
      fc.property(
        descriptorArbitrary,
        actorArbitrary,
        draftArbitrary,
        (descriptor, actor, draft) => {
          const request = panel.buildMutationRequest(descriptor, actor, draft);
          const normalizedActor = actor.trim();
          const body = expectedBody(descriptor, draft);

          expect(request.method).toBe(descriptor.method);
          expect(request.href).toBe(descriptor.href);
          expect(request.href.startsWith('/')).toBe(true);
          expect(request.href.startsWith('//')).toBe(false);
          expect(/^[a-z][a-z\d+.-]*:/i.test(request.href)).toBe(false);
          expect(request.actorId).toBe(normalizedActor);
          expect(request.headers['X-Actor-Id']).toBe(normalizedActor);
          expect(Object.keys(request.body).sort()).toEqual(Object.keys(body).sort());
          expect(request.body).toEqual(body);
        },
      ),
      { numRuns: 100 },
    );
  });
});
