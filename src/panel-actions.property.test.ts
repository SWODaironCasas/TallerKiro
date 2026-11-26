import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

const ACTIONS = [
  'ASSIGN',
  'START',
  'RESUME',
  'WAIT',
  'RESOLVE',
  'CLOSE',
  'REOPEN',
] as const;

type Action = (typeof ACTIONS)[number];

type Descriptor = {
  action: Action;
  method: 'PATCH';
  href: string;
  targetStatus: string | null;
  input: 'RESPONSIBLE_ID' | 'NONE' | 'RESOLUTION_NOTE';
};

interface TestElement {
  readonly tagName: string;
  textContent: string;
  readonly children: TestElement[];
  readonly attributes: Map<string, string>;
  firstChild: TestElement | undefined;
  appendChild(child: TestElement): TestElement;
  removeChild(child: TestElement): TestElement;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getAttribute(name: string): string | null;
}

class InMemoryElement implements TestElement {
  readonly children: TestElement[] = [];
  readonly attributes = new Map<string, string>();
  textContent = '';

  constructor(readonly tagName: string) {}

  get firstChild(): TestElement | undefined {
    return this.children[0];
  }

  appendChild(child: TestElement): TestElement {
    this.children.push(child);
    return child;
  }

  removeChild(child: TestElement): TestElement {
    const index = this.children.indexOf(child);
    if (index < 0) {
      throw new Error('The child is not attached to this element.');
    }
    this.children.splice(index, 1);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
}

class InMemoryDocument {
  readonly actions = new InMemoryElement('div');

  createElement(tagName: string): InMemoryElement {
    return new InMemoryElement(tagName);
  }

  createTextNode(value: string): InMemoryElement {
    const node = new InMemoryElement('#text');
    node.textContent = value;
    return node;
  }

  getElementById(id: string): InMemoryElement | null {
    return id === 'dialog-actions' ? this.actions : null;
  }
}

interface PanelTestSurface {
  readonly ACTION_LABELS: Readonly<Record<Action, string>>;
  readonly ACTION_DESCRIPTOR_CONTRACT: Readonly<
    Record<Action, { targetStatus: string | null; input: Descriptor['input'] }>
  >;
  renderTicketActions(
    documentObject: InMemoryDocument,
    ticket: { id: string; status: string; allowedTransitions: Descriptor[] },
    onAction?: undefined,
  ): { valid: boolean; descriptors: Descriptor[] };
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
const statuses = [
  'NUEVO',
  'ASIGNADO',
  'EN_PROGRESO',
  'EN_ESPERA',
  'RESUELTO',
  'CERRADO',
] as const;

function descriptorFor(action: Action): Descriptor {
  const contract = panel.ACTION_DESCRIPTOR_CONTRACT[action];
  return {
    action,
    method: 'PATCH',
    href: action === 'ASSIGN'
      ? '/tickets/generated/assignment'
      : '/tickets/generated/status',
    targetStatus: contract.targetStatus,
    input: contract.input,
  };
}

const allowedTransitionsArbitrary = fc
  .subarray(ACTIONS)
  .map((actions) => actions.map(descriptorFor));

const nonEmptyAllowedTransitionsArbitrary = fc
  .subarray(ACTIONS, { minLength: 1 })
  .map((actions) => actions.map(descriptorFor));

function renderedActions(documentObject: InMemoryDocument): Action[] {
  return documentObject.actions.children.map((button) =>
    button.getAttribute('data-action') as Action,
  );
}

function renderedLabels(documentObject: InMemoryDocument): string[] {
  return documentObject.actions.children.map((button) => button.textContent);
}

describe('Property 5: acciones derivadas exclusivamente de allowedTransitions', () => {
  it('renderiza un botón y su etiqueta por descriptor, sin inferir acciones del estado local', () => {
    // Feature: ticketops-panel, Property 5: Acciones exactamente derivadas de descriptors
    // **Validates: Requirements 8.1–8.9**
    fc.assert(
      fc.property(
        allowedTransitionsArbitrary,
        fc.constantFrom(...statuses),
        (allowedTransitions, status) => {
          const documentObject = new InMemoryDocument();
          const ticket = {
            id: 'generated-ticket',
            status,
            allowedTransitions,
          };

          const result = panel.renderTicketActions(documentObject, ticket);

          expect(result.valid).toBe(true);
          expect(result.descriptors).toEqual(allowedTransitions);
          expect(renderedActions(documentObject)).toEqual(
            allowedTransitions.map((descriptor) => descriptor.action),
          );
          expect(renderedLabels(documentObject)).toEqual(
            allowedTransitions.map((descriptor) => panel.ACTION_LABELS[descriptor.action]),
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it('retirar cualquier descriptor retira exactamente su control', () => {
    // Feature: ticketops-panel, Property 5: Acciones exactamente derivadas de descriptors
    // **Validates: Requirements 8.1–8.9**
    fc.assert(
      fc.property(nonEmptyAllowedTransitionsArbitrary, (allowedTransitions) => {
        const [removedDescriptor, ...remainingTransitions] = allowedTransitions;
        const documentObject = new InMemoryDocument();
        const ticket = {
          id: 'generated-ticket',
          status: 'EN_PROGRESO',
          allowedTransitions,
        };

        panel.renderTicketActions(documentObject, ticket);
        expect(renderedActions(documentObject)).toEqual(
          allowedTransitions.map((descriptor) => descriptor.action),
        );

        ticket.allowedTransitions = remainingTransitions;
        panel.renderTicketActions(documentObject, ticket);

        expect(renderedActions(documentObject)).toEqual(
          remainingTransitions.map((descriptor) => descriptor.action),
        );
        expect(renderedActions(documentObject)).not.toContain(removedDescriptor.action);
      }),
      { numRuns: 100 },
    );
  });
});
