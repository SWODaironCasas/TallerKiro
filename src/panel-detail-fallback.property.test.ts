import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

type Primitive = string | null | undefined;
type OptionalField = { value: Primitive };

class FakeTextNode {
  readonly nodeType = 3;
  parentNode: FakeElement | null = null;

  constructor(public textContent: string) {}
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, () => void>();
  parentNode: FakeElement | null = null;
  className = '';
  hidden = false;
  disabled = false;
  type = '';
  value = '';
  dataset: Record<string, string> = {};
  private ownText = '';

  constructor(readonly tagName: string) {}

  get firstChild(): FakeElement | FakeTextNode | undefined {
    return this.children[0];
  }

  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value: string) {
    this.ownText = value;
    this.children.length = 0;
  }

  appendChild<T extends FakeElement | FakeTextNode>(child: T): T {
    if (child instanceof FakeElement) {
      child.parentNode = this;
    } else {
      child.parentNode = this;
    }
    this.children.push(child as unknown as FakeElement);
    return child;
  }

  removeChild(child: FakeElement | FakeTextNode): void {
    const index = this.children.indexOf(child as FakeElement);
    if (index >= 0) {
      this.children.splice(index, 1);
    }
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

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, listener);
  }
}

class FakeDocument {
  private readonly elements = new Map<string, FakeElement>();

  constructor() {
    this.elements.set('dialog-title', new FakeElement('h2'));
    this.elements.set('ticket-detail-fields', new FakeElement('dl'));
    this.elements.set('dialog-actions', new FakeElement('div'));
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }

  createTextNode(value: string): FakeTextNode {
    return new FakeTextNode(value);
  }

  getElementById(id: string): FakeElement | null {
    return this.elements.get(id) ?? null;
  }
}

function loadPanelTestSurface(): {
  renderTicketDetail: (documentObject: FakeDocument, ticket: Record<string, unknown>) => void;
  formatDateTime: (value: unknown) => string;
} {
  const source = readFileSync(new URL('../public/panel/panel.js', import.meta.url), 'utf8');
  const sandbox: Record<string, unknown> = {};
  runInNewContext(source, sandbox);

  const surface = sandbox.TicketOpsPanelTest as {
    renderTicketDetail: (
      documentObject: FakeDocument,
      ticket: Record<string, unknown>,
    ) => void;
    formatDateTime: (value: unknown) => string;
  };

  if (!surface) {
    throw new Error('No se pudo cargar la superficie de pruebas del panel.');
  }
  return surface;
}

const surface = loadPanelTestSurface();

const optionalFieldArbitrary = (valueArbitrary: fc.Arbitrary<string>): fc.Arbitrary<OptionalField> =>
  fc.oneof(
    fc.constant({ value: undefined }),
    fc.constant({ value: null }),
    valueArbitrary.map((value) => ({ value })),
  );

const nonEmptyTextArbitrary = fc.string({ minLength: 1 }).filter((value) => value.trim().length > 0);
const optionalTextArbitrary = optionalFieldArbitrary(nonEmptyTextArbitrary);
const optionalDateArbitrary = optionalFieldArbitrary(
  fc.constantFrom(
    '2025-01-02T03:04:05.000Z',
    '2026-06-15T12:30:00.000Z',
    '2030-12-31T23:59:59.000Z',
  ),
);

function createTicket(fields: {
  description: OptionalField;
  requester: OptionalField;
  responsibleId: OptionalField;
  resolutionNote: OptionalField;
  resolvedAt: OptionalField;
  closedAt: OptionalField;
}): Record<string, unknown> {
  const ticket: Record<string, unknown> = {
    id: 'ticket-detail-property',
    title: 'Detalle generado',
    category: 'ACCESOS',
    priority: 'ALTA',
    status: 'RESUELTO',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T01:00:00.000Z',
    dueAt: '2025-01-03T00:00:00.000Z',
    overdue: false,
    allowedTransitions: [],
  };

  for (const [field, optional] of Object.entries(fields)) {
    if (optional.value !== undefined) {
      ticket[field] = optional.value;
    }
  }
  return ticket;
}

function renderedDetailFields(documentObject: FakeDocument): Array<{ label: string; value: string }> {
  const fields = documentObject.getElementById('ticket-detail-fields');
  if (!fields) {
    throw new Error('No se encontró el contenedor de detalle.');
  }
  if (fields.children.length % 2 !== 0) {
    throw new Error('El detalle no generó pares etiqueta/valor.');
  }

  const rendered: Array<{ label: string; value: string }> = [];
  for (let index = 0; index < fields.children.length; index += 2) {
    rendered.push({
      label: fields.children[index].textContent,
      value: fields.children[index + 1].textContent,
    });
  }
  return rendered;
}

// Feature: ticketops-panel, Property 8: Fallback explícito del detalle
// **Validates: Requirements 6.6**
describe('TicketOps Panel detail fallback property', () => {
  it('muestra literalmente los opcionales presentes y No disponible junto a su etiqueta cuando faltan', () => {
    fc.assert(
      fc.property(
        optionalTextArbitrary,
        optionalTextArbitrary,
        optionalTextArbitrary,
        optionalTextArbitrary,
        optionalDateArbitrary,
        optionalDateArbitrary,
        (description, requester, responsibleId, resolutionNote, resolvedAt, closedAt) => {
          const documentObject = new FakeDocument();
          const ticket = createTicket({
            description,
            requester,
            responsibleId,
            resolutionNote,
            resolvedAt,
            closedAt,
          });

          surface.renderTicketDetail(documentObject, ticket);

          const fields = renderedDetailFields(documentObject);
          const byLabel = new Map(fields.map((field) => [field.label, field.value]));
          const expectedTextFields = {
            Descripción: description,
            Solicitante: requester,
            Responsable: responsibleId,
            'Nota de resolución': resolutionNote,
          };

          for (const [label, optional] of Object.entries(expectedTextFields)) {
            expect(byLabel.get(label)).toBe(
              optional.value === null || optional.value === undefined
                ? 'No disponible'
                : optional.value,
            );
          }

          expect(byLabel.get('Resuelto')).toBe(
            resolvedAt.value === null || resolvedAt.value === undefined
              ? 'No disponible'
              : surface.formatDateTime(resolvedAt.value),
          );
          expect(byLabel.get('Cerrado')).toBe(
            closedAt.value === null || closedAt.value === undefined
              ? 'No disponible'
              : surface.formatDateTime(closedAt.value),
          );

          for (const label of ['Descripción', 'Solicitante', 'Responsable', 'Resuelto', 'Cerrado', 'Nota de resolución']) {
            expect(byLabel.has(label)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
