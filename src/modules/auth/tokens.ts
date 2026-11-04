import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';

export interface AccessTokenPayload {
  sub: string; // user id
  sid: string; // session id, so logout/revocation takes effect before the token expires
}

const ACCESS_TOKEN_AUDIENCE = 'myfinance-api';

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.ACCESS_TOKEN_TTL_MINUTES * 60,
    audience: ACCESS_TOKEN_AUDIENCE,
  });
}

/** Returns the payload, or null for any invalid, expired or tampered token. */
export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      audience: ACCESS_TOKEN_AUDIENCE,
    });
    if (typeof decoded === 'string' || typeof decoded.sub !== 'string' || typeof decoded.sid !== 'string') return null;
    return { sub: decoded.sub, sid: decoded.sid };
  } catch {
    return null;
  }
}

/** Cryptographically random, URL-safe opaque token (refresh, reset and CSRF tokens). */
export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Opaque tokens are high-entropy, so a fast unsalted hash is sufficient for at-rest storage. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
