import { z } from 'zod';
import { booleanQuerySchema, paiseSchema } from '../../common/schemas';
import { SUPPORTED_CURRENCIES } from '../users/user.model';
import { ACCOUNT_TYPES } from './account.model';

const nameSchema = z.string().trim().min(1, 'Account name is required').max(60);

export const accountSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    accountType: z.enum(ACCOUNT_TYPES),
    currency: z.enum(SUPPORTED_CURRENCIES),
    openingBalancePaise: z.number().int(),
    currentBalancePaise: z.number().int().openapi({ description: 'Opening balance + credits − debits' }),
    institution: z.string().nullable(),
    lastFourDigits: z.string().nullable(),
    isActive: z.boolean(),
    createdAt: z.string().openapi({ format: 'date-time' }),
    updatedAt: z.string().openapi({ format: 'date-time' }),
  })
  .openapi('Account');

export const createAccountSchema = z
  .object({
    name: nameSchema,
    accountType: z.enum(ACCOUNT_TYPES),
    openingBalancePaise: paiseSchema.default(0),
    // Defaults to the user's preferred currency when omitted.
    currency: z.enum(SUPPORTED_CURRENCIES).optional(),
    institution: z.string().trim().max(80).optional(),
    lastFourDigits: z
      .string()
      .regex(/^\d{4}$/, 'Enter exactly 4 digits')
      .optional(),
  })
  .strict()
  .openapi('CreateAccountRequest');

export const updateAccountSchema = z
  .object({
    name: nameSchema,
    accountType: z.enum(ACCOUNT_TYPES),
    openingBalancePaise: paiseSchema,
    currency: z.enum(SUPPORTED_CURRENCIES),
    // null clears the field.
    institution: z.string().trim().max(80).nullable(),
    lastFourDigits: z
      .string()
      .regex(/^\d{4}$/, 'Enter exactly 4 digits')
      .nullable(),
    isActive: z.boolean().openapi({ description: 'Set true to reactivate a deactivated account' }),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update')
  .openapi('UpdateAccountRequest');

export const listAccountsQuerySchema = z.object({ includeInactive: booleanQuerySchema });

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type AccountResponse = z.infer<typeof accountSchema>;
