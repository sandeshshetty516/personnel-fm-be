import { Types } from 'mongoose';
import { AppError } from '../../common/errors';
import { logger } from '../../common/logger';
import { env } from '../../config/env';
import { SessionModel } from './session.model';
import { generateOpaqueToken, hashToken, signAccessToken } from './tokens';

export interface ClientContext {
  ip?: string;
  userAgent?: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

// Two tabs refreshing at once both present the same token; the loser should not trigger theft detection.
const ROTATION_GRACE_MS = 30_000;

function refreshExpiry() {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export async function createSession(
  userId: Types.ObjectId | string,
  ctx: ClientContext,
  familyId?: Types.ObjectId,
): Promise<IssuedTokens & { sessionId: string }> {
  const refreshToken = generateOpaqueToken();
  const session = await SessionModel.create({
    userId,
    tokenHash: hashToken(refreshToken),
    ...(familyId ? { familyId } : {}),
    expiresAt: refreshExpiry(),
    userAgent: ctx.userAgent?.slice(0, 512),
    ip: ctx.ip?.slice(0, 64),
  });
  const sessionId = session._id.toString();
  return { sessionId, refreshToken, accessToken: signAccessToken({ sub: userId.toString(), sid: sessionId }) };
}

/** Rotates a refresh token: revokes the presented one and issues a successor in the same family. */
export async function rotateSession(
  refreshToken: string,
  ctx: ClientContext,
): Promise<IssuedTokens & { userId: string }> {
  const tokenHash = hashToken(refreshToken);
  const now = new Date();

  // Atomic claim, so concurrent requests cannot both rotate the same token.
  const current = await SessionModel.findOneAndUpdate(
    { tokenHash, revokedAt: null, expiresAt: { $gt: now } },
    { $set: { revokedAt: now } },
    { returnDocument: 'after' },
  );

  if (!current) {
    const known = await SessionModel.findOne({ tokenHash });
    if (known?.revokedAt && known.replacedBy) {
      const withinGrace = now.getTime() - known.revokedAt.getTime() < ROTATION_GRACE_MS;
      if (!withinGrace) {
        // A rotated token was replayed: assume it was stolen and end every session in the family.
        await SessionModel.updateMany({ familyId: known.familyId, revokedAt: null }, { $set: { revokedAt: now } });
        logger.warn({ userId: known.userId.toString() }, 'Refresh token reuse detected; session family revoked');
      }
    }
    throw AppError.unauthorized('Session expired. Please log in again.');
  }

  const next = await createSession(current.userId, ctx, current.familyId);
  await SessionModel.updateOne({ _id: current._id }, { $set: { replacedBy: new Types.ObjectId(next.sessionId) } });
  return { userId: current.userId.toString(), accessToken: next.accessToken, refreshToken: next.refreshToken };
}

export async function isSessionActive(sessionId: string, userId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(sessionId)) return false;
  const exists = await SessionModel.exists({
    _id: sessionId,
    userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });
  return exists !== null;
}

export async function revokeSessionByRefreshToken(refreshToken: string): Promise<void> {
  await SessionModel.updateOne(
    { tokenHash: hashToken(refreshToken), revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

/** Ends all of a user's sessions, optionally keeping the current one (used after password changes). */
export async function revokeAllUserSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await SessionModel.updateMany(
    { userId, revokedAt: null, ...(exceptSessionId ? { _id: { $ne: exceptSessionId } } : {}) },
    { $set: { revokedAt: new Date() } },
  );
}
