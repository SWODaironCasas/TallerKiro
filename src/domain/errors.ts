export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_JSON'
  | 'ACTOR_REQUIRED'
  | 'ACTOR_UNKNOWN'
  | 'SUPERVISOR_REQUIRED'
  | 'TICKET_NOT_FOUND'
  | 'AGENT_UNAVAILABLE'
  | 'INVALID_TRANSITION'
  | 'ROUTE_NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'INTERNAL_ERROR';

export type ErrorDetails = readonly unknown[];

export abstract class TicketOpsError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: ErrorDetails;

  protected constructor(
    code: ErrorCode,
    statusCode: number,
    message: string,
    details?: ErrorDetails,
  ) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export class InvalidRequestError extends TicketOpsError {
  constructor(
    message = 'Request validation failed',
    details?: ErrorDetails,
  ) {
    super('INVALID_REQUEST', 400, message, details);
  }
}

export class InvalidJsonError extends TicketOpsError {
  constructor(message = 'Malformed JSON request body') {
    super('INVALID_JSON', 400, message);
  }
}

export class ActorRequiredError extends TicketOpsError {
  constructor(message = 'Actor is required') {
    super('ACTOR_REQUIRED', 400, message);
  }
}

export class ActorUnknownError extends TicketOpsError {
  constructor(message = 'Actor is unknown') {
    super('ACTOR_UNKNOWN', 400, message);
  }
}

export class SupervisorRequiredError extends TicketOpsError {
  constructor(message = 'Supervisor access is required') {
    super('SUPERVISOR_REQUIRED', 403, message);
  }
}

export class TicketNotFoundError extends TicketOpsError {
  constructor(ticketId?: string) {
    super(
      'TICKET_NOT_FOUND',
      404,
      ticketId === undefined ? 'Ticket not found' : `Ticket ${ticketId} not found`,
    );
  }
}

export class AgentUnavailableError extends TicketOpsError {
  constructor(message = 'Agent is unavailable') {
    super('AGENT_UNAVAILABLE', 409, message);
  }
}

export class InvalidTransitionError extends TicketOpsError {
  constructor(message = 'Invalid ticket status transition') {
    super('INVALID_TRANSITION', 409, message);
  }
}

export class RouteNotFoundError extends TicketOpsError {
  constructor(message = 'Route not found') {
    super('ROUTE_NOT_FOUND', 404, message);
  }
}

export class MethodNotAllowedError extends TicketOpsError {
  readonly allowedMethods?: readonly string[];

  constructor(
    message = 'Method not allowed',
    allowedMethods?: readonly string[],
  ) {
    super('METHOD_NOT_ALLOWED', 405, message);
    this.allowedMethods = allowedMethods;
  }
}

export class InternalError extends TicketOpsError {
  constructor(message = 'Internal server error') {
    super('INTERNAL_ERROR', 500, message);
  }
}

export {
  AgentUnavailableError as UnavailableAgentError,
  MethodNotAllowedError as UnsupportedMethodError,
  RouteNotFoundError as UnsupportedRouteError,
};
