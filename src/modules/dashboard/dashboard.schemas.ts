import { z } from 'zod';
import { calendarDateSchema } from '../../common/dates';
import { CATEGORY_ICONS } from '../categories/category.model';
import { SUPPORTED_CURRENCIES } from '../users/user.model';
import { transactionSchema } from '../transactions/transactions.schemas';

export const MAX_TREND_BUCKETS = 24;

/**
 * Every dashboard endpoint takes the same period and currency, so all widgets describe the same data.
 * Without from/to the user's current financial month is used; without currency, their preferred one.
 * Only accounts in the chosen currency are included, so amounts in different currencies never mix.
 */
export const periodFields = z.object({
  from: calendarDateSchema
    .optional()
    .openapi({ description: 'Inclusive start; defaults to the current financial month' }),
  to: calendarDateSchema.optional().openapi({ description: 'Inclusive end' }),
  currency: z
    .enum(SUPPORTED_CURRENCIES)
    .optional()
    .openapi({ description: "Defaults to the user's preferred currency" }),
});

function checkPeriod(value: z.infer<typeof periodFields>, ctx: z.RefinementCtx) {
  if (Boolean(value.from) !== Boolean(value.to)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Provide both "from" and "to", or neither',
      path: [value.from ? 'to' : 'from'],
    });
  } else if (value.from && value.to && value.from > value.to) {
    ctx.addIssue({ code: 'custom', message: '"from" must be on or before "to"', path: ['to'] });
  }
}

export const periodQuerySchema = periodFields.superRefine(checkPeriod);

export const breakdownFields = periodFields.extend({
  type: z.enum(['EXPENSE', 'INCOME']).default('EXPENSE'),
});
export const breakdownQuerySchema = breakdownFields.superRefine(checkPeriod);

export const recentFields = periodFields.extend({
  limit: z.coerce.number().int().min(1).max(20).default(5),
});
export const recentQuerySchema = recentFields.superRefine(checkPeriod);

const periodSchema = z.object({
  from: z.string().openapi({ format: 'date' }),
  to: z.string().openapi({ format: 'date' }),
  currency: z.string(),
});

export const dashboardSummarySchema = z
  .object({
    period: periodSchema,
    availableCurrencies: z.array(z.string()).openapi({ description: 'Currencies of the user’s accounts' }),
    incomePaise: z.number().int(),
    expensePaise: z.number().int(),
    netPaise: z.number().int(),
    savingsRatePercent: z
      .number()
      .nullable()
      .openapi({ description: '(income − expenses) / income × 100, one decimal; null when income is zero' }),
    totalBalancePaise: z.number().int().openapi({ description: 'Current balance of active accounts in this currency' }),
    activeAccountCount: z.number().int(),
    transactionCount: z.number().int(),
  })
  .openapi('DashboardSummary');

export const cashFlowBucketSchema = z
  .object({
    from: z.string().openapi({ format: 'date' }),
    to: z.string().openapi({ format: 'date' }),
    incomePaise: z.number().int(),
    expensePaise: z.number().int(),
    netPaise: z.number().int(),
  })
  .openapi('CashFlowBucket');

export const savingsBucketSchema = z
  .object({
    from: z.string().openapi({ format: 'date' }),
    to: z.string().openapi({ format: 'date' }),
    netPaise: z.number().int(),
    cumulativeNetPaise: z.number().int(),
    savingsRatePercent: z.number().nullable(),
  })
  .openapi('SavingsBucket');

export const categorySliceSchema = z
  .object({
    categoryId: z.string(),
    name: z.string(),
    icon: z.enum(CATEGORY_ICONS),
    color: z.string(),
    amountPaise: z.number().int(),
    sharePercent: z.number().openapi({ description: 'Share of the total, one decimal' }),
    transactionCount: z.number().int(),
  })
  .openapi('CategorySlice');

export const recentTransactionsSchema = z.array(transactionSchema);

export type PeriodQuery = z.infer<typeof periodFields>;
export type BreakdownQuery = z.infer<typeof breakdownFields>;
export type RecentQuery = z.infer<typeof recentFields>;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
export type CashFlowBucket = z.infer<typeof cashFlowBucketSchema>;
export type SavingsBucket = z.infer<typeof savingsBucketSchema>;
export type CategorySlice = z.infer<typeof categorySliceSchema>;
