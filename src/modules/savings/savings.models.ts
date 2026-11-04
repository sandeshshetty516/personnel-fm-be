import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { SUPPORTED_CURRENCIES } from '../users/user.model';

export const GOAL_STATUSES = ['ACTIVE', 'COMPLETED', 'ARCHIVED'] as const;
export const CONTRIBUTION_TYPES = ['CONTRIBUTION', 'WITHDRAWAL'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/**
 * A savings goal is an earmark, not an account. Contributions record money set aside for the goal;
 * they never create transactions, so they can never be counted as expenses (FR-042, AC-09). If the
 * money physically moves to a savings account, that is a separate transfer, which is not an expense either.
 */
const savingsGoalSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    targetAmountPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    targetDate: { type: Date },
    currency: { type: String, enum: SUPPORTED_CURRENCIES, required: true },
    status: { type: String, enum: GOAL_STATUSES, default: 'ACTIVE' },
    // Running total of contributions − withdrawals, kept in step with goalContributions inside a
    // transaction; the conditional update on it is what stops withdrawals exceeding the saved amount.
    savedPaise: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    notes: { type: String, trim: true, maxlength: 500 },
    completedAt: { type: Date },
  },
  { timestamps: true },
);
savingsGoalSchema.index({ userId: 1, status: 1 });

const goalContributionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    goalId: { type: Schema.Types.ObjectId, ref: 'SavingsGoal', required: true },
    // Optional: where the money is held. Informational only; balances are not changed.
    accountId: { type: Schema.Types.ObjectId, ref: 'Account' },
    type: { type: String, enum: CONTRIBUTION_TYPES, required: true },
    amountPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    contributionDate: { type: Date, required: true },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true },
);
goalContributionSchema.index({ userId: 1, goalId: 1, contributionDate: -1 });

export type SavingsGoalDocument = HydratedDocument<InferSchemaType<typeof savingsGoalSchema>>;
export type GoalContributionDocument = HydratedDocument<InferSchemaType<typeof goalContributionSchema>>;

export const SavingsGoalModel = model('SavingsGoal', savingsGoalSchema, 'savingsGoals');
export const GoalContributionModel = model('GoalContribution', goalContributionSchema, 'goalContributions');
