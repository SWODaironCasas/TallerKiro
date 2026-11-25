import { describe, expect, it } from 'vitest';
import {
  ActorRequiredError,
  ActorUnknownError,
  AgentUnavailableError,
  InternalError,
  InvalidRequestError,
  InvalidTransitionError,
  MethodNotAllowedError,
  RouteNotFoundError,
  SupervisorRequiredError,
  TicketNotFoundError,
  TicketOpsError,
} from './errors.js';

describe('domain errors', () => {
  it.each([
    [InvalidRequestError, 'INVALID_REQUEST', 400],
    [ActorRequiredError, 'ACTOR_REQUIRED', 400],
    [ActorUnknownError, 'ACTOR_UNKNOWN', 400],
    [SupervisorRequiredError, 'SUPERVISOR_REQUIRED', 403],
    [TicketNotFoundError, 'TICKET_NOT_FOUND', 404],
    [AgentUnavailableError, 'AGENT_UNAVAILABLE', 409],
    [InvalidTransitionError, 'INVALID_TRANSITION', 409],
    [RouteNotFoundError, 'ROUTE_NOT_FOUND', 404],
    [MethodNotAllowedError, 'METHOD_NOT_ALLOWED', 405],
    [InternalError, 'INTERNAL_ERROR', 500],
  ])(
    '%s exposes its standard code and HTTP status',
    (ErrorType, code, statusCode) => {
      const error = new ErrorType();

      expect(error).toBeInstanceOf(TicketOpsError);
      expect(error).toBeInstanceOf(Error);
      expect(error.code).toBe(code);
      expect(error.statusCode).toBe(statusCode);
      expect(error.message).toBeTruthy();
    },
  );

  it('preserves validation details and route method metadata', () => {
    const details = [{ path: ['title'], message: 'Required', code: 'invalid_type' }];
    const requestError = new InvalidRequestError(undefined, details);
    const methodError = new MethodNotAllowedError('Method not allowed', [
      'GET',
      'POST',
    ]);

    expect(requestError.details).toEqual(details);
    expect(methodError.allowedMethods).toEqual(['GET', 'POST']);
    expect(new TicketNotFoundError('ticket-1').message).toBe(
      'Ticket ticket-1 not found',
    );
  });
});
