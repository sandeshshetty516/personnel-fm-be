import { z } from 'zod';
import { calendarDateSchema } from '../../common/dates';
import { objectIdSchema, positivePaiseSchema } from '../../common/schemas';
import { CATEGORY_ICONS } from '../categories/category.model';
import { SUPPORTED_CURRENCIES } from '../users/user.model';
import { BUDGET_PERIODS } from './budget.model';

const categoryLimitInput = z.object({ categoryId: objectIdSchema, amountPaise: positivePaiseSchema });

const thresholdsSchema = z
  .array(z.number().int().min(1).max(200))
  .max(5, 'Use at most 5 alert thresholds')
  .transform((values) => [...new Set(values)].sort((a, b) => a - b))
  .openapi({ example: [50, 80, 100], description: 'Utilisation percentages that raise an alert' });

const budgetFields = {
  name: z.string().trim().min(1, 'Budget name is required').max(60),
  period: z.enum(BUDGET_PERIODS),
  currency: z.enum(SUPPORTED_CURRENCIES),
  amountPaise: positivePaiseSchema.openapi({ description: 'Overall limit for each period' }),
  categoryLimits: z.array(categoryLimitInput).max(50),
  alertThresholds: thresholdsSchema,
  startDate: calendarDateSchema.openapi({ description: 'MONTHLY: any date in the first month. CUSTOM: first day.' }),
  endDate: calendarDateSchema
    .nullable()
    .openapi({ description: 'MONTHLY: optional last month. CUSTOM: required last day.' }),
};

type BudgetShape = {
  period?: (typeof BUDGET_PERIODS)[number];
  startDate?: string;
  endDate?: string | null;
  categoryLimits?: { categoryId: string; amountPaise: number }[];
};

function checkBudget(value: BudgetShape, ctx: z.RefinementCtx) {
  if (value.period === 'CUSTOM' && value.endDate === null) {
    ctx.addIssue({ code: 'custom', message: 'A custom budget needs an end date', path: ['endDate'] });
  }
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    ctx.addIssue({ code: 'custom', message: 'End date must be on or after the start date', path: ['endDate'] });
  }
  const ids = value.categoryLimits?.map((l) => l.categoryId) ?? [];
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: 'custom', message: 'Each category can only have one limit', path: ['categoryLimits'] });
  }
}

export const createBudgetSchema = z
  .object({
    ...budgetFields,
    currency: budgetFields.currency.optional(),
    categoryLimits: budgetFields.categoryLimits.default([]),
    alertThresholds: budgetFields.alertThresholds.optional(),
    endDate: budgetFields.endDate.optional(),
  })
  .strict()
  .superRefine((value, ctx) => checkBudget({ ...value, endDate: value.endDate ?? null }, ctx))
  .openapi('CreateBudgetRequest');

export const updateBudgetSchema = z
  .object(budgetFields)
  .partial()
  .strict()
  .superRefine(checkBudget)
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update')
  .openapi('UpdateBudgetRequest');

export const budgetDateQuerySchema = z.object({
  date: calendarDateSchema
    .optional()
    .openapi({ description: 'Report the period containing this date (default: today in the user’s time zone)' }),
});

const utilisationFields = {
  limitPaise: z.number().int(),
  spentPaise: z.number().int(),
  remainingPaise: z.number().int().openapi({ description: 'Negative when overspent' }),
  utilizationPercent: z.number().openapi({ description: 'spent / limit × 100, one decimal' }),
  reachedThreshold: z.number().int().nullable().openapi({ description: 'Highest alert threshold reached, or null' }),
};

export const budgetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    period: z.enum(BUDGET_PERIODS),
    currency: z.string(),
    amountPaise: z.number().int(),
    categoryLimits: z.array(z.object({ categoryId: z.string(), amountPaise: z.number().int() })),
    alertThresholds: z.array(z.number().int()),
    startDate: z.string().openapi({ format: 'date' }),
    endDate: z.string().nullable().openapi({ format: 'date' }),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('Budget');

export const budgetSummarySchema = z
  .object({
    budgetId: z.string(),
    /** Null when the budget does not apply to the requested date. */
    period: z.object({ from: z.string(), to: z.string() }).nullable(),
    elapsedPercent: z.number().openapi({ description: 'Share of the period already passed, for pacing' }),
    overall: z.object(utilisationFields),
    categories: z.array(
      z.object({
        categoryId: z.string(),
        name: z.string(),
        icon: z.enum(CATEGORY_ICONS),
        color: z.string(),
        ...utilisationFields,
      }),
    ),
    unbudgetedSpentPaise: z.number().int().openapi({ description: 'Spending in categories without their own limit' }),
  })
  .openapi('BudgetSummary');

export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;
export type BudgetResponse = z.infer<typeof budgetSchema>;
export type BudgetSummary = z.infer<typeof budgetSummarySchema>;
