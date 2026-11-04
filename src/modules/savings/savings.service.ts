import mongoose, { Types } from 'mongoose';
import { formatCalendarDate, parseCalendarDate, todayIn } from '../../common/dates';
import { AppError } from '../../common/errors';
import { findOwnedAccount } from '../accounts/accounts.service';
import { DEFAULT_TIMEZONE, UserModel } from '../users/user.model';
import {
  GoalContributionModel,
  SavingsGoalModel,
  type GoalContributionDocument,
  type GoalStatus,
  type SavingsGoalDocument,
} from './savings.models';
import type {
  ContributionResponse,
  CreateContributionInput,
  CreateGoalInput,
  GoalResponse,
  UpdateGoalInput,
} from './savings.schemas';

/** Whole months from `today` until `targetDate`, counting a part month as one. */
function monthsUntil(today: string, targetDate: string): number {
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  const [gy, gm, gd] = targetDate.split('-').map(Number) as [number, number, number];
  const months = (gy - ty) * 12 + (gm - tm) + (gd >= td ? 1 : 0);
  return Math.max(months, 0);
}

function toResponse(goal: SavingsGoalDocument, today: string): GoalResponse {
  const remainingPaise = Math.max(goal.targetAmountPaise - goal.savedPaise, 0);
  const targetDate = goal.targetDate ? formatCalendarDate(goal.targetDate) : null;
  let monthlyNeededPaise: number | null = null;
  if (targetDate && remainingPaise > 0 && goal.status === 'ACTIVE') {
    const months = monthsUntil(today, targetDate);
    monthlyNeededPaise = months > 0 ? Math.ceil(remainingPaise / months) : remainingPaise;
  }
  return {
    id: goal._id.toString(),
    name: goal.name,
    targetAmountPaise: goal.targetAmountPaise,
    targetDate,
    currency: goal.currency,
    status: goal.status,
    notes: goal.notes ?? null,
    savedPaise: goal.savedPaise,
    remainingPaise,
    // Capped at 100% for display (spec §6); the saved amount itself may exceed the target.
    progressPercent: Math.min(100, Math.floor((goal.savedPaise * 1000) / goal.targetAmountPaise) / 10),
    isTargetReached: goal.savedPaise >= goal.targetAmountPaise,
    monthlyNeededPaise,
    completedAt: goal.completedAt?.toISOString() ?? null,
    createdAt: goal.createdAt.toISOString(),
  };
}

