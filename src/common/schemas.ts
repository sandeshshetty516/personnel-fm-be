import { Types } from 'mongoose';
import { z } from 'zod';
// Registers .openapi() on Zod schemas before they are used below.
import '../docs/openapi';

export const objectIdSchema = z
  .string()
  .refine((value) => Types.ObjectId.isValid(value) && /^[a-f\d]{24}$/i.test(value), 'Invalid id')
  .openapi({ example: '6ae98b493cc88b9839028d01' });

export const idParamsSchema = z.object({ id: objectIdSchema });

/** Integer paise (₹1 = 100 paise). Never a float, never outside the safe-integer range. */
export const paiseSchema = z
  .number()
  .int('Amount must be in whole paise')
  .refine(Number.isSafeInteger, 'Amount is too large')
  .openapi({ example: 8_000_000, description: 'Integer paise (₹1 = 100 paise)' });

export const positivePaiseSchema = paiseSchema.refine((value) => value > 0, 'Amount must be greater than zero');

/** Query-string boolean: only the literal strings "true"/"false" are accepted. */
export const booleanQuerySchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();
