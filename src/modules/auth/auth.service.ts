import bcrypt from 'bcryptjs';
import { AppError } from '../../common/errors';
import { logger } from '../../common/logger';
import { env } from '../../config/env';
import { ensureDefaultCategories } from '../categories/categories.service';
import { toPublicUser, UserModel, type PublicUser } from '../users/user.model';
import type { LoginInput, RegisterInput } from './auth.schemas';
import { passwordResetNotifier } from './passwordResetNotifier';
import { createSession, revokeAllUserSessions, type ClientContext, type IssuedTokens } from './session.service';
import { generateOpaqueToken, hashToken } from './tokens';

export interface AuthResult {
  user: PublicUser;
  tokens: IssuedTokens;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, env.BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Compared against when the email is unknown, so response time does not reveal which emails are registered.
let dummyHashPromise: Promise<string> | undefined;
function dummyHash() {
  dummyHashPromise ??= hashPassword('dummy-password-for-timing-0');
  return dummyHashPromise;
}

export async function register(input: RegisterInput, ctx: ClientContext): Promise<AuthResult> {
  if (await UserModel.exists({ email: input.email })) {
    throw AppError.conflict('An account with this email already exists');
  }
  // The unique index still guards the race between the check above and the insert.
  const user = await UserModel.create({
    fullName: input.fullName,
    email: input.email,
    passwordHash: await hashPassword(input.password),
  });
  await ensureDefaultCategories(user._id.toString());
  const tokens = await createSession(user._id, ctx);
  return { user: toPublicUser(user), tokens };
}

export async function login(input: LoginInput, ctx: ClientContext): Promise<AuthResult> {
  const user = await UserModel.findOne({ email: input.email, isActive: true }).select('+passwordHash');
  const passwordMatches = await verifyPassword(input.password, user?.passwordHash ?? (await dummyHash()));
  if (!user || !passwordMatches) {
    throw AppError.unauthorized('Invalid email or password');
  }
  const tokens = await createSession(user._id, ctx);
  return { user: toPublicUser(user), tokens };
}

export async function getCurrentUser(userId: string): Promise<PublicUser> {
  const user = await UserModel.findOne({ _id: userId, isActive: true });
  if (!user) throw AppError.unauthorized();
  return toPublicUser(user);
}

/** Always resolves the same way whether or not the email exists, to avoid account enumeration. */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await UserModel.findOne({ email, isActive: true });
  if (!user) {
    logger.info('Password reset requested for an unknown email');
    return;
  }

  const token = generateOpaqueToken();
  await UserModel.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordResetTokenHash: hashToken(token),
        passwordResetExpiresAt: new Date(Date.now() + env.PASSWORD_RESET_TTL_MINUTES * 60_000),
      },
    },
  );

  const resetUrl = new URL('/reset-password', env.APP_URL);
  resetUrl.searchParams.set('token', token);
  await passwordResetNotifier.send(user.email, resetUrl.toString());
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  // Single atomic update: the token is consumed in the same write that sets the password.
  const user = await UserModel.findOneAndUpdate(
    { passwordResetTokenHash: hashToken(token), passwordResetExpiresAt: { $gt: new Date() }, isActive: true },
    {
      $set: { passwordHash, passwordChangedAt: new Date() },
      $unset: { passwordResetTokenHash: 1, passwordResetExpiresAt: 1 },
    },
  );
  if (!user) throw AppError.badRequest('This reset link is invalid or has expired');

  // Anyone holding an old session (possibly the reason for the reset) is signed out.
  await revokeAllUserSessions(user._id.toString());
}
