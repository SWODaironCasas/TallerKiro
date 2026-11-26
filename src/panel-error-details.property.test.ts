import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

const PANEL_SCRIPT_PATH = fileURLToPath(new URL('../public/panel/panel.js', import.meta.url));
const PANEL_SCRIPT = readFileSync(PANEL_SCRIPT_PATH, 'utf8');
const CREATE_FIELDS = ['title', 'description', 'category', 'priority', 'requester'] as const;
type CreateField = (typeof CREATE_FIELDS)[number];

type PanelTestSurface = {
  showCreateApiError: (documentObject: FakeDocument, error: unknown) => void;
};

type FakeNode = {
  value?: string;
  textContent: string;
  className: string;
  dataset: Record<string, string>;
  attributes: Map<string, string>;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
};

class FakeDocument {
  private readonly nodes = new Map<string, FakeNode>();

  getNode(id: string, value?: string): FakeNode {
    const node: FakeNode = {
      value,
      textContent: '',
      className: '',
      dataset: {},
      attributes: new Map(),
      setAttribute(name, attributeValue) {
        this.attributes.set(name, attributeValue);
      },
      removeAttribute(name) {
        this.attributes.delete(name);
      },
    };
    this.nodes.set(id, node);
    return node;
  }

  getElementById(id: string): FakeNode | null {
    return this.nodes.get(id) ?? null;
  }
}

function loadPanelTestSurface(): PanelTestSurface {
  const context: Record<string, unknown> = {};
  vm.runInNewContext(PANEL_SCRIPT, context, { filename: PANEL_SCRIPT_PATH });
  return context.TicketOpsPanelTest as PanelTestSurface;
}

const panelTest = loadPanelTestSurface();

const nonEmptyTextArbitrary = fc
  .string({ minLength: 1, maxLength: 32 })
  .filter((value) => value.trim().length > 0)
  .map((value) => value.trim());

const validDraftArbitrary = fc.record({
  title: nonEmptyTextArbitrary,
  description: nonEmptyTextArbitrary,
  category: fc.constantFrom('INFRAESTRUCTURA', 'ACCESOS', 'APLICACIONES', 'INSTALACIONES'),
  priority: fc.constantFrom('CRITICA', 'ALTA', 'MEDIA', 'BAJA'),
  requester: nonEmptyTextArbitrary,
});

const fieldMessageArbitrary = fc.record({
  title: nonEmptyTextArbitrary,
  description: nonEmptyTextArbitrary,
  category: nonEmptyTextArbitrary,
  priority: nonEmptyTextArbitrary,
  requester: nonEmptyTextArbitrary,
});

const unknownPathArbitrary = nonEmptyTextArbitrary.map((value) => `unknown-${value}`);

function createDocumentForDraft(draft: Record<CreateField, string>): {
  documentObject: FakeDocument;
  controls: Record<CreateField, FakeNode>;
  fieldErrors: Record<CreateField, FakeNode>;
  generalError: FakeNode;
} {
  const documentObject = new FakeDocument();
  const controls = {} as Record<CreateField, FakeNode>;
  const fieldErrors = {} as Record<CreateField, FakeNode>;

  for (const field of CREATE_FIELDS) {
    controls[field] = documentObject.getNode(`ticket-${field}`, draft[field]);
    fieldErrors[field] = documentObject.getNode(`ticket-${field}-error`);
  }

  const generalError = documentObject.getNode('new-ticket-form-errors');
  documentObject.getNode('panel-message');
  return { documentObject, controls, fieldErrors, generalError };
}

// Feature: ticketops-panel, Property 10: Details de validación y conservación del draft
// Validates: Requirements 5.9, 11.2

describe('Property 10: INVALID_REQUEST details and draft preservation', () => {
  it('associates known paths, reports unknown paths generally, and preserves every valid draft value', () => {
    fc.assert(
      fc.property(validDraftArbitrary, fieldMessageArbitrary, unknownPathArbitrary, (draft, messages, unknownPath) => {
        const { documentObject, controls, fieldErrors, generalError } = createDocumentForDraft(draft);
        const details = CREATE_FIELDS.map((field) => ({
          path: [field],
          message: messages[field],
        }));
        details.push({ path: [unknownPath], message: 'Error general de validación' });

        panelTest.showCreateApiError(documentObject, {
          code: 'INVALID_REQUEST',
          message: 'Revisa los datos introducidos.',
          details,
        });

        for (const field of CREATE_FIELDS) {
          expect(fieldErrors[field].textContent).toBe(messages[field]);
          expect(controls[field].value).toBe(draft[field]);
        }
        expect(generalError.textContent).toContain('Error general de validación');
      }),
      { numRuns: 100 },
    );
  });
});
