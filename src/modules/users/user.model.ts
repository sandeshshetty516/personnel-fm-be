import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const SUPPORTED_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'] as const;
export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

const notificationPreferencesSchema = new Schema(
  {
    budgetAlerts: { type: Boolean, default: true },
    emiReminders: { type: Boolean, default: true },
    recurringReminders: { type: Boolean, default: true },
    goalMilestones: { type: Boolean, default: true },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    // select: false keeps hashes and reset tokens out of every query unless explicitly requested (FR-003).
    passwordHash: { type: String, required: true, select: false },
    passwordChangedAt: { type: Date },
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpiresAt: { type: Date, select: false },

    currency: { type: String, enum: SUPPORTED_CURRENCIES, default: 'INR' },
    // Capped at 28 so every month has the configured start day.
    monthStartDay: { type: Number, min: 1, max: 28, default: 1 },
    timezone: { type: String, default: DEFAULT_TIMEZONE },
    preferences: {
      notifications: { type: notificationPreferencesSchema, default: () => ({}) },
    },
    isActive: { type: Boolean, default: true },
    // Set once the default categories have been copied to this user.
    defaultCategoriesSeededAt: { type: Date },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ passwordResetTokenHash: 1 }, { sparse: true });

export type User = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<User>;

export const UserModel = model('User', userSchema);

/** The only shape of a user that ever leaves the API. */
export function toPublicUser(user: UserDocument) {
  return {
    id: user._id.toString(),
    fullName: user.fullName,
    email: user.email,
    currency: user.currency,
    monthStartDay: user.monthStartDay,
    timezone: user.timezone,
    preferences: {
      notifications: {
        budgetAlerts: user.preferences?.notifications?.budgetAlerts ?? true,
        emiReminders: user.preferences?.notifications?.emiReminders ?? true,
        recurringReminders: user.preferences?.notifications?.recurringReminders ?? true,
        goalMilestones: user.preferences?.notifications?.goalMilestones ?? true,
      },
    },
    createdAt: user.createdAt.toISOString(),
  };
}

export type PublicUser = ReturnType<typeof toPublicUser>;
