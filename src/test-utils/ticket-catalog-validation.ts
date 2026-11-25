import { InvalidRequestError } from '../domain/errors.js';
import type { Category, Priority } from '../domain/types.js';

export interface CreateTicketCatalogInput {
  title: string;
  description: string;
  category: unknown;
  priority: unknown;
  requester: string;
}

export interface CatalogValidatedTicket {
  title: string;
  description: string;
  category: Category;
  priority: Priority;
  requester: string;
}

const CATEGORIES: readonly Category[] = [
  'INFRAESTRUCTURA',
  'ACCESOS',
  'APLICACIONES',
  'INSTALACIONES',
];

const PRIORITIES: readonly Priority[] = ['CRITICA', 'ALTA', 'MEDIA', 'BAJA'];

/**
 * Test-only adapter for the catalog contract used by ticket creation.
 * It keeps Property 3 executable before the HTTP/Zod layer exists.
 */
export function createTicketWithCatalogValidation(
  input: CreateTicketCatalogInput,
  createdTickets: CatalogValidatedTicket[],
): CatalogValidatedTicket {
  const category = validateCatalogValue(input.category, 'category', CATEGORIES);
  const priority = validateCatalogValue(input.priority, 'priority', PRIORITIES);

  const ticket: CatalogValidatedTicket = {
    title: input.title,
    description: input.description,
    category,
    priority,
    requester: input.requester,
  };

  createdTickets.push(ticket);
  return ticket;
}

function validateCatalogValue<T extends string>(
  value: unknown,
  field: 'category' | 'priority',
  allowedValues: readonly T[],
): T {
  if (typeof value !== 'string' || !allowedValues.includes(value as T)) {
    throw new InvalidRequestError('Request validation failed', [
      {
        path: [field],
        message: `Unknown or invalid ${field}`,
        code: 'invalid_value',
      },
    ]);
  }

  return value as T;
}
