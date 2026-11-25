import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  Response,
} from 'express';
import { z } from 'zod';
import {
  InternalError,
  InvalidJsonError,
  InvalidRequestError,
  MethodNotAllowedError,
  TicketOpsError,
  type ErrorCode,
  type ErrorDetails,
} from '../domain/index.js';

export interface StandardErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetails;
  };
}

interface JsonParseFailure {
  type?: unknown;
  status?: unknown;
  statusCode?: unknown;
  message?: unknown;
}

function isJsonParseFailure(error: unknown): error is JsonParseFailure {
  if (error === null || typeof error !== 'object') {
    return false;
  }

  const candidate = error as JsonParseFailure;
  const hasParserMarker = candidate.type === 'entity.parse.failed';
  const hasBadRequestStatus =
    candidate.status === 400 || candidate.statusCode === 400;
  const hasJsonSyntaxMessage =
    error instanceof SyntaxError &&
    typeof candidate.message === 'string' &&
    /json|unexpected token/i.test(candidate.message);

  return hasParserMarker || (hasBadRequestStatus && hasJsonSyntaxMessage);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeValidationDetails(details: ErrorDetails): ErrorDetails {
  return details.flatMap((detail) => {
    if (!isRecord(detail)) {
      return [];
    }

    const path = Array.isArray(detail.path)
      ? detail.path.filter(
          (part): part is string | number =>
            typeof part === 'string' || typeof part === 'number',
        )
      : [];
    const message =
      typeof detail.message === 'string' ? detail.message : 'Invalid request';
    const code = typeof detail.code === 'string' ? detail.code : 'custom';

    return [{ path, message, code }];
  });
}

function zodDetails(error: z.ZodError): ErrorDetails {
  return error.issues.map((issue) => ({
    path: [...issue.path],
    message: issue.message,
    code: issue.code,
  }));
}

/** Converts errors from the HTTP boundary into the public domain error contract. */
export function normalizeHttpError(error: unknown): TicketOpsError {
  if (isJsonParseFailure(error)) {
    return new InvalidJsonError();
  }

  if (error instanceof z.ZodError) {
    return new InvalidRequestError(
      'Request validation failed',
      zodDetails(error),
    );
  }

  if (error instanceof TicketOpsError) {
    return error;
  }

  return new InternalError();
}

/** Creates the JSON error envelope without exposing stacks or internal causes. */
export function formatError(error: unknown): StandardErrorBody {
  const normalized = normalizeHttpError(error);
  const body: StandardErrorBody = {
    error: {
      code: normalized.code,
      message: normalized.message,
    },
  };

  if (normalized.details !== undefined && normalized.details.length > 0) {
    const details = sanitizeValidationDetails(normalized.details);
    if (details.length > 0) {
      body.error.details = details;
    }
  }

  return body;
}

export function errorStatusCode(error: unknown): number {
  return normalizeHttpError(error).statusCode;
}

/** Express error middleware for the standard TicketOps HTTP error contract. */
export const standardErrorHandler: ErrorRequestHandler = (
  error: unknown,
  _request: Request,
  response: Response,
  next: NextFunction,
): void => {
  void next;
  const normalized = normalizeHttpError(error);

  if (
    normalized instanceof MethodNotAllowedError &&
    normalized.allowedMethods !== undefined
  ) {
    response.setHeader('Allow', normalized.allowedMethods.join(', '));
  }

  response.status(normalized.statusCode).json(formatError(normalized));
};

export const errorHandler = standardErrorHandler;
export const httpErrorHandler = standardErrorHandler;
