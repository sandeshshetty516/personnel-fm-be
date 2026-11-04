import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

interface RequestSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/**
 * Validates and coerces request input with Zod (server validation is authoritative, NFR-005).
 * Parsed values replace the raw ones; a ZodError is forwarded to the error handler as a 400.
 * Express 5 exposes req.query as a getter, so the parsed query is stored on res.locals.query.
 */
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, res, next) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
      if (schemas.query) res.locals.query = schemas.query.parse(req.query);
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (err) {
      next(err);
    }
  };
}
