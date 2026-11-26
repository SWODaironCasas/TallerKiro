import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

type RelativeDue = {
  text: string;
  overdue: boolean;
};

type PanelTicket = {
  id: string;
  title: string;
  dueAt: string;
  overdue: boolean;
};

interface PanelTestSurface {
  formatRelativeDue(
    dueAt: string,
    nowValue: string,
    overdueFlag: boolean,
  ): RelativeDue;
  renderTicketCollection(
    documentObject: InMemoryDocument,
    state: {
      tickets: PanelTicket[];
      selectedFilter: { kind: 'ALL' };
      query: { phase: 'success' };
    },
    nowValue: string,
  ): void;
}

class InMemoryElement {
  readonly children: InMemoryElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly classList = {
    add: (...names: string[]) => {
      if (names.length === 0) {
        return;
      }
    },
  };
  className = '';
  hidden = false;
  type = '';
  value = '';
  private text = '';

  constructor(readonly tagName: string) {}

  get firstChild(): InMemoryElement | undefined {
    return this.children[0];
  }

  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value: string) {
    this.text = value;
    this.children.splice(0);
  }

  appendChild(child: InMemoryElement): InMemoryElement {
    this.children.push(child);
    return child;
  }

  removeChild(child: InMemoryElement): InMemoryElement {
    const index = this.children.indexOf(child);
    if (index < 0) {
      throw new Error('The child is not attached to the element.');
    }
    this.children.splice(index, 1);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addEventListener(eventName: string, listener: () => void): void {
    void eventName;
    void listener;
    // The property under test only needs to construct the card tree.
  }
}

class InMemoryDocument {
  readonly ticketList = new InMemoryElement('ul');
  private readonly nodes = new Map<string, InMemoryElement>([
    ['ticket-list', this.ticketList],
    ['ticket-list-summary', new InMemoryElement('p')],
    ['ticket-empty-state', new InMemoryElement('p')],
    ['open-count', new InMemoryElement('strong')],
    ['overdue-count', new InMemoryElement('strong')],
    ['resolved-count', new InMemoryElement('strong')],
  ]);

  createElement(tagName: string): InMemoryElement {
    return new InMemoryElement(tagName);
  }

  createTextNode(value: string): InMemoryElement {
    const node = new InMemoryElement('#text');
    node.textContent = value;
    return node;
  }

  getElementById(id: string): InMemoryElement | null {
    return this.nodes.get(id) ?? null;
  }
}

function loadPanelTestSurface(): PanelTestSurface {
  const panelScript = readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../public/panel/panel.js',
    ),
    'utf8',
  );
  const context: Record<string, unknown> = {};
  runInNewContext(panelScript, context, { filename: 'public/panel/panel.js' });
  return context.TicketOpsPanelTest as PanelTestSurface;
}

const signedOffsetArbitrary = fc.oneof(
  fc.integer({ min: 1, max: 365 * 24 * 60 * 60 * 1000 }),
  fc.integer({ min: -(365 * 24 * 60 * 60 * 1000), max: -1 }),
);

const temporalCaseArbitrary = fc.record({
  nowMs: fc.integer({
    min: Date.UTC(2020, 0, 1),
    max: Date.UTC(2030, 0, 1),
  }),
  offsetMs: signedOffsetArbitrary,
  overdueFlag: fc.boolean(),
});

describe('Property 7: presentación temporal con señal textual', () => {
  it('expresa futuro con «en» y vencimiento con «hace» y «VENCIDO» como texto', () => {
    const panel = loadPanelTestSurface();

    // **Validates: Requirements 6.3–6.5, 13.9**
    fc.assert(
      fc.property(temporalCaseArbitrary, ({ nowMs, offsetMs, overdueFlag }) => {
        const now = new Date(nowMs).toISOString();
        const dueAt = new Date(nowMs + offsetMs).toISOString();
        const expectedOverdue = overdueFlag || offsetMs < 0;
        const relativeDue = panel.formatRelativeDue(dueAt, now, overdueFlag);

        expect(relativeDue.overdue).toBe(expectedOverdue);
        if (expectedOverdue) {
          expect(relativeDue.text.startsWith('hace ')).toBe(true);
        } else {
          expect(relativeDue.text.startsWith('en ')).toBe(true);
        }

        const documentObject = new InMemoryDocument();
        panel.renderTicketCollection(
          documentObject,
          {
            tickets: [{
              id: 'generated-ticket',
              title: 'Ticket generado',
              dueAt,
              overdue: overdueFlag,
            }],
            selectedFilter: { kind: 'ALL' },
            query: { phase: 'success' },
          },
          now,
        );

        const renderedText = documentObject.ticketList.textContent;
        if (expectedOverdue) {
          expect(renderedText).toContain('VENCIDO');
        } else {
          expect(renderedText).not.toContain('VENCIDO');
        }
      }),
      { numRuns: 100 },
    );
  });
});
