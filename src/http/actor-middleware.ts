import type { Request, RequestHandler } from 'express';
import {
  ActorRequiredError,
  ActorUnknownError,
  SupervisorRequiredError,
} from '../domain/index.js';
import type { ActorRecord } from '../domain/index.js';
import type { AgentDirectory } from '../infrastructure/index.js';

/** Values made available to handlers after actor authorization succeeds. */
declare global {
  // Express request augmentation is required to pass the resolved actor downstream.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actorId?: string;
      actor?: ActorRecord;
    }
  }
}

function requestHeaderValue(request: Request): unknown {
  const header = request.headers['x-actor-id'];
  if (Array.isArray(header)) {
    return header;
  }

  return header;
}

/** Reads and normalizes the X-Actor-Id header, preserving absent/invalid errors. */
export function parseActorId(value: unknown): string {
  if (value === undefined) {
    throw new ActorRequiredError('X-Actor-Id header is required');
  }

  if (typeof value !== 'string') {
    throw new ActorRequiredError(
      'X-Actor-Id header must be a non-empty string',
    );
  }

  const actorId = value.trim();
  if (actorId.length === 0) {
    throw new ActorRequiredError(
      'X-Actor-Id header must be a non-empty string',
    );
  }

  return actorId;
}

export function readActorId(request: Request): string {
  return parseActorId(requestHeaderValue(request));
}

function setActor(request: Request, actor: ActorRecord): void {
  request.actorId = actor.id;
  request.actor = actor;
}

/** Requires a known actor and exposes its trimmed identity to the route handler. */
export function requireActor(agentDirectory: AgentDirectory): RequestHandler {
  return (request, _response, next) => {
    try {
      const actorId = readActorId(request);
      const actor = agentDirectory.find(actorId);
      if (actor === undefined) {
        throw new ActorUnknownError();
      }

      setActor(request, actor);
      next();
    } catch (error: unknown) {
      next(error);
    }
  };
}

/** Requires an active supervisor without trusting any client-supplied role. */
export function requireSupervisor(
  agentDirectory: AgentDirectory,
): RequestHandler {
  return (request, _response, next) => {
    try {
      const actorId = readActorId(request);
      const actor = agentDirectory.find(actorId);
      if (actor?.role !== 'SUPERVISOR' || !actor.active) {
        throw new SupervisorRequiredError();
      }

      setActor(request, actor);
      next();
    } catch (error: unknown) {
      next(
        error instanceof SupervisorRequiredError
          ? error
          : new SupervisorRequiredError(),
      );
    }
  };
}

export const actorMiddleware = requireActor;
export const actorAuthorization = requireActor;
export const supervisorMiddleware = requireSupervisor;
export const supervisorAuthorization = requireSupervisor;
