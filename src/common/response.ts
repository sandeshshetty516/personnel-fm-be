import type { Response } from 'express';
import type { ErrorCode } from './errors';

/** Standard response envelopes used by every endpoint (spec §8.1). */
export interface SuccessBody<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ErrorBody {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export function sendSuccess<T>(res: Response, data: T, statusCode = 200, meta?: Record<string, unknown>) {
  const body: SuccessBody<T> = { success: true, data, ...(meta ? { meta } : {}) };
  return res.status(statusCode).json(body);
}
