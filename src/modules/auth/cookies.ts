import type { CookieOptions, Response } from 'express';
import { env, isProduction } from '../../config/env';

export const ACCESS_COOKIE = 'mf_access';
export const REFRESH_COOKIE = 'mf_refresh';
export const CSRF_COOKIE = 'mf_csrf';

// Browsers reject SameSite=None cookies unless they are Secure.
const secure = isProduction || env.COOKIE_SAMESITE === 'none';

const baseOptions: CookieOptions = {
  httpOnly: true,
  secure,
  sameSite: env.COOKIE_SAMESITE,
};

// The refresh cookie is only sent to the auth routes, never to ordinary API calls.
const refreshOptions: CookieOptions = { ...baseOptions, path: '/api/v1/auth' };
const accessOptions: CookieOptions = { ...baseOptions, path: '/' };
// Readable by JS on the API's own origin only; the frontend gets the value from GET /auth/csrf.
const csrfOptions: CookieOptions = { ...baseOptions, httpOnly: false, path: '/' };

export function setAuthCookies(res: Response, tokens: { accessToken: string; refreshToken: string }) {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, { ...accessOptions, maxAge: env.ACCESS_TOKEN_TTL_MINUTES * 60_000 });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...refreshOptions,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60_000,
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, accessOptions);
  res.clearCookie(REFRESH_COOKIE, refreshOptions);
}

export function setCsrfCookie(res: Response, token: string) {
  res.cookie(CSRF_COOKIE, token, csrfOptions);
}
