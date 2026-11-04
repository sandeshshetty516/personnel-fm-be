import { z } from 'zod';
import { calendarDateSchema } from '../../common/dates';
import { objectIdSchema, positivePaiseSchema } from '../../common/schemas';
import { SUPPORTED_CURRENCIES } from '../users/user.model';
import { CONTRIBUTION_TYPES, GOAL_STATUSES } from './savings.models';

export const createGoalSchema = z
  .object({
    name: z.string().trim().min(1, 'Goal name is required').max(60),
    targetAmountPaise: positivePaiseSchema,
    targetDate: calendarDateSchema.optional(),
    currency: z.enum(SUPPORTED_CURRENCIES).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict()
  .openapi('CreateSavingsGoalRequest');

export const updateGoalSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    targetAmountPaise: positivePaiseSchema,
    targetDate: calendarDateSchema.nullable(),
    notes: z.string().trim().max(500).nullable(),
    status: z.enum(GOAL_STATUSES).openapi({ description: 'Complete, archive or reactivate a goal' }),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update')
  .openapi('UpdateSavingsGoalRequest');

export const createContributionSchema = z
  .object({
    type: z.enum(CONTRIBUTION_TYPES).default('CONTRIBUTION'),
    amountPaise: positivePaiseSchema,
    date: calendarDateSchema,
    accountId: objectIdSchema.optional().openapi({ description: 'Where the money is held (informational)' }),
    notes: z.string().trim().max(500).optional(),
  })
  .strict()
  .openapi('CreateContributionRequest');

export const listGoalsQuerySchema = z.object({ status: z.enum(GOAL_STATUSES).optional() });
export const contributionParamsSchema = z.object({ id: objectIdSchema, contributionId: objectIdSchema });

export const goalSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    targetAmountPaise: z.number().int(),
    targetDate: z.string().nullable(),
    currency: z.string(),
    status: z.enum(GOAL_STATUSES),
    notes: z.string().nullable(),
    savedPaise: z.number().int(),
    remainingPaise: z.number().int().openapi({ description: 'Never below zero' }),
    progressPercent: z.number().openapi({ description: 'saved / target × 100, capped at 100 for display' }),
    isTargetReached: z.boolean(),
    monthlyNeededPaise: z
      .number()
      .int()
      .nullable()
      .openapi({ description: 'Amount per month needed to hit the target by its date' }),
    completedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('SavingsGoal');

export const contributionSchema = z
  .object({
    id: z.string(),
    goalId: z.string(),
    type: z.enum(CONTRIBUTION_TYPES),
    amountPaise: z.number().int(),
    date: z.string(),
    accountId: z.string().nullable(),
    notes: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('GoalContribution');

export type CreateGoalInput = z.infer<typeof createGoalSchema>;
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;
export type CreateContributionInput = z.infer<typeof createContributionSchema>;
export type GoalResponse = z.infer<typeof goalSchema>;
export type ContributionResponse = z.infer<typeof contributionSchema>;
