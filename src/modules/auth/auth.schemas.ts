import { z } from 'zod';
import { emailSchema, fullNameSchema, passwordSchema } from '../users/users.schemas';

export const registerSchema = z
  .object({
    fullName: fullNameSchema,
    email: emailSchema,
    password: passwordSchema,
  })
  .strict()
  .openapi('RegisterRequest');

export const loginSchema = z
  .object({
    email: emailSchema,
    // No strength rules on login: only check presence, so the error never hints at the password policy.
    password: z.string().min(1, 'Password is required').max(1024),
  })
  .strict()
  .openapi('LoginRequest');

export const forgotPasswordSchema = z.object({ email: emailSchema }).strict().openapi('ForgotPasswordRequest');

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20).max(200),
    password: passwordSchema,
  })
  .strict()
  .openapi('ResetPasswordRequest');

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
