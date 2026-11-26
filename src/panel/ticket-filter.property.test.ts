import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

type FilterValue = 'ALL' | 'OVERDUE' | TicketStatus;

type FilterRequest = {
  path: string;
  headers: Record<string, string>;
};

type FetchCall = {
  path: string;
  options: {
    method: string;
    headers: Record<string, string>;
  };
};

type PanelTestSurface = {
  createHttpAdapter: (options: {
    fetchImpl: (path: string, options: FetchCall['options']) => Promise<{
      status: number;
      ok: boolean;
      json: () => Promise<unknown>;
    }>;
    AbortControllerImpl: typeof TestAbortController;
    timeoutMs: number;
  }) => {
    getFilterRequest: (filter: FilterValue, actorId: string) => FilterRequest;
    getTickets: (filter: FilterValue, actorId: string) => Promise<unknown[]>;
  };
  PanelApiError: typeof Error;
};

class TestAbortController {
  signal = { aborted: false };

  abort(): void {
    this.signal.aborted = true;
  }
}

const panelScriptPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../public/panel/panel.js',
);

function loadPanelTestSurface(): PanelTestSurface {
  const panelScript = readFileSync(panelScriptPath, 'utf8');
  const context: Record<string, unknown> = {};
  runInNewContext(panelScript, context);

  return context.TicketOpsPanelTest as PanelTestSurface;
}

const statusArbitrary = fc.constantFrom<TicketStatus>(
  'NUEVO',
  'ASIGNADO',
  'EN_PROGRESO',
  'EN_ESPERA',
  'RESUELTO',
  'CERRADO',
);

const whitespaceArbitrary = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r', '\u00a0'), {
    maxLength: 5,
  })
  .map((characters) => characters.join(''));

const nonEmptyActorArbitrary = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((value) => value.trim().length > 0);

const actorArbitrary = fc.oneof(
  fc.constantFrom('', ' ', '\t', '\n', ' \t\n '),
  fc
    .tuple(whitespaceArbitrary, nonEmptyActorArbitrary, whitespaceArbitrary)
    .map(([left, actor, right]) => `${left}${actor}${right}`),
);

const filterArbitrary = fc.oneof(
  fc.constant<'ALL'>('ALL'),
  fc.constant<'OVERDUE'>('OVERDUE'),
  statusArbitrary,
);

const filterCaseArbitrary = fc.record({
  filter: filterArbitrary,
  actorId: actorArbitrary,
});

function expectedRequest(filter: FilterValue, actorId: string): FilterRequest {
  const normalizedActorId = actorId.trim();

  if (filter === 'ALL') {
    return { path: '/tickets', headers: {} };
  }

  if (filter === 'OVERDUE') {
    return {
      path: '/tickets/overdue',
      headers: { 'X-Actor-Id': normalizedActorId },
    };
  }

  return {
    path: `/tickets?status=${filter}`,
    headers: {},
  };
}

describe('Property 4: construcción de consultas y actor', () => {
  it('construye URLs exactas, normaliza el actor y bloquea vencidos antes de fetch', async () => {
    const panelTestSurface = loadPanelTestSurface();
    const calls: FetchCall[] = [];
    const adapter = panelTestSurface.createHttpAdapter({
      fetchImpl: async (path, options) => {
        calls.push({ path, options });
        return {
          status: 200,
          ok: true,
          json: async () => [{ id: 'ticket-de-prueba' }],
        };
      },
      AbortControllerImpl: TestAbortController,
      timeoutMs: 0,
    });

    // Feature: ticketops-panel, Property 4: Construcción de consultas y actor
    // **Validates: Requirements 3.2, 7.2, 7.3, 7.4, 12.4**
    await fc.assert(
      fc.asyncProperty(filterCaseArbitrary, async ({ filter, actorId }) => {
        calls.length = 0;
        const expected = expectedRequest(filter, actorId);

        if (filter === 'OVERDUE' && expected.headers['X-Actor-Id'] === '') {
          expect(() => adapter.getFilterRequest(filter, actorId)).toThrow();
          expect(() => adapter.getTickets(filter, actorId)).toThrow();
          expect(calls).toHaveLength(0);
          return;
        }

        const filterRequest = adapter.getFilterRequest(filter, actorId);
        expect({ path: filterRequest.path, headers: filterRequest.headers }).toEqual(expected);
        await adapter.getTickets(filter, actorId);

        expect(calls).toHaveLength(1);
        expect(calls[0].path).toBe(expected.path);
        expect(calls[0].options.method).toBe('GET');
        expect(calls[0].options.headers).toEqual({
          Accept: 'application/json',
          ...expected.headers,
        });
      }),
      { numRuns: 100 },
    );
  });
});
