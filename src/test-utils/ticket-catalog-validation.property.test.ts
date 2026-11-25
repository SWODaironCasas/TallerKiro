import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { InvalidRequestError } from '../domain/errors.js';
import {
  createTicketWithCatalogValidation,
  type CatalogValidatedTicket,
  type CreateTicketCatalogInput,
} from './ticket-catalog-validation.js';

const CATEGORIES = [
  'INFRAESTRUCTURA',
  'ACCESOS',
  'APLICACIONES',
  'INSTALACIONES',
] as const;

const PRIORITIES = ['CRITICA', 'ALTA', 'MEDIA', 'BAJA'] as const;

const nonEmptyTextArbitrary = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((value) => value.trim() === value && value.length > 0);

const validTicketInputArbitrary = fc.record({
  title: nonEmptyTextArbitrary,
  description: nonEmptyTextArbitrary,
  category: fc.constantFrom(...CATEGORIES),
  priority: fc.constantFrom(...PRIORITIES),
  requester: nonEmptyTextArbitrary,
});

const invalidTypeArbitrary: fc.Arbitrary<unknown> = fc.oneof(
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.array(fc.string(), { maxLength: 3 }),
  fc.dictionary(fc.string({ maxLength: 4 }), fc.integer(), { maxKeys: 3 }),
);

const unknownCategoryArbitrary = fc.string().filter(
  (value) => !CATEGORIES.includes(value as (typeof CATEGORIES)[number]),
);

const unknownPriorityArbitrary = fc.string().filter(
  (value) => !PRIORITIES.includes(value as (typeof PRIORITIES)[number]),
);

const invalidCatalogArbitrary = fc.oneof(
  unknownCategoryArbitrary.map((value) => ({
    field: 'category' as const,
    value,
  })),
  unknownPriorityArbitrary.map((value) => ({
    field: 'priority' as const,
    value,
  })),
  invalidTypeArbitrary.map((value) => ({
    field: 'category' as const,
    value,
  })),
  invalidTypeArbitrary.map((value) => ({
    field: 'priority' as const,
    value,
  })),
);

function expectInvalidCatalogRequest(
  input: CreateTicketCatalogInput,
  expectedField: 'category' | 'priority',
): void {
  const createdTickets: CatalogValidatedTicket[] = [];

  try {
    createTicketWithCatalogValidation(input, createdTickets);
    throw new Error('Expected catalog validation to reject the request');
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidRequestError);
    const requestError = error as InvalidRequestError;
    expect(requestError.code).toBe('INVALID_REQUEST');
    expect(requestError.statusCode).toBe(400);
    expect(requestError.details).toEqual([
      expect.objectContaining({ path: [expectedField] }),
    ]);
  }

  expect(createdTickets).toHaveLength(0);
}

// Feature: ticketops-api, Property 3: Catálogos y tipos inválidos se rechazan

describe('Property 3: invalid catalog values and types', () => {
  it('rejects unknown category or priority values without creating a ticket', () => {
    fc.assert(
      fc.property(validTicketInputArbitrary, invalidCatalogArbitrary, (validInput, invalid) => {
        const input = {
          ...validInput,
          [invalid.field]: invalid.value,
        } as CreateTicketCatalogInput;

        expectInvalidCatalogRequest(input, invalid.field);
      }),
      { numRuns: 100 },
    );
  });
});
