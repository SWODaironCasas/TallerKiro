import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

type TransportKind = 'network' | 'timeout';

type MutationRequest = {
  operation: 'ticket';
  method: string;
  href: string;
  actorId: string;
  headers: Record<string, string>;
  body: Readonly<Record<string, string>>;
};

type Mutation = {
  phase: string;
  request: MutationRequest;
  payload: Readonly<Record<string, string>>;
  draft: Readonly<Record<string, string>>;
  automaticRetryUsed: boolean;
  retryAvailable: boolean;
};

type PanelState = {
  mutation: Mutation | null;
};

type PanelApiErrorConstructor = new (options: {
  code: string;
  message: string;
  retryable: boolean;
  kind: TransportKind;
}) => unknown;

type PanelTestSurface = {
  readonly PanelApiError: PanelApiErrorConstructor;
  readonly snapshotMutationRequest: (
    request: Omit<MutationRequest, 'operation'>,
    operation?: string,
  ) => MutationRequest;
  readonly createInitialState: () => PanelState;
  readonly runPreservedMutation: (
    documentObject: EmptyDocument,
    state: PanelState,
    adapter: MutationAdapter,
    mutation: Mutation,
    allowAutomaticRetry: boolean,
    onManualRetry?: () => void,
  ) => Promise<{
    ok: boolean;
    error?: unknown;
    mutation: Mutation;
  }>;
};

type MutationAdapter = {
  mutateRequest: (request: MutationRequest) => Promise<unknown>;
};

class EmptyDocument {
  getElementById(): null {
    return null;
  }
}

function loadPanelTestSurface(): PanelTestSurface {
  const panelScript = readFileSync(
    new URL('../public/panel/panel.js', import.meta.url),
    'utf8',
  );
  const context: Record<string, unknown> = {};
  runInNewContext(panelScript, context, { filename: 'public/panel/panel.js' });
  return context.TicketOpsPanelTest as PanelTestSurface;
}

const panel = loadPanelTestSurface();
const documentObject = new EmptyDocument();

const nonEmptyTextArbitrary = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((value) => value.trim().length > 0)
  .map((value) => value.trim());

const mutationInputArbitrary = fc.record({
  ticketId: nonEmptyTextArbitrary,
  actorId: nonEmptyTextArbitrary,
  status: fc.constantFrom('EN_ESPERA', 'RESUELTO', 'CERRADO'),
  resolutionNote: nonEmptyTextArbitrary,
});

const transportKindArbitrary = fc.constantFrom<TransportKind>('network', 'timeout');

function createTransportError(kind: TransportKind): unknown {
  return new panel.PanelApiError({
    code: kind === 'timeout' ? 'TIMEOUT' : 'NETWORK_ERROR',
    message: kind === 'timeout'
      ? 'La consulta tardó demasiado.'
      : 'No se pudo conectar con TicketOps.',
    retryable: true,
    kind,
  });
}

function createMutation(input: {
  ticketId: string;
  actorId: string;
  status: string;
  resolutionNote: string;
}): Mutation {
  const actorId = input.actorId.trim();
  const body = {
    status: input.status,
    resolutionNote: input.resolutionNote,
  };
  const request = panel.snapshotMutationRequest({
    method: 'PATCH',
    href: `/tickets/${encodeURIComponent(input.ticketId)}/status`,
    actorId,
    headers: {
      Accept: 'application/json',
      'X-Actor-Id': actorId,
    },
    body,
  }, 'ticket');

  return {
    phase: 'loading',
    request,
    payload: request.body,
    draft: Object.freeze({ resolutionNote: input.resolutionNote }),
    automaticRetryUsed: false,
    retryAvailable: false,
  };
}

function requestBytes(request: MutationRequest): {
  method: string;
  href: string;
  actorId: string;
  actorHeader: string | undefined;
  body: string;
} {
  return {
    method: request.method,
    href: request.href,
    actorId: request.actorId,
    actorHeader: request.headers['X-Actor-Id'],
    body: JSON.stringify(request.body),
  };
}

// Feature: ticketops-panel, Property 11: Retry de mutación acotado y reproducible
// **Validates: Requirements 11.5, 11.6**

describe('Property 11: retry de mutación acotado y reproducible', () => {
  it('limita el retry automático a dos envíos, conserva el request byte a byte y habilita retry manual', async () => {
    await fc.assert(
      fc.asyncProperty(
        mutationInputArbitrary,
        transportKindArbitrary,
        transportKindArbitrary,
        async (input, firstFailureKind, secondFailureKind) => {
          const mutation = createMutation(input);
          const state = panel.createInitialState();
          state.mutation = mutation;
          const attempts: ReturnType<typeof requestBytes>[] = [];
          let callCount = 0;

          const adapter: MutationAdapter = {
            mutateRequest(request) {
              attempts.push(requestBytes(request));
              callCount += 1;
              if (callCount === 1) {
                return Promise.reject(createTransportError(firstFailureKind));
              }
              if (callCount === 2) {
                return Promise.reject(createTransportError(secondFailureKind));
              }
              return Promise.resolve({ ok: true });
            },
          };

          const automaticResult = await panel.runPreservedMutation(
            documentObject,
            state,
            adapter,
            mutation,
            true,
          );

          expect(automaticResult.ok).toBe(false);
          expect(attempts).toHaveLength(2);
          expect(attempts[1]).toEqual(attempts[0]);
          expect(state.mutation?.phase).toBe('error');
          expect(state.mutation?.automaticRetryUsed).toBe(true);
          expect(state.mutation?.retryAvailable).toBe(true);
          expect(Object.isFrozen(mutation.request)).toBe(true);
          expect(Object.isFrozen(mutation.request.body)).toBe(true);
          expect(Object.isFrozen(mutation.payload)).toBe(true);

          const manualResult = await panel.runPreservedMutation(
            documentObject,
            state,
            adapter,
            state.mutation as Mutation,
            false,
          );

          expect(manualResult.ok).toBe(true);
          expect(attempts).toHaveLength(3);
          expect(attempts[2]).toEqual(attempts[0]);
          expect(callCount).toBe(3);
        },
      ),
      { numRuns: 100 },
    );
  });
});
