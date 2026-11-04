import { z } from 'zod';
import { registry } from '../../docs/openapi';
import { SUPPORTED_CURRENCIES } from './user.model';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'Enter a valid email address' }))
  .openapi({ example: 'asha@example.com' });

// bcrypt only uses the first 72 bytes, so longer passwords are rejected rather than silently truncated.
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 bytes')
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), 'Password must contain a letter and a number')
  .openapi({ example: 'Secret123' });

export const fullNameSchema = z.string().trim().min(2, 'Full name must be at least 2 characters').max(100);

const timezoneSchema = z
  .string()
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown time zone')
  .openapi({ example: 'Asia/Kolkata' });

export const notificationPreferencesSchema = z.object({
  budgetAlerts: z.boolean(),
  emiReminders: z.boolean(),
  recurringReminders: z.boolean(),
  goalMilestones: z.boolean(),
});

export const publicUserSchema = registry.register(
  'User',
  z.object({
    id: z.string(),
    fullName: z.string(),
    email: z.string(),
    currency: z.enum(SUPPORTED_CURRENCIES),
    monthStartDay: z.number().int().min(1).max(28),
    timezone: z.string(),
    preferences: z.object({ notifications: notificationPreferencesSchema }),
    createdAt: z.string().openapi({ format: 'date-time' }),
  }),
);

export const updateProfileSchema = z
  .object({
    fullName: fullNameSchema,
    currency: z.enum(SUPPORTED_CURRENCIES),
    monthStartDay: z.number().int().min(1).max(28, 'Month start day must be between 1 and 28'),
    timezone: timezoneSchema,
    preferences: z.object({ notifications: notificationPreferencesSchema.partial() }).partial(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update')
  .openapi('UpdateProfileRequest');

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
  })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: 'New password must be different from the current password',
    path: ['newPassword'],
  })
  .openapi('ChangePasswordRequest');

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
