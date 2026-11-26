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

type Summary = {
  open: number;
  overdue: number;
  resolved: number;
};

type PanelTestSurface = {
  calculateTicketSummary: (tickets: ReadonlyArray<PanelTicket>) => Summary;
};

type PanelTicket = {
  status: TicketStatus;
  overdue: boolean;
};

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

const ticketArbitrary: fc.Arbitrary<PanelTicket> = fc.record({
  status: statusArbitrary,
  overdue: fc.boolean(),
});

const ticketCollectionArbitrary = fc.array(ticketArbitrary, { maxLength: 50 });

function independentSummaryOracle(tickets: ReadonlyArray<PanelTicket>): Summary {
  return {
    open: tickets.filter(
      ({ status }) =>
        status === 'NUEVO' ||
        status === 'ASIGNADO' ||
        status === 'EN_PROGRESO' ||
        status === 'EN_ESPERA',
    ).length,
    overdue: tickets.filter(({ overdue }) => overdue).length,
    resolved: tickets.filter(
      ({ status }) => status === 'RESUELTO' || status === 'CERRADO',
    ).length,
  };
}

describe('Property 1: indicadores correctos para cualquier colección', () => {
  it('coincide con un oráculo independiente para estados, vencimiento y colección vacía', () => {
    const panelTestSurface = loadPanelTestSurface();

    // **Validates: Requirements 2.2, 2.3, 2.4, 2.6**
    fc.assert(
      fc.property(ticketCollectionArbitrary, (tickets) => {
        expect(panelTestSurface.calculateTicketSummary(tickets)).toEqual(
          independentSummaryOracle(tickets),
        );
      }),
      { numRuns: 100 },
    );
  });

  it('devuelve cero en los tres indicadores para una colección vacía', () => {
    const panelTestSurface = loadPanelTestSurface();

    expect(panelTestSurface.calculateTicketSummary([])).toEqual({
      open: 0,
      overdue: 0,
      resolved: 0,
    });
  });
});
