import { InvalidRequestError } from '../domain/errors.js';

export interface CreateTicketTextInput {
  title: unknown;
  description: unknown;
  requester: unknown;
}

export interface NormalizedTicketTextInput {
  title: string;
  description: string;
  requester: string;
}

/**
 * Test-only adapter for the text contract used by ticket creation.
 * It keeps Property 2 executable before the HTTP/Zod layer exists.
 */
export function normalizeTicketTextInput(
  input: CreateTicketTextInput,
): NormalizedTicketTextInput {
  const title = normalizeRequiredText(input.title, 'title');
  const description = normalizeRequiredText(input.description, 'description');
  const requester = normalizeRequiredText(input.requester, 'requester');

  if (title.length > 120) {
    throw new InvalidRequestError('Request validation failed', [
      {
        path: ['title'],
        message: 'Title must be at most 120 characters after trimming',
        code: 'too_big',
      },
    ]);
  }

  return { title, description, requester };
}

function normalizeRequiredText(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new InvalidRequestError('Request validation failed', [
      { path: [field], message: 'Expected a string', code: 'invalid_type' },
    ]);
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new InvalidRequestError('Request validation failed', [
      { path: [field], message: 'Required text cannot be empty', code: 'too_small' },
    ]);
  }

  return normalized;
}
