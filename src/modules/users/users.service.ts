import { AppError } from '../../common/errors';
import { hashPassword, verifyPassword } from '../auth/auth.service';
import { revokeAllUserSessions } from '../auth/session.service';
import { toPublicUser, UserModel, type PublicUser } from './user.model';
import type { ChangePasswordInput, UpdateProfileInput } from './users.schemas';

export async function updateProfile(userId: string, input: UpdateProfileInput): Promise<PublicUser> {
  const { preferences, ...rest } = input;
  const update: Record<string, unknown> = { ...rest };
  // Merge notification flags individually so a partial update does not reset the others.
  for (const [key, value] of Object.entries(preferences?.notifications ?? {})) {
    update[`preferences.notifications.${key}`] = value;
  }

  const user = await UserModel.findOneAndUpdate(
    { _id: userId, isActive: true },
    { $set: update },
    { returnDocument: 'after', runValidators: true },
  );
  if (!user) throw AppError.notFound('User not found');
  return toPublicUser(user);
}

export async function changePassword(userId: string, sessionId: string, input: ChangePasswordInput): Promise<void> {
  const user = await UserModel.findOne({ _id: userId, isActive: true }).select('+passwordHash');
  if (!user) throw AppError.notFound('User not found');

  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Current password is incorrect', [
      { path: 'currentPassword', message: 'Current password is incorrect' },
    ]);
  }

  user.passwordHash = await hashPassword(input.newPassword);
  user.passwordChangedAt = new Date();
  await user.save();

  // Keep this device signed in; sign out everywhere else.
  await revokeAllUserSessions(userId, sessionId);
}
