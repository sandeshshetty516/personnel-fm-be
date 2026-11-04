import { Types } from 'mongoose';
import {
  addDays,
  currentFinancialMonth,
  financialMonthStart,
  formatCalendarDate,
  parseCalendarDate,
  todayIn,
} from '../../common/dates';
import { AppError } from '../../common/errors';
import { AccountModel } from '../accounts/account.model';
import { CategoryModel } from '../categories/category.model';
import { findOwnedCategory } from '../categories/categories.service';
import { TransactionModel } from '../transactions/transaction.model';
import { DEFAULT_TIMEZONE, UserModel } from '../users/user.model';
import { BudgetModel, type BudgetDocument } from './budget.model';
import type { BudgetResponse, BudgetSummary, CreateBudgetInput, UpdateBudgetInput } from './budgets.schemas';

function toResponse(budget: BudgetDocument): BudgetResponse {
  return {
    id: budget._id.toString(),
    name: budget.name,
    period: budget.period,
    currency: budget.currency,
    amountPaise: budget.amountPaise,
    categoryLimits: budget.categoryLimits.map((l) => ({
      categoryId: l.categoryId.toString(),
      amountPaise: l.amountPaise,
    })),
    alertThresholds: [...budget.alertThresholds],
    startDate: formatCalendarDate(budget.startDate),
    endDate: budget.endDate ? formatCalendarDate(budget.endDate) : null,
    createdAt: budget.createdAt.toISOString(),
    updatedAt: budget.updatedAt.toISOString(),
  };
}

async function userSettings(userId: string) {
  const user = await UserModel.findById(userId).select('currency monthStartDay timezone');
  if (!user) throw AppError.unauthorized();
  return {
    currency: user.currency,
    monthStartDay: user.monthStartDay,
    today: todayIn(user.timezone ?? DEFAULT_TIMEZONE),
  };
}

/** Category limits must point at the user's own, active expense categories. */
async function assertExpenseCategories(userId: string, limits: { categoryId: string }[]) {
  for (const { categoryId } of limits) {
    const category = await findOwnedCategory(userId, categoryId);
    if (category.type !== 'EXPENSE' || category.isArchived) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Budget limits need active expense categories', [
        { path: 'categoryLimits', message: `"${category.name}" is not an active expense category` },
      ]);
    }
  }
}

export async function findOwnedBudget(userId: string, budgetId: string): Promise<BudgetDocument> {
  const budget = await BudgetModel.findOne({ _id: budgetId, userId });
  if (!budget) throw AppError.notFound('Budget not found');
  return budget;
}

/**
 * The period a budget covers on `date`, or null when it does not apply then.
 * MONTHLY budgets follow the user's financial month; CUSTOM budgets cover their own fixed range.
 */
export function periodFor(
  budget: Pick<BudgetDocument, 'period' | 'startDate' | 'endDate'>,
  date: string,
  monthStartDay: number,
): { from: string; to: string } | null {
  if (budget.period === 'CUSTOM') {
    const from = formatCalendarDate(budget.startDate);
    const to = formatCalendarDate(budget.endDate!);
    return date >= from && date <= to ? { from, to } : null;
  }
  const month = currentFinancialMonth(date, monthStartDay);
  const firstMonth = formatCalendarDate(financialMonthStart(budget.startDate, monthStartDay));
  if (month.from < firstMonth) return null;
  if (budget.endDate && month.from > formatCalendarDate(budget.endDate)) return null;
  return month;
}

function utilisation(limitPaise: number, spentPaise: number, thresholds: number[]) {
  const percent = Math.round((spentPaise * 1000) / limitPaise) / 10;
  const reached = thresholds.filter((t) => percent >= t);
  return {
    limitPaise,
    spentPaise,
    remainingPaise: limitPaise - spentPaise,
    utilizationPercent: percent,
    reachedThreshold: reached.length ? reached[reached.length - 1]! : null,
  };
}

/**
 * Planned vs actual for one budget period (FR-034, FR-035, FR-037). Eligible expenses are EXPENSE
 * transactions dated in the period, from the user's accounts in the budget's currency (AC-08).
 * Transfers and savings-goal contributions are never expenses, so they never count.
 */
