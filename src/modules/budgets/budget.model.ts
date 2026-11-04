import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { SUPPORTED_CURRENCIES } from '../users/user.model';

/**
 * MONTHLY budgets repeat every financial month from the month containing startDate until endDate
 * (open-ended when absent). CUSTOM budgets cover exactly startDate..endDate, e.g. a holiday.
 */
export const BUDGET_PERIODS = ['MONTHLY', 'CUSTOM'] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

export const DEFAULT_ALERT_THRESHOLDS = [50, 80, 100];

const categoryLimitSchema = new Schema(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    amountPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
  },
  { _id: false },
);

const budgetSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    period: { type: String, enum: BUDGET_PERIODS, required: true },
    // Only expenses from accounts in this currency are eligible.
    currency: { type: String, enum: SUPPORTED_CURRENCIES, required: true },
    amountPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    categoryLimits: { type: [categoryLimitSchema], default: [] },
    alertThresholds: { type: [Number], default: () => [...DEFAULT_ALERT_THRESHOLDS] },
    // Calendar dates (UTC midnight), same convention as transactions.
    startDate: { type: Date, required: true },
    endDate: { type: Date },
  },
  { timestamps: true },
);

budgetSchema.index({ userId: 1, startDate: -1 });

export type Budget = InferSchemaType<typeof budgetSchema>;
export type BudgetDocument = HydratedDocument<Budget>;

export const BudgetModel = model('Budget', budgetSchema);
