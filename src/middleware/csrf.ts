import type { RequestHandler } from 'express';
import { AppError } from '../common/errors';
import { CSRF_COOKIE } from '../modules/auth/cookies';
import { safeEqual } from '../modules/auth/tokens';

export const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit cookie CSRF protection (NFR-004). State-changing requests must echo the CSRF cookie
 * in the X-CSRF-Token header. A cross-site attacker can make the browser send the cookie but cannot
 * read its value: the frontend obtains it from GET /auth/csrf, whose response CORS hides from other origins.
 */
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();

  const cookieToken: unknown = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);
  if (typeof cookieToken !== 'string' || !headerToken || !safeEqual(cookieToken, headerToken)) {
    return next(new AppError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token'));
  }
  next();
};
