import { Router, type RequestHandler } from 'express';
import { TicketService } from '../application/ticket-service.js';
import type { AgentDirectory } from '../infrastructure/index.js';
import {
  requireActor,
  requireSupervisor,
} from './actor-middleware.js';
import {
  assignmentSchema,
  categoryFilterSchema,
  createTicketSchema,
  idParamSchema,
  statusSchema,
  ticketFilterSchema,
} from './schemas.js';
import {
  mapHistoryEntryToResponse,
  mapTicketToResponse,
} from './mappers.js';

export const ROUTE_CATALOG = [
  'GET /',
  'GET /health',
  'POST /tickets',
  'GET /tickets',
  'GET /tickets/:id',
  'PATCH /tickets/:id/assignment',
  'PATCH /tickets/:id/status',
  'GET /tickets/:id/history',
  'GET /tickets/overdue',
] as const;

export interface TicketRouterDependencies {
  service: TicketService;
  agentDirectory: AgentDirectory;
}

const routeHandler = (handler: RequestHandler): RequestHandler => handler;

/** Registers the TicketOps resource and service-information routes. */
export function registerTicketRoutes(
  router: Router,
  dependencies: TicketRouterDependencies,
): Router {
  const { service, agentDirectory } = dependencies;

  router.get('/', (_request, response) => {
    response.status(200).json({
      name: 'TicketOps API',
      status: 'ok',
      routes: [...ROUTE_CATALOG],
    });
  });

  router.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  router.post('/tickets', routeHandler((request, response) => {
    const input = createTicketSchema.parse(request.body);
    const ticket = service.create(input);
    response.status(201).json(mapTicketToResponse(ticket));
  }));

  router.get('/tickets', routeHandler((request, response) => {
    const filters = ticketFilterSchema.parse(request.query);
    const tickets = service.list(filters);
    response.status(200).json(tickets.map(mapTicketToResponse));
  }));

  // This literal route must stay before /tickets/:id.
  router.get(
    '/tickets/overdue',
    requireSupervisor(agentDirectory),
    routeHandler((request, response) => {
      const { category } = categoryFilterSchema.parse(request.query);
      const tickets = service.listOverdue(category, request.actorId);
      response.status(200).json(tickets.map(mapTicketToResponse));
    }),
  );

  router.get('/tickets/:id/history', routeHandler((request, response) => {
    const { id } = idParamSchema.parse(request.params);
    const history = service.history(id);
    response.status(200).json(history.map(mapHistoryEntryToResponse));
  }));

  router.get('/tickets/:id', routeHandler((request, response) => {
    const { id } = idParamSchema.parse(request.params);
    response.status(200).json(mapTicketToResponse(service.get(id)));
  }));

  router.patch(
    '/tickets/:id/assignment',
    requireActor(agentDirectory),
    routeHandler((request, response) => {
      const { id } = idParamSchema.parse(request.params);
      const { responsibleId } = assignmentSchema.parse(request.body);
      const ticket = service.assign(id, responsibleId, request.actorId as string);
      response.status(200).json(mapTicketToResponse(ticket));
    }),
  );

  router.patch(
    '/tickets/:id/status',
    requireActor(agentDirectory),
    routeHandler((request, response) => {
      const { id } = idParamSchema.parse(request.params);
      const { status, resolutionNote } = statusSchema.parse(request.body);
      const ticket = service.changeStatus(
        id,
        status,
        resolutionNote,
        request.actorId as string,
      );
      response.status(200).json(mapTicketToResponse(ticket));
    }),
  );

  return router;
}

/** Creates a router that can be mounted at the application root. */
export function createTicketRouter(
  dependencies: TicketRouterDependencies,
): Router {
  return registerTicketRoutes(Router(), dependencies);
}

export const createRoutes = createTicketRouter;
export const registerRoutes = registerTicketRoutes;
