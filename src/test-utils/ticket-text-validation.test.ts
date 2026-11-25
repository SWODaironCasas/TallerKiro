import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { InvalidRequestError } from '../domain/errors.js';
import {
  normalizeTicketTextInput,
  type NormalizedTicketTextInput,
} from './ticket-text-validation.js';

const whitespaceArbitrary = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r', '\f'), {
    minLength: 0,
    maxLength: 8,
  })
  .map((characters) => characters.join(''));

const textArbitrary = fc
  .array(fc.constantFrom('a', 'b', 'c', 'x', 'y', 'z', '0', '1', '-', '_'), {
    minLength: 1,
    maxLength: 24,
  })
  .map((characters) => characters.join(''));

const paddedTextArbitrary = fc
  .tuple(whitespaceArbitrary, textArbitrary, whitespaceArbitrary)
  .map(([left, text, right]) => `${left}${text}${right}`);

const validTicketTextInputArbitrary = fc.record({
  description: paddedTextArbitrary,
  requester: paddedTextArbitrary,
});

const assertInvalidRequest = (input: {
  title: unknown;
  description: unknown;
  requester: unknown;
}): void => {
  expect(() => normalizeTicketTextInput(input)).toThrow(InvalidRequestError);
};

// Feature: ticketops-api, Property 2: Textos y título se validan después de recortar

describe('Property 2: normalized ticket text validation', () => {
  it('rejects every required text that is empty after trimming', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('title', 'description', 'requester'),
        whitespaceArbitrary,
        fc.integer({ min: 1, max: 120 }),
        validTicketTextInputArbitrary,
        (field, emptyText, titleLength, validTexts) => {
          const input = {
            title: 't'.repeat(titleLength),
            description: validTexts.description,
            requester: validTexts.requester,
          };

          input[field] = emptyText;
          assertInvalidRequest(input);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('accepts normalized titles from one through 120 characters', () => {
    fc.assert(
      fc.property(
        whitespaceArbitrary,
        fc.integer({ min: 1, max: 120 }),
        whitespaceArbitrary,
        validTicketTextInputArbitrary,
        (left, titleLength, right, validTexts) => {
          const title = `${left}${'t'.repeat(titleLength)}${right}`;
          const normalized = normalizeTicketTextInput({
            title,
            description: validTexts.description,
            requester: validTexts.requester,
          });

          const expected: NormalizedTicketTextInput = {
            title: 't'.repeat(titleLength),
            description: validTexts.description.trim(),
            requester: validTexts.requester.trim(),
          };

          expect(normalized).toEqual(expected);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects titles longer than 120 characters after trimming', () => {
    fc.assert(
      fc.property(
        whitespaceArbitrary,
        fc.integer({ min: 121, max: 180 }),
        whitespaceArbitrary,
        validTicketTextInputArbitrary,
        (left, titleLength, right, validTexts) => {
          assertInvalidRequest({
            title: `${left}${'t'.repeat(titleLength)}${right}`,
            description: validTexts.description,
            requester: validTexts.requester,
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});
