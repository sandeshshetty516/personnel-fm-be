import type { Request, RequestHandler } from 'express';
import { AppError } from '../common/errors';
import { ACCESS_COOKIE } from '../modules/auth/cookies';
import { isSessionActive } from '../modules/auth/session.service';
import { verifyAccessToken } from '../modules/auth/tokens';

/**
 * Requires a valid access-token cookie whose session has not been revoked.
 * Checking the session (one indexed lookup) makes logout and password changes effective immediately (AC-02).
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const token: unknown = req.cookies?.[ACCESS_COOKIE];
  const payload = typeof token === 'string' ? verifyAccessToken(token) : null;
  if (!payload || !(await isSessionActive(payload.sid, payload.sub))) {
    return next(AppError.unauthorized());
  }
  req.auth = { userId: payload.sub, sessionId: payload.sid };
  next();
};

/** For handlers behind `authenticate`; fails loudly if the middleware was forgotten. */
export function getAuth(req: Request) {
  if (!req.auth) throw AppError.unauthorized();
  return req.auth;
}