function toContributionResponse(c: GoalContributionDocument): ContributionResponse {
  return {
    id: c._id.toString(),
    goalId: c.goalId.toString(),
    type: c.type,
    amountPaise: c.amountPaise,
    date: formatCalendarDate(c.contributionDate),
    accountId: c.accountId?.toString() ?? null,
    notes: c.notes ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

async function userToday(userId: string) {
  const user = await UserModel.findById(userId).select('timezone currency');
  if (!user) throw AppError.unauthorized();
  return { today: todayIn(user.timezone ?? DEFAULT_TIMEZONE), currency: user.currency };
}

export async function findOwnedGoal(userId: string, goalId: string): Promise<SavingsGoalDocument> {
  const goal = await SavingsGoalModel.findOne({ _id: goalId, userId });
  if (!goal) throw AppError.notFound('Savings goal not found');
  return goal;
}

export async function listGoals(userId: string, status?: GoalStatus): Promise<GoalResponse[]> {
  const { today } = await userToday(userId);
  const goals = await SavingsGoalModel.find({ userId, ...(status ? { status } : {}) }).sort({
    status: 1,
    createdAt: 1,
  });
  return goals.map((g) => toResponse(g, today));
}

export async function getGoal(userId: string, goalId: string): Promise<GoalResponse> {
  const { today } = await userToday(userId);
  return toResponse(await findOwnedGoal(userId, goalId), today);
}

export async function createGoal(userId: string, input: CreateGoalInput): Promise<GoalResponse> {
  const { today, currency } = await userToday(userId);
  const goal = await SavingsGoalModel.create({
    ...input,
    userId,
    currency: input.currency ?? currency,
    targetDate: input.targetDate ? parseCalendarDate(input.targetDate)! : undefined,
  });
  return toResponse(goal, today);
}

export async function updateGoal(userId: string, goalId: string, input: UpdateGoalInput): Promise<GoalResponse> {
  const { today } = await userToday(userId);
  const goal = await findOwnedGoal(userId, goalId);
  const { targetDate, notes, status, ...rest } = input;
  goal.set(rest);
  if (targetDate !== undefined) goal.set('targetDate', targetDate ? parseCalendarDate(targetDate)! : undefined);
  if (notes !== undefined) goal.set('notes', notes ?? undefined);
  if (status && status !== goal.status) {
    goal.status = status;
    goal.set('completedAt', status === 'COMPLETED' ? new Date() : undefined);
  }
  await goal.save();
  return toResponse(goal, today);
}

/**
 * Records money set aside for (or taken back from) a goal (FR-039). The contribution and the goal's
 * running total change in one transaction; a withdrawal only succeeds if enough has been saved.
 */
export async function addContribution(
  userId: string,
  goalId: string,
  input: CreateContributionInput,
): Promise<{ goal: GoalResponse; contribution: ContributionResponse }> {
  const { today } = await userToday(userId);
  const goal = await findOwnedGoal(userId, goalId);
  if (goal.status !== 'ACTIVE') {
    throw AppError.badRequest('Reactivate this goal before adding or withdrawing money');
  }
  if (input.date > today) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Date cannot be in the future', [
      { path: 'date', message: 'Date cannot be in the future' },
    ]);
  }
  if (input.accountId) await findOwnedAccount(userId, input.accountId);

  const delta = input.type === 'WITHDRAWAL' ? -input.amountPaise : input.amountPaise;
  let contribution: GoalContributionDocument | undefined;
  let updated: SavingsGoalDocument | null = null;

  await mongoose.connection.transaction(async (session) => {
    updated = await SavingsGoalModel.findOneAndUpdate(
      { _id: goal._id, userId, status: 'ACTIVE', ...(delta < 0 ? { savedPaise: { $gte: -delta } } : {}) },
      { $inc: { savedPaise: delta } },
      { session, returnDocument: 'after' },
    );
    if (!updated) {
      throw new AppError(400, 'VALIDATION_ERROR', 'You cannot withdraw more than has been saved', [
        { path: 'amountPaise', message: 'More than the amount saved for this goal' },
      ]);
    }
    [contribution] = await GoalContributionModel.create(
      [
        {
          userId,
          goalId: goal._id,
          type: input.type,
          amountPaise: input.amountPaise,
          contributionDate: parseCalendarDate(input.date)!,
          ...(input.accountId ? { accountId: input.accountId } : {}),
          ...(input.notes ? { notes: input.notes } : {}),
        },
      ],
      { session },
    );
  });

  return { goal: toResponse(updated!, today), contribution: toContributionResponse(contribution!) };
}

/** Removes a mistaken entry; refuses if that would leave the goal with a negative saved amount. */
export async function deleteContribution(userId: string, goalId: string, contributionId: string) {
  const { today } = await userToday(userId);
  const goal = await findOwnedGoal(userId, goalId);
  const contribution = await GoalContributionModel.findOne({ _id: contributionId, goalId: goal._id, userId });
  if (!contribution) throw AppError.notFound('Contribution not found');

  const delta = contribution.type === 'WITHDRAWAL' ? contribution.amountPaise : -contribution.amountPaise;
  let updated: SavingsGoalDocument | null = null;
  await mongoose.connection.transaction(async (session) => {
    updated = await SavingsGoalModel.findOneAndUpdate(
      { _id: goal._id, userId, ...(delta < 0 ? { savedPaise: { $gte: -delta } } : {}) },
      { $inc: { savedPaise: delta } },
      { session, returnDocument: 'after' },
    );
    if (!updated) {
      throw AppError.badRequest('Removing this contribution would leave less than has been withdrawn');
    }
    await GoalContributionModel.deleteOne({ _id: contribution._id }, { session });
  });
  return toResponse(updated!, today);
}

/** Contribution history, newest first (FR-041). */
export async function getHistory(userId: string, goalId: string): Promise<ContributionResponse[]> {
  const goal = await findOwnedGoal(userId, goalId);
  const items = await GoalContributionModel.find({ userId: new Types.ObjectId(userId), goalId: goal._id }).sort({
    contributionDate: -1,
    createdAt: -1,
  });
  return items.map(toContributionResponse);
}
