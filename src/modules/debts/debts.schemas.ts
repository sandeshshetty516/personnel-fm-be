import { z } from 'zod';
import { calendarDateSchema } from '../../common/dates';
import { objectIdSchema, positivePaiseSchema } from '../../common/schemas';
import { DEBT_DIRECTIONS, DEBT_ENTRY_TYPES, DEBT_STATUSES } from './debt.models';

const personNameSchema = z.string().trim().min(1, 'Name is required').max(80);
const phoneSchema = z.string().trim().max(20);
const notesSchema = z.string().trim().max(500);
const accountIdField = objectIdSchema.optional().openapi({
  description: "Account the money left or entered. Omit to track the amount without moving any balance.",
});

export const createDebtSchema = z
  .object({
    direction: z.enum(DEBT_DIRECTIONS),
    personName: personNameSchema,
    phone: phoneSchema.optional(),
    amountPaise: positivePaiseSchema,
    date: calendarDateSchema,
    dueDate: calendarDateSchema.optional(),
    accountId: accountIdField,
    notes: notesSchema.optional(),
  })
  .strict()
  .refine((value) => !value.dueDate || value.dueDate >= value.date, {
    message: 'Due date cannot be before the start date',
    path: ['dueDate'],
  })
  .openapi('CreateDebtRequest');

export const updateDebtSchema = z
  .object({
    personName: personNameSchema,
    phone: phoneSchema.nullable(),
    dueDate: calendarDateSchema.nullable(),
    notes: notesSchema.nullable(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update')
  .openapi('UpdateDebtRequest');

export const createDebtEntrySchema = z
  .object({
    type: z.enum(DEBT_ENTRY_TYPES),
    amountPaise: positivePaiseSchema,
    date: calendarDateSchema,
    accountId: accountIdField.openapi({
      description:
        'Account the money left or entered. For a WRITE_OFF it is only where the expense is reported ' +
        '(no balance moves) and defaults to the account of the latest lent amount.',
    }),
    notes: notesSchema.optional(),
  })
  .strict()
  .openapi('CreateDebtEntryRequest');

export const listDebtsQuerySchema = z.object({
  direction: z.enum(DEBT_DIRECTIONS).optional(),
  status: z.enum(DEBT_STATUSES).optional(),
});
export const debtEntryParamsSchema = z.object({ id: objectIdSchema, entryId: objectIdSchema });

export const debtSchema = z
  .object({
    id: z.string(),
    direction: z.enum(DEBT_DIRECTIONS),
    personName: z.string(),
    phone: z.string().nullable(),
    currency: z.string(),
    startDate: z.string(),
    dueDate: z.string().nullable(),
    notes: z.string().nullable(),
    principalPaise: z.number().int(),
    repaidPaise: z.number().int(),
    writtenOffPaise: z.number().int(),
    outstandingPaise: z.number().int().openapi({ description: 'principal − repaid − written off' }),
    progressPercent: z.number().openapi({ description: '(repaid + written off) / principal × 100' }),
    status: z.enum(DEBT_STATUSES),
    isOverdue: z.boolean().openapi({ description: 'Due date passed with an amount still outstanding' }),
    closedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('Debt');

export const debtEntrySchema = z
  .object({
    id: z.string(),
    debtId: z.string(),
    type: z.enum(DEBT_ENTRY_TYPES),
    amountPaise: z.number().int(),
    date: z.string(),
    accountId: z.string().nullable(),
    transactionId: z.string().nullable(),
    notes: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('DebtEntry');

export const debtSummarySchema = z
  .object({
    currency: z.string(),
    receivablePaise: z.number().int().openapi({ description: 'Outstanding on open LENT debts' }),
    payablePaise: z.number().int().openapi({ description: 'Outstanding on open BORROWED debts' }),
    openLentCount: z.number().int(),
    openBorrowedCount: z.number().int(),
    overdueCount: z.number().int(),
    people: z.array(
      z.object({
        personName: z.string(),
        receivablePaise: z.number().int(),
        payablePaise: z.number().int(),
        netPaise: z.number().int().openapi({ description: 'Positive: they owe you. Negative: you owe them.' }),
      }),
    ),
  })
  .openapi('DebtSummary');

export type CreateDebtInput = z.infer<typeof createDebtSchema>;
export type UpdateDebtInput = z.infer<typeof updateDebtSchema>;
export type CreateDebtEntryInput = z.infer<typeof createDebtEntrySchema>;
export type DebtResponse = z.infer<typeof debtSchema>;
export type DebtEntryResponse = z.infer<typeof debtEntrySchema>;
export type DebtSummaryResponse = z.infer<typeof debtSummarySchema>;
