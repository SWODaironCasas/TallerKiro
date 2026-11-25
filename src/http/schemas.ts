import { z } from 'zod';

const requiredText = z.string().trim().min(1);

export const categorySchema = z.enum([
  'INFRAESTRUCTURA',
  'ACCESOS',
  'APLICACIONES',
  'INSTALACIONES',
]);

export const prioritySchema = z.enum(['CRITICA', 'ALTA', 'MEDIA', 'BAJA']);

export const statusValueSchema = z.enum([
  'NUEVO',
  'ASIGNADO',
  'EN_PROGRESO',
  'EN_ESPERA',
  'RESUELTO',
  'CERRADO',
]);

/** Body accepted by POST /tickets. Unknown keys are rejected deliberately. */
export const createTicketSchema = z
  .object({
    title: requiredText.max(120),
    description: requiredText,
    category: categorySchema,
    priority: prioritySchema,
    requester: requiredText,
  })
  .strict();

/** Optional filters for GET /tickets. */
export const ticketFilterSchema = z
  .object({
    category: categorySchema.optional(),
    status: statusValueSchema.optional(),
    priority: prioritySchema.optional(),
  })
  .strict();

/** Body accepted by PATCH /tickets/:id/assignment. */
export const assignmentSchema = z
  .object({
    responsibleId: requiredText,
  })
  .strict();

/** Body accepted by PATCH /tickets/:id/status. */
export const statusSchema = z
  .object({
    status: statusValueSchema,
    resolutionNote: z.string().optional(),
  })
  .strict();

/** Raw X-Actor-Id header value after it has been extracted by HTTP middleware. */
export const actorHeaderSchema = requiredText;

/** Header object form for callers that validate a complete request header map. */
export const actorHeadersSchema = z
  .object({
    'X-Actor-Id': actorHeaderSchema,
  })
  .strict();

export const actorIdSchema = actorHeaderSchema;

/** Optional category filter for GET /tickets/overdue. */
export const categoryFilterSchema = z
  .object({
    category: categorySchema.optional(),
  })
  .strict();

/** Route parameter accepted by ticket resource endpoints. */
export const idParamSchema = z
  .object({
    id: requiredText,
  })
  .strict();

export type CreateTicketBody = z.infer<typeof createTicketSchema>;
export type TicketFilter = z.infer<typeof ticketFilterSchema>;
export type AssignmentBody = z.infer<typeof assignmentSchema>;
export type StatusBody = z.infer<typeof statusSchema>;
export type ActorHeader = z.infer<typeof actorHeaderSchema>;
export type ActorHeaders = z.infer<typeof actorHeadersSchema>;
export type CategoryFilter = z.infer<typeof categoryFilterSchema>;
export type IdParam = z.infer<typeof idParamSchema>;
