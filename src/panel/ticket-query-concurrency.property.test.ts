import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

type TicketStatus =
  | 'NUEVO'
  | 'ASIGNADO'
  | 'EN_PROGRESO'
  | 'EN_ESPERA'
  | 'RESUELTO'
  | 'CERRADO';

type Filter = 'ALL' | 'OVERDUE' | TicketStatus;

type Ticket = {
  id: string;
  status: TicketStatus;
  overdue: boolean;
};

type PanelState = {
  tickets: Ticket[];
  selectedFilter: { kind: 'ALL' | 'OVERDUE' | 'STATUS'; value?: TicketStatus };
  query: {
    phase: string;
    active: unknown;
    error: { code?: string; message?: string } | null;
    sequence: number;
  };
  message: { kind?: string; text?: string } | null;
};

type TestAbortController = {
  signal: { aborted: boolean };
  abort: () => void;
};

type QueryCoordinator = {
  load: (filter: Filter) => Promise<unknown>;
  state: PanelState;
};

type PanelTestSurface = {
  createInitialState: () => PanelState;
  createQueryCoordinator: (options: {
    state: PanelState;
    adapter: { getTickets: (filter: unknown, actorId: string, options: unknown) => Promise<Ticket[]> };
    AbortControllerImpl: new () => TestAbortController;
    onChange: (state: PanelState) => void;
  }) => QueryCoordinator;
  calculateTicketSummary: (tickets: Ticket[]) => {
    open: number;
    overdue: number;
    resolved: number;
  };
  PanelApiError: new (options: {
    code: string;
    message: string;
    retryable: boolean;
    kind: string;
  }) => Error & { code: string };
};

class TestAbortController implements TestAbortController {
  signal = { aborted: false };

  abort(): void {
    this.signal.aborted = true;
  }
}

function loadPanelTestSurface(): PanelTestSurface {
  const panelScript = readFileSync(
    new URL('../../public/panel/panel.js', import.meta.url),
    'utf8',
  );
  const context: Record<string, unknown> = {};
  runInNewContext(panelScript, context, { filename: 'public/panel/panel.js' });
  return context.TicketOpsPanelTest as PanelTestSurface;
}

const panel = loadPanelTestSurface();

const filterArbitrary = fc.constantFrom<Filter>(
  'ALL',
  'OVERDUE',
  'NUEVO',
  'ASIGNADO',
  'EN_PROGRESO',
  'EN_ESPERA',
  'RESUELTO',
  'CERRADO',
);

const outcomeArbitrary = fc.boolean();

function ticketFor(index: number): Ticket[] {
  if (index % 3 === 0) {
    return [];
  }

  const statuses: TicketStatus[] = [
    'NUEVO',
    'EN_ESPERA',
    'RESUELTO',
    'CERRADO',
    'ASIGNADO',
    'EN_PROGRESO',
  ];
  return [{
    id: `respuesta-${index}`,
    status: statuses[index % statuses.length],
    overdue: index % 2 === 0,
  }];
}

function filterSnapshot(filter: PanelState['selectedFilter']): PanelState['selectedFilter'] {
  return filter.kind === 'STATUS'
    ? { kind: 'STATUS', value: filter.value }
    : { kind: filter.kind };
}

function visibleSnapshot(state: PanelState): {
  tickets: Ticket[];
  phase: string;
  summary: { open: number; overdue: number; resolved: number };
  selectedFilter: PanelState['selectedFilter'];
  message: { kind?: string; text?: string } | null;
  queryError: { code?: string; message?: string } | null;
} {
  const queryError = state.query.error
    ? { code: state.query.error.code, message: state.query.error.message }
    : null;
  return {
    tickets: state.tickets.map((ticket) => ({ ...ticket })),
    phase: state.query.phase,
    summary: panel.calculateTicketSummary(state.tickets),
    selectedFilter: filterSnapshot(state.selectedFilter),
    message: state.message ? { ...state.message } : null,
    queryError,
  };
}

type Deferred = {
  resolve: (tickets: Ticket[]) => void;
  reject: (error: Error) => void;
  promise: Promise<Ticket[]>;
};

function deferred(): Deferred {
  let resolvePromise!: (tickets: Ticket[]) => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<Ticket[]>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { resolve: resolvePromise, reject: rejectPromise, promise };
}

const scenarioArbitrary = fc.array(filterArbitrary, { minLength: 2, maxLength: 8 }).chain((filters) =>
  fc.uniqueArray(fc.integer({ min: 0, max: filters.length - 1 }), {
    minLength: filters.length,
    maxLength: filters.length,
  }).chain((resolutionOrder) =>
    fc.array(outcomeArbitrary, {
      minLength: filters.length,
      maxLength: filters.length,
    }).map((successful) => ({ filters, resolutionOrder, successful }))
  )
);

// Feature: ticketops-panel, Property 12: Sólo la consulta activa reemplaza el estado
// **Validates: Requirements 4.5, 4.6, 7.5, 15.4**

describe('Property 12: sólo la consulta activa reemplaza el estado', () => {
  it('ignora respuestas obsoletas en cualquier secuencia de filtros y orden de resolución', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArbitrary, async ({ filters, resolutionOrder, successful }) => {
        const state = panel.createInitialState();
        const deferredRequests: Deferred[] = [];
        const adapter = {
          getTickets: () => {
            const request = deferred();
            deferredRequests.push(request);
            return request.promise;
          },
        };
        let rendered = visibleSnapshot(state);
        const coordinator = panel.createQueryCoordinator({
          state,
          adapter,
          AbortControllerImpl: TestAbortController,
          onChange: (currentState) => {
            rendered = visibleSnapshot(currentState);
          },
        });

        const pendingLoads = filters.map((filter) => coordinator.load(filter));
        const activeRequestIndex = filters.length - 1;
        const selectedFilterAfterStarts = filterSnapshot(state.selectedFilter);
        const snapshotsBeforeResolution = new Map<number, ReturnType<typeof visibleSnapshot>>();

        for (const requestIndex of resolutionOrder) {
          snapshotsBeforeResolution.set(requestIndex, visibleSnapshot(state));
          if (successful[requestIndex]) {
            deferredRequests[requestIndex].resolve(ticketFor(requestIndex));
          } else {
            deferredRequests[requestIndex].reject(new panel.PanelApiError({
              code: 'NETWORK_ERROR',
              message: 'No se pudo conectar con TicketOps.',
              retryable: true,
              kind: 'network',
            }));
          }
          await pendingLoads[requestIndex];

          expect(state.selectedFilter).toEqual(selectedFilterAfterStarts);
          expect(rendered.selectedFilter).toEqual(selectedFilterAfterStarts);
          if (requestIndex !== activeRequestIndex) {
            expect(visibleSnapshot(state)).toEqual(snapshotsBeforeResolution.get(requestIndex));
            expect(rendered).toEqual(snapshotsBeforeResolution.get(requestIndex));
            continue;
          }

          if (successful[requestIndex]) {
            const tickets = ticketFor(requestIndex);
            expect(state.tickets).toEqual(tickets);
            expect(state.query.phase).toBe(tickets.length === 0 ? 'empty' : 'success');
            expect(state.query.error).toBeNull();
            expect(visibleSnapshot(state).summary).toEqual(panel.calculateTicketSummary(tickets));
          } else {
            expect(state.query.phase).toBe('error');
            expect(state.query.error?.code).toBe('NETWORK_ERROR');
            expect(state.tickets).toEqual([]);
          }
          expect(rendered).toEqual(visibleSnapshot(state));
        }
      }),
      { numRuns: 100 },
    );
  });
});
