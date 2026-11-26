import express, {
  type Express,
  type ErrorRequestHandler,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TicketService } from './application/ticket-service.js';
import {
  InvalidJsonError,
  MethodNotAllowedError,
  RouteNotFoundError,
} from './domain/index.js';
import {
  InMemoryAgentDirectory,
  InMemorySupervisorNotifier,
  InMemoryTicketStore,
  RandomUuidGenerator,
  SystemClock,
  type AgentDirectory,
  type Clock,
  type IdGenerator,
  type SupervisorNotifier,
  type TicketStore,
} from './infrastructure/index.js';
import {
  createTicketRouter,
  ROUTE_CATALOG,
} from './http/ticket-routes.js';
import { standardErrorHandler } from './http/error-handler.js';

export { ROUTE_CATALOG };

export interface AppDependencies {
  store: TicketStore;
  clock: Clock;
  idGenerator: IdGenerator;
  agentDirectory?: AgentDirectory;
  supervisorNotifier?: SupervisorNotifier;
}

type RouteMethod = (typeof ROUTE_CATALOG)[number] extends `${infer Method} ${string}`
  ? Method
  : never;

interface RouteDefinition {
  method: RouteMethod;
  path: string;
}

const ROUTE_DEFINITIONS: readonly RouteDefinition[] = ROUTE_CATALOG.map(
  (route) => {
    const separator = route.indexOf(' ');
    return {
      method: route.slice(0, separator) as RouteMethod,
      path: route.slice(separator + 1),
    };
  },
);

function normalizedPath(path: string): string {
  const withoutQuery = path.split('?', 1)[0] ?? path;
  if (withoutQuery.length <= 1) {
    return '/';
  }

  return withoutQuery.replace(/\/+$/, '');
}

function routeMatchesPath(routePath: string, requestPath: string): boolean {
  const routeSegments = normalizedPath(routePath).split('/').filter(Boolean);
  const requestSegments = normalizedPath(requestPath).split('/').filter(Boolean);

  if (routeSegments.length !== requestSegments.length) {
    return false;
  }

  return routeSegments.every(
    (segment, index) =>
      segment.startsWith(':') || segment === requestSegments[index],
  );
}

function allowedMethodsForPath(path: string): string[] {
  return ROUTE_DEFINITIONS.filter((route) =>
    routeMatchesPath(route.path, path),
  ).reduce<string[]>((methods, route) => {
    if (!methods.includes(route.method)) {
      methods.push(route.method);
    }
    return methods;
  }, []);
}

function methodNotAllowedMiddleware(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  const allowedMethods = allowedMethodsForPath(request.path);
  if (allowedMethods.length === 0 || allowedMethods.includes(request.method)) {
    next();
    return;
  }

  next(new MethodNotAllowedError(undefined, allowedMethods));
}

function isMalformedJsonError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') {
    return false;
  }

  const candidate = error as {
    type?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };

  return (
    candidate.type === 'entity.parse.failed' ||
    candidate.status === 400 ||
    candidate.statusCode === 400
  );
}

const jsonErrorNormalizer: ErrorRequestHandler = (
  error: unknown,
  _request: Request,
  _response: Response,
  next: NextFunction,
): void => {
  if (isMalformedJsonError(error)) {
    next(new InvalidJsonError());
    return;
  }

  next(error);
};

function createDefaultDependencies(): AppDependencies {
  return {
    store: new InMemoryTicketStore(),
    clock: new SystemClock(),
    idGenerator: new RandomUuidGenerator(),
    agentDirectory: new InMemoryAgentDirectory(),
    supervisorNotifier: new InMemorySupervisorNotifier(),
  };
}

/** Creates an isolated Express application without opening a listener. */
export function createApp(dependencies?: AppDependencies): Express {
  const configured = dependencies ?? createDefaultDependencies();
  const agentDirectory =
    configured.agentDirectory ?? new InMemoryAgentDirectory();
  const supervisorNotifier =
    configured.supervisorNotifier ?? new InMemorySupervisorNotifier();
  const service = new TicketService({
    store: configured.store,
    clock: configured.clock,
    idGenerator: configured.idGenerator,
    agentDirectory,
    supervisorNotifier,
  });

  const application = express();
  const panelRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'public',
    'panel',
  );

  application.use(
    '/panel',
    express.static(panelRoot, { index: 'index.html' }),
  );

  application.use(express.json());
  application.use(jsonErrorNormalizer);
  application.use(createTicketRouter({ service, agentDirectory }));
  application.use(methodNotAllowedMiddleware);
  application.use((_request, _response, next) => {
    next(new RouteNotFoundError());
  });
  application.use(standardErrorHandler);

  return application;
}

/** Default isolated in-memory application for normal process execution. */
export const app = createApp(createDefaultDependencies());

export default app;
