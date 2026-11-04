import { z } from 'zod';
import { calendarDateSchema } from '../../common/dates';
import { objectIdSchema, positivePaiseSchema } from '../../common/schemas';
import { PAYMENT_METHODS, TRANSACTION_TYPES } from './transaction.model';

const titleSchema = z.string().trim().min(1, 'Title is required').max(120);
const notesSchema = z.string().trim().max(1000);

export const transactionSchema = z
  .object({
    id: z.string(),
    type: z.enum(TRANSACTION_TYPES),
    amountPaise: z.number().int().positive(),
    date: z.string().openapi({ format: 'date', description: 'Calendar date of the transaction' }),
    title: z.string(),
    notes: z.string().nullable(),
    paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
    accountId: z.string(),
    categoryId: z.string().nullable(),
    transferGroupId: z.string().nullable(),
    counterpartAccountId: z.string().nullable().openapi({
      description: 'For transfers: the other account (destination for TRANSFER_OUT, source for TRANSFER_IN)',
    }),
    createdAt: z.string().openapi({ format: 'date-time' }),
    updatedAt: z.string().openapi({ format: 'date-time' }),
  })
  .openapi('Transaction');

/** Income and expense entries; transfers are created through POST /accounts/transfer. */
export const createTransactionSchema = z
  .object({
    type: z.enum(['INCOME', 'EXPENSE']),
    amountPaise: positivePaiseSchema,
    date: calendarDateSchema,
    title: titleSchema,
    accountId: objectIdSchema,
    categoryId: objectIdSchema,
    paymentMethod: z.enum(PAYMENT_METHODS).optional(),
    notes: notesSchema.optional(),
  })
  .strict()
  .openapi('CreateTransactionRequest');

export const updateTransactionSchema = z
  .object({
    type: z.enum(['INCOME', 'EXPENSE']),
    amountPaise: positivePaiseSchema,
    date: calendarDateSchema,
    title: titleSchema,
    accountId: objectIdSchema,
    categoryId: objectIdSchema,
    paymentMethod: z.enum(PAYMENT_METHODS).nullable(),
    notes: notesSchema.nullable(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update')
  .openapi('UpdateTransactionRequest', {
    description:
      'For transfer legs only amountPaise, date, title and notes can change; both legs are updated together.',
  });

export const createTransferSchema = z
  .object({
    fromAccountId: objectIdSchema,
    toAccountId: objectIdSchema,
    amountPaise: positivePaiseSchema,
    date: calendarDateSchema,
    title: titleSchema.optional(),
    notes: notesSchema.optional(),
  })
  .strict()
  .refine((value) => value.fromAccountId !== value.toAccountId, {
    message: 'Choose two different accounts',
    path: ['toAccountId'],
  })
  .openapi('CreateTransferRequest');

const SORTS = ['date_desc', 'date_asc', 'amount_desc', 'amount_asc'] as const;

/** Filters shared by the list and summary endpoints, so their totals always agree. */
export const transactionFilterFields = z.object({
  from: calendarDateSchema.optional().openapi({ description: 'Inclusive start date' }),
  to: calendarDateSchema.optional().openapi({ description: 'Inclusive end date' }),
  type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER']).optional().openapi({ description: 'TRANSFER matches both legs' }),
  accountId: objectIdSchema.optional(),
  categoryId: objectIdSchema.optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  q: z.string().trim().max(100).optional().openapi({ description: 'Case-insensitive search in the title' }),
  minAmountPaise: z.coerce.number().int().nonnegative().optional(),
  maxAmountPaise: z.coerce.number().int().nonnegative().optional(),
});

export const listQueryFields = transactionFilterFields.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(SORTS).default('date_desc'),
});

type FilterShape = Pick<z.infer<typeof transactionFilterFields>, 'from' | 'to' | 'minAmountPaise' | 'maxAmountPaise'>;

function checkRanges(value: FilterShape, ctx: z.RefinementCtx) {
  if (value.from && value.to && value.from > value.to) {
    ctx.addIssue({ code: 'custom', message: '"from" must be on or before "to"', path: ['to'] });
  }
  if (
    value.minAmountPaise !== undefined &&
    value.maxAmountPaise !== undefined &&
    value.minAmountPaise > value.maxAmountPaise
  ) {
    ctx.addIssue({ code: 'custom', message: 'Minimum amount must not exceed the maximum', path: ['maxAmountPaise'] });
  }
}

export const transactionFiltersSchema = transactionFilterFields.superRefine(checkRanges);
export const listTransactionsQuerySchema = listQueryFields.superRefine(checkRanges);

export const summarySchema = z
  .object({
    currency: z.string(),
    incomePaise: z.number().int(),
    expensePaise: z.number().int(),
    netPaise: z.number().int().openapi({ description: 'Income − expenses; transfers are excluded' }),
    transactionCount: z.number().int(),
  })
  .openapi('TransactionSummary');

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;
export type CreateTransferInput = z.infer<typeof createTransferSchema>;
export type TransactionFilters = z.infer<typeof transactionFiltersSchema>;
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;
export type TransactionResponse = z.infer<typeof transactionSchema>;
export type SummaryResponse = z.infer<typeof summarySchema>;