export async function summarize(userId: string, budget: BudgetDocument, date: string, monthStartDay: number) {
  const period = periodFor(budget, date, monthStartDay);
  const thresholds = [...budget.alertThresholds];
  const limits = budget.categoryLimits.map((l) => ({
    categoryId: l.categoryId.toString(),
    amountPaise: l.amountPaise,
  }));

  let spentByCategory = new Map<string, number>();
  let elapsedPercent = 0;
  if (period) {
    const accounts = await AccountModel.find({ userId, currency: budget.currency }).select('_id');
    const rows = await TransactionModel.aggregate<{ _id: Types.ObjectId | null; spentPaise: number }>([
      {
        $match: {
          userId: new Types.ObjectId(userId),
          type: 'EXPENSE',
          accountId: { $in: accounts.map((a) => a._id) },
          transactionDate: { $gte: parseCalendarDate(period.from)!, $lt: addDays(parseCalendarDate(period.to)!, 1) },
        },
      },
      { $group: { _id: '$categoryId', spentPaise: { $sum: '$amountPaise' } } },
    ]);
    spentByCategory = new Map(rows.map((r) => [r._id?.toString() ?? 'none', r.spentPaise]));

    const totalDays =
      (parseCalendarDate(period.to)!.getTime() - parseCalendarDate(period.from)!.getTime()) / 86_400_000 + 1;
    const daysElapsed = Math.min(
      totalDays,
      Math.max(0, (parseCalendarDate(date)!.getTime() - parseCalendarDate(period.from)!.getTime()) / 86_400_000 + 1),
    );
    elapsedPercent = Math.round((daysElapsed * 1000) / totalDays) / 10;
  }

  const totalSpent = [...spentByCategory.values()].reduce((sum, v) => sum + v, 0);
  const categories = await CategoryModel.find({ userId, _id: { $in: limits.map((l) => l.categoryId) } });
  const categoryById = new Map(categories.map((c) => [c._id.toString(), c]));
  const budgetedSpent = limits.reduce((sum, l) => sum + (spentByCategory.get(l.categoryId) ?? 0), 0);

  const summary: BudgetSummary = {
    budgetId: budget._id.toString(),
    period,
    elapsedPercent,
    overall: utilisation(budget.amountPaise, totalSpent, thresholds),
    categories: limits.map((limit) => {
      const category = categoryById.get(limit.categoryId);
      return {
        categoryId: limit.categoryId,
        name: category?.name ?? 'Deleted category',
        icon: category?.icon ?? 'other',
        color: category?.color ?? '#78909c',
        ...utilisation(limit.amountPaise, spentByCategory.get(limit.categoryId) ?? 0, thresholds),
      };
    }),
    unbudgetedSpentPaise: totalSpent - budgetedSpent,
  };
  return summary;
}

export async function listBudgets(userId: string, date?: string) {
  const settings = await userSettings(userId);
  const on = date ?? settings.today;
  const budgets = await BudgetModel.find({ userId }).sort({ createdAt: 1 });
  return Promise.all(
    budgets.map(async (budget) => ({
      budget: toResponse(budget),
      summary: await summarize(userId, budget, on, settings.monthStartDay),
    })),
  );
}

export async function getBudget(userId: string, budgetId: string): Promise<BudgetResponse> {
  return toResponse(await findOwnedBudget(userId, budgetId));
}

export async function getBudgetSummary(userId: string, budgetId: string, date?: string): Promise<BudgetSummary> {
  const [budget, settings] = await Promise.all([findOwnedBudget(userId, budgetId), userSettings(userId)]);
  return summarize(userId, budget, date ?? settings.today, settings.monthStartDay);
}

export async function createBudget(userId: string, input: CreateBudgetInput): Promise<BudgetResponse> {
  await assertExpenseCategories(userId, input.categoryLimits);
  const settings = await userSettings(userId);
  const budget = await BudgetModel.create({
    ...input,
    userId,
    currency: input.currency ?? settings.currency,
    startDate: parseCalendarDate(input.startDate)!,
    endDate: input.endDate ? parseCalendarDate(input.endDate)! : undefined,
  });
  return toResponse(budget);
}

export async function updateBudget(userId: string, budgetId: string, input: UpdateBudgetInput) {
  const budget = await findOwnedBudget(userId, budgetId);
  if (input.categoryLimits) await assertExpenseCategories(userId, input.categoryLimits);

  const { startDate, endDate, ...rest } = input;
  budget.set(rest);
  if (startDate) budget.startDate = parseCalendarDate(startDate)!;
  if (endDate !== undefined) budget.set('endDate', endDate ? parseCalendarDate(endDate)! : undefined);

  // Re-check the merged state: a CUSTOM budget always needs an end on or after its start.
  if (budget.period === 'CUSTOM' && !budget.endDate) {
    throw new AppError(400, 'VALIDATION_ERROR', 'A custom budget needs an end date', [
      { path: 'endDate', message: 'A custom budget needs an end date' },
    ]);
  }
  if (budget.endDate && budget.endDate < budget.startDate) {
    throw new AppError(400, 'VALIDATION_ERROR', 'End date must be on or after the start date', [
      { path: 'endDate', message: 'End date must be on or after the start date' },
    ]);
  }
  await budget.save();
  return toResponse(budget);
}

export async function deleteBudget(userId: string, budgetId: string) {
  const budget = await findOwnedBudget(userId, budgetId);
  await budget.deleteOne();
  return { deleted: true as const };
}
