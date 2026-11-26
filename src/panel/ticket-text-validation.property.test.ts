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
};

type ValidationResult = {
  valid: boolean;
  normalized: CreateForm;
  fieldErrors: Record<string, string>;
};

type PanelTestSurface = {
  validateCreateDraft: (draft: CreateForm) => ValidationResult;
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

const whitespaceArbitrary = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\u00a0'), {
    minLength: 0,
    maxLength: 20,
  })
  .map((characters) => characters.join(''));

const validFormArbitrary: fc.Arbitrary<CreateForm> = fc.record({
  title: fc.constant('Título válido'),
  description: fc.constant('Descripción válida'),
  category: fc.constant('ACCESOS'),
  priority: fc.constant('MEDIA'),
  requester: fc.constant('solicitante-1'),
});

function formWith(overrides: Partial<CreateForm>): CreateForm {
  return {
    title: 'Título válido',
    description: 'Descripción válida',
    category: 'ACCESOS',
    priority: 'MEDIA',
    requester: 'solicitante-1',
    ...overrides,
  };
}

describe('Property 3: validación de textos y límites', () => {
  it('rechaza strings vacíos o de whitespace y asocia el error al campo', () => {
    const panelTestSurface = loadPanelTestSurface();

    // Feature: ticketops-panel, Property 3: Validación de textos y límites
    // **Validates: Requirements 3.3, 5.4, 5.5, 9.2, 10.3**
    fc.assert(
      fc.property(
        fc.constantFrom('title', 'description', 'requester'),
        whitespaceArbitrary,
        (field, emptyValue) => {
          const validation = panelTestSurface.validateCreateDraft(
            formWith({ [field]: emptyValue }),
          );

          expect(validation.valid).toBe(false);
          expect(validation.normalized[field as keyof CreateForm]).toBe('');
          expect(validation.fieldErrors[field]).toEqual(expect.any(String));
          expect(validation.fieldErrors[field].length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('acepta títulos de longitud entre 1 y 120 tras normalizarlos', () => {
    const panelTestSurface = loadPanelTestSurface();

    // **Validates: Requirements 5.4, 5.5**
    fc.assert(
      fc.property(
        whitespaceArbitrary,
        fc.integer({ min: 1, max: 120 }),
        whitespaceArbitrary,
        validFormArbitrary,
        (left, titleLength, right, validForm) => {
          const title = `${left}${'t'.repeat(titleLength)}${right}`;
          const validation = panelTestSurface.validateCreateDraft(
            formWith({ ...validForm, title }),
          );

          expect(validation.valid).toBe(true);
          expect(validation.fieldErrors).toEqual({});
          expect(validation.normalized.title).toBe('t'.repeat(titleLength));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rechaza títulos de longitud mayor de 120 y asocia el error a title', () => {
    const panelTestSurface = loadPanelTestSurface();

    // **Validates: Requirements 5.4, 5.5**
    fc.assert(
      fc.property(
        whitespaceArbitrary,
        fc.integer({ min: 121, max: 200 }),
        whitespaceArbitrary,
        (left, titleLength, right) => {
          const validation = panelTestSurface.validateCreateDraft(
            formWith({ title: `${left}${'t'.repeat(titleLength)}${right}` }),
          );

          expect(validation.valid).toBe(false);
          expect(validation.fieldErrors.title).toEqual(expect.any(String));
          expect(validation.fieldErrors.title).toContain('120');
        },
      ),
      { numRuns: 100 },
    );
  });
});
