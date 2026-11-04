import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { AppError } from '../common/errors';
import { logger } from '../common/logger';
import type { ErrorBody } from '../common/response';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
};

/** Maps known error types to safe client responses; never leaks stack traces (spec §8.1). */
function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return new AppError(
      400,
      'VALIDATION_ERROR',
      'Request validation failed',
      err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }

  if (err instanceof mongoose.Error.CastError) {
    return AppError.badRequest(`Invalid value for ${err.path}`);
  }

  if (err instanceof mongoose.Error.ValidationError) {
    return new AppError(
      400,
      'VALIDATION_ERROR',
      'Data validation failed',
      Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
    );
  }

  if (typeof err === 'object' && err !== null) {
    const e = err as { code?: number; keyValue?: Record<string, unknown>; type?: string; status?: number };
    // Duplicate key from a unique index.
    if (e.code === 11000) {
      return AppError.conflict('A record with the same value already exists', {
        fields: Object.keys(e.keyValue ?? {}),
      });
    }
    // Errors raised by express.json() body parsing.
    if (e.type === 'entity.too.large') return new AppError(413, 'BAD_REQUEST', 'Request body is too large');
    if (e.type === 'entity.parse.failed') return AppError.badRequest('Malformed JSON body');
  }

  return new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}

// Express identifies error handlers by arity, so the unused `next` must stay.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appError = toAppError(err);

  if (appError.statusCode >= 500) {
    logger.error({ err, method: req.method, url: req.originalUrl }, 'Unhandled error');
  }

  const body: ErrorBody = {
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined ? { details: appError.details } : {}),
    },
  };
  res.status(appError.statusCode).json(body);
};
