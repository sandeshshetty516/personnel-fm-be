import type { Request, RequestHandler } from 'express';
import { AppError } from '../../common/errors';
import { sendSuccess } from '../../common/response';
import { getAuth } from '../../middleware/authenticate';
import * as authService from './auth.service';
import { clearAuthCookies, CSRF_COOKIE, REFRESH_COOKIE, setAuthCookies, setCsrfCookie } from './cookies';
import { revokeSessionByRefreshToken, rotateSession, type ClientContext } from './session.service';
import { generateOpaqueToken } from './tokens';

function clientContext(req: Request): ClientContext {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}

function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export const getCsrfToken: RequestHandler = (req, res) => {
  const existing: unknown = req.cookies?.[CSRF_COOKIE];
  const csrfToken = typeof existing === 'string' && existing.length >= 32 ? existing : generateOpaqueToken();
  setCsrfCookie(res, csrfToken);
  res.set('Cache-Control', 'no-store');
  sendSuccess(res, { csrfToken });
};

export const register: RequestHandler = async (req, res) => {
  const { user, tokens } = await authService.register(req.body, clientContext(req));
  setAuthCookies(res, tokens);
  sendSuccess(res, { user }, 201);
};

export const login: RequestHandler = async (req, res) => {
  const { user, tokens } = await authService.login(req.body, clientContext(req));
  setAuthCookies(res, tokens);
  sendSuccess(res, { user });
};

export const refresh: RequestHandler = async (req, res) => {
  const refreshToken = readRefreshCookie(req);
  if (!refreshToken) throw AppError.unauthorized('Session expired. Please log in again.');
  try {
    const { userId, ...tokens } = await rotateSession(refreshToken, clientContext(req));
    setAuthCookies(res, tokens);
    sendSuccess(res, { user: await authService.getCurrentUser(userId) });
  } catch (err) {
    clearAuthCookies(res);
    throw err;
  }
};

export const logout: RequestHandler = async (req, res) => {
  const refreshToken = readRefreshCookie(req);
  if (refreshToken) await revokeSessionByRefreshToken(refreshToken);
  clearAuthCookies(res);
  sendSuccess(res, { loggedOut: true });
};

export const me: RequestHandler = async (req, res) => {
  sendSuccess(res, { user: await authService.getCurrentUser(getAuth(req).userId) });
};

export const forgotPassword: RequestHandler = async (req, res) => {
  await authService.requestPasswordReset(req.body.email);
  sendSuccess(res, { message: 'If an account exists for that email, a password reset link has been sent.' });
};

export const resetPassword: RequestHandler = async (req, res) => {
  await authService.resetPassword(req.body.token, req.body.password);
  clearAuthCookies(res);
  sendSuccess(res, { message: 'Your password has been reset. Please log in.' });
};
