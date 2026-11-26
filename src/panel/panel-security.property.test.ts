import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

type TreeNode = SafeElement | SafeTextNode;

type PanelTestSurface = {
  renderTicketDetail: (
    documentObject: SecurityDocument,
    ticket: Record<string, unknown>,
  ) => void;
};

type LoadedPanel = {
  surface: PanelTestSurface;
  context: Record<string, unknown>;
};

class SafeTextNode {
  readonly nodeType = 3;
  parentNode: SafeElement | null = null;

  constructor(public textContent: string) {}
}

class SafeElement {
  readonly children: TreeNode[] = [];
  readonly attributes = new Map<string, string>();
  parentNode: SafeElement | null = null;
  className = '';
  private ownText = '';

  constructor(readonly tagName: string) {}

  get firstChild(): TreeNode | undefined {
    return this.children[0];
  }

  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value: string) {
    this.ownText = value;
    this.children.length = 0;
  }

  set innerHTML(_value: string) {
    throw new Error('Se intentó usar innerHTML en el DOM de prueba.');
  }

  set outerHTML(_value: string) {
    throw new Error('Se intentó usar outerHTML en el DOM de prueba.');
  }

  insertAdjacentHTML(): never {
    throw new Error('Se intentó usar insertAdjacentHTML en el DOM de prueba.');
  }

  appendChild<T extends TreeNode>(child: T): T {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: TreeNode): void {
    const index = this.children.indexOf(child);
    if (index < 0) {
      throw new Error('El nodo no está asociado al elemento.');
    }
    this.children.splice(index, 1);
    child.parentNode = null;
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

class SecurityDocument {
  readonly title = new SafeElement('h2');
  readonly fields = new SafeElement('dl');
  readonly actions = new SafeElement('div');
  readonly createdElements: SafeElement[] = [];
  readonly createdTextNodes: SafeTextNode[] = [];

  write(): never {
    throw new Error('Se intentó usar document.write en el DOM de prueba.');
  }

  createElement(tagName: string): SafeElement {
    const element = new SafeElement(tagName);
    this.createdElements.push(element);
    return element;
  }

  createTextNode(value: string): SafeTextNode {
    const node = new SafeTextNode(value);
    this.createdTextNodes.push(node);
    return node;
  }

  getElementById(id: string): SafeElement | null {
    if (id === 'dialog-title') {
      return this.title;
    }
    if (id === 'ticket-detail-fields') {
      return this.fields;
    }
    if (id === 'dialog-actions') {
      return this.actions;
    }
    return null;
  }
}

function loadPanelTestSurface(): LoadedPanel {
  const panelScript = readFileSync(
    new URL('../../public/panel/panel.js', import.meta.url),
    'utf8',
  );
  const context: Record<string, unknown> = { executionMarker: 0 };
  runInNewContext(panelScript, context, { filename: 'public/panel/panel.js' });
  return {
    surface: context.TicketOpsPanelTest as PanelTestSurface,
    context,
  };
}

const loadedPanel = loadPanelTestSurface();
const panel = loadedPanel.surface;
const panelSource = readFileSync(
  new URL('../../public/panel/panel.js', import.meta.url),
  'utf8',
);

const payloadArbitrary = fc
  .tuple(
    fc.string({ maxLength: 24 }),
    fc.string({ maxLength: 24 }),
    fc.string({ maxLength: 24 }),
  )
  .map(([tagText, attributeText, entityText]) =>
    `<article data-probe="${attributeText}">${tagText}</article>` +
    `&lt;entity-${entityText}&amp;` +
    `<script>globalThis.executionMarker += 1</script>` +
    `<img src="x" onerror="globalThis.executionMarker += 1">`,
  );

function createTicket(payload: string): Record<string, unknown> {
  return {
    id: payload,
    title: payload,
    description: payload,
    category: 'ACCESOS',
    priority: 'ALTA',
    status: 'EN_PROGRESO',
    requester: payload,
    responsibleId: payload,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T01:00:00.000Z',
    dueAt: '2025-01-03T00:00:00.000Z',
    resolvedAt: null,
    closedAt: null,
    resolutionNote: payload,
    allowedTransitions: [],
  };
}

function renderedDetailValues(documentObject: SecurityDocument): Map<string, string> {
  if (documentObject.fields.children.length % 2 !== 0) {
    throw new Error('El detalle no generó pares etiqueta/valor.');
  }

  const fields = new Map<string, string>();
  for (let index = 0; index < documentObject.fields.children.length; index += 2) {
    const label = documentObject.fields.children[index];
    const value = documentObject.fields.children[index + 1];
    if (!(label instanceof SafeElement) || !(value instanceof SafeElement)) {
      throw new Error('El detalle generó nodos inesperados.');
    }
    fields.set(label.textContent, value.textContent);
  }
  return fields;
}

const fixedElementTags = new Set(['dt', 'dd']);
const forbiddenSinkPatterns = [
  /\.innerHTML\b/,
  /\.outerHTML\b/,
  /\bdocument\.write\b/,
  /\.insertAdjacentHTML\b/,
  /\.createContextualFragment\b/,
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
];

describe('Property 9: renderizado literal seguro', () => {
  it('conserva payloads literales sin crear nodos derivados ni ejecutar código', () => {
    // Feature: ticketops-panel, Property 9: Renderizado literal seguro
    // **Validates: Requirements 6.7, 12.1, 12.2**
    fc.assert(
      fc.property(payloadArbitrary, (payload) => {
        const documentObject = new SecurityDocument();
        const ticket = createTicket(payload);

        panel.renderTicketDetail(documentObject, ticket);

        const fields = renderedDetailValues(documentObject);
        expect(fields.get('ID')).toBe(payload);
        expect(fields.get('Título')).toBe(payload);
        expect(fields.get('Descripción')).toBe(payload);
        expect(fields.get('Solicitante')).toBe(payload);
        expect(fields.get('Responsable')).toBe(payload);
        expect(fields.get('Nota de resolución')).toBe(payload);
        expect(documentObject.title.textContent).toBe(`Detalle del ticket ${payload}`);
        expect(loadedPanel.context.executionMarker).toBe(0);

        expect(documentObject.createdElements.every((element) =>
          fixedElementTags.has(element.tagName),
        )).toBe(true);
        expect(documentObject.createdElements.some((element) =>
          element.tagName.includes(payload),
        )).toBe(false);
        expect(documentObject.createdTextNodes).toHaveLength(0);

        for (const pattern of forbiddenSinkPatterns) {
          expect(panelSource).not.toMatch(pattern);
        }
      }),
      { numRuns: 100 },
    );
  });
});
