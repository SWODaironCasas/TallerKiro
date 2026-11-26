import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

type CreateForm = {
  title: string;
  description: string;
  category: string;
  priority: string;
  requester: string;
  responsibleId: string;
  responsible: string;
  responsable: string;
};

type CreateBody = {
  title: string;
  description: string;
  category: string;
  priority: string;
  requester: string;
};

type PanelTestSurface = {
  buildCreateTicketBody: (draft: CreateForm) => CreateBody;
  validateCreateDraft: (draft: CreateForm) => {
    valid: boolean;
    normalized: CreateBody;
    fieldErrors: Record<string, string>;
  };
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

function validTextArbitrary(maxLength: number): fc.Arbitrary<string> {
  return fc
    .string({ maxLength: maxLength - 1 })
    .map((value) => ` ${value}x `);
}

const createFormArbitrary: fc.Arbitrary<CreateForm> = fc.record({
  title: validTextArbitrary(120),
  description: validTextArbitrary(160),
  category: fc.constantFrom(
    'INFRAESTRUCTURA',
    'ACCESOS',
    'APLICACIONES',
    'INSTALACIONES',
  ),
  priority: fc.constantFrom('CRITICA', 'ALTA', 'MEDIA', 'BAJA'),
  requester: validTextArbitrary(80),
  responsibleId: validTextArbitrary(40),
  responsible: validTextArbitrary(40),
  responsable: validTextArbitrary(40),
});

const expectedBodyKeys = [
  'title',
  'description',
  'category',
  'priority',
  'requester',
].sort();

const forbiddenBodyKeys = ['responsibleId', 'responsible', 'responsable'];

describe('Property 2: body de creación exacto', () => {
  it('normaliza textos y conserva exactamente las cinco claves del contrato', () => {
    const panelTestSurface = loadPanelTestSurface();

    // Feature: ticketops-panel, Property 2: Body de creación exacto
    // **Validates: Requirements 5.4, 5.6, 5.7, 12.4, 15.3**
    fc.assert(
      fc.property(createFormArbitrary, (form) => {
        const validation = panelTestSurface.validateCreateDraft(form);
        expect(validation.valid).toBe(true);
        expect(validation.fieldErrors).toEqual({});

        const expectedBody: CreateBody = {
          title: form.title.trim(),
          description: form.description.trim(),
          category: form.category,
          priority: form.priority,
          requester: form.requester.trim(),
        };
        const body = panelTestSurface.buildCreateTicketBody(form);

        expect(Object.keys(body).sort()).toEqual(expectedBodyKeys);
        expect(body).toEqual(expectedBody);
        for (const forbiddenKey of forbiddenBodyKeys) {
          expect(Object.prototype.hasOwnProperty.call(body, forbiddenKey)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});
