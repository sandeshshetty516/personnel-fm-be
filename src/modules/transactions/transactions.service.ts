import mongoose, { Types, type PipelineStage } from 'mongoose';
import { addDays, formatCalendarDate, parseCalendarDate, todayIn } from '../../common/dates';
import { AppError } from '../../common/errors';
import { AccountModel } from '../accounts/account.model';
import { findOwnedAccount } from '../accounts/accounts.service';
import { findOwnedCategory } from '../categories/categories.service';
import { DEFAULT_TIMEZONE, UserModel } from '../users/user.model';
import { TransactionModel, type TransactionDocument } from './transaction.model';
import type {
  CreateTransactionInput,
  ListTransactionsQuery,
  SummaryResponse,
  TransactionFilters,
  TransactionResponse,
  UpdateTransactionInput,
} from './transactions.schemas';

// ---------- mapping ----------

type TransactionLike = Pick<
  TransactionDocument,
  | '_id'
  | 'type'
  | 'amountPaise'
  | 'transactionDate'
  | 'title'
  | 'notes'
  | 'paymentMethod'
  | 'accountId'
  | 'categoryId'
  | 'transferGroupId'
  | 'createdAt'
  | 'updatedAt'
>;

export function toResponse(
  tx: TransactionLike,
  counterpartAccountId: Types.ObjectId | null = null,
): TransactionResponse {
  return {
    id: tx._id.toString(),
    type: tx.type,
    amountPaise: tx.amountPaise,
    date: formatCalendarDate(tx.transactionDate),
    title: tx.title,
    notes: tx.notes ?? null,
    paymentMethod: tx.paymentMethod ?? null,
    accountId: tx.accountId.toString(),
    categoryId: tx.categoryId?.toString() ?? null,
    transferGroupId: tx.transferGroupId?.toString() ?? null,
    counterpartAccountId: counterpartAccountId?.toString() ?? null,
    createdAt: tx.createdAt.toISOString(),
    updatedAt: tx.updatedAt.toISOString(),
  };
}

// ---------- validation shared with transfers ----------

/** The account must belong to the user and be active to receive new or moved transactions. */
export async function findUsableAccount(userId: string, accountId: string) {
  const account = await findOwnedAccount(userId, accountId);
  if (!account.isActive) {
    throw new AppError(400, 'VALIDATION_ERROR', 'This account is deactivated', [
      { path: 'accountId', message: 'This account is deactivated. Reactivate it to add transactions.' },
    ]);
  }
  return account;
}

async function findUsableCategory(userId: string, categoryId: string, type: 'INCOME' | 'EXPENSE') {
  const category = await findOwnedCategory(userId, categoryId);
  if (category.type !== type) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Category type does not match the transaction', [
      { path: 'categoryId', message: `Choose an ${type === 'INCOME' ? 'income' : 'expense'} category` },
    ]);
  }
  if (category.isArchived) {
    throw new AppError(400, 'VALIDATION_ERROR', 'This category is archived', [
      { path: 'categoryId', message: 'This category is archived. Unarchive it or choose another.' },
    ]);
  }
  return category;
}

/** Transactions record what happened, so dates after "today" in the user's time zone are rejected. */
export async function assertNotFuture(userId: string, date: string) {
  const user = await UserModel.findById(userId).select('timezone');
  if (date > todayIn(user?.timezone ?? DEFAULT_TIMEZONE)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Date cannot be in the future', [
      { path: 'date', message: 'Date cannot be in the future' },
    ]);
  }
}

// ---------- queries ----------

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds the user-scoped match shared by list and summary. Without an account filter a transfer is
 * shown once (its outgoing leg); filtered to one account, that account's leg is shown.
 */
function buildMatch(userId: string, filters: TransactionFilters): Record<string, unknown> {
  const match: Record<string, unknown> = { userId: new Types.ObjectId(userId) };

  if (filters.from || filters.to) {
    const range: Record<string, Date> = {};
    if (filters.from) range.$gte = parseCalendarDate(filters.from)!;
    if (filters.to) range.$lt = addDays(parseCalendarDate(filters.to)!, 1);
    match.transactionDate = range;
  }

  const typeConditions: Record<string, unknown>[] = [];
  if (filters.type === 'TRANSFER') typeConditions.push({ type: { $in: ['TRANSFER_IN', 'TRANSFER_OUT'] } });
  else if (filters.type) typeConditions.push({ type: filters.type });
  if (!filters.accountId) typeConditions.push({ type: { $ne: 'TRANSFER_IN' } });
  if (typeConditions.length) match.$and = typeConditions;

  if (filters.accountId) match.accountId = new Types.ObjectId(filters.accountId);
  if (filters.categoryId) match.categoryId = new Types.ObjectId(filters.categoryId);
  if (filters.paymentMethod) match.paymentMethod = filters.paymentMethod;
  if (filters.q) match.title = { $regex: escapeRegex(filters.q), $options: 'i' };

  if (filters.minAmountPaise !== undefined || filters.maxAmountPaise !== undefined) {
    const amount: Record<string, number> = {};
    if (filters.minAmountPaise !== undefined) amount.$gte = filters.minAmountPaise;
    if (filters.maxAmountPaise !== undefined) amount.$lte = filters.maxAmountPaise;
    match.amountPaise = amount;
  }
  return match;
}

const SORT_STAGES: Record<ListTransactionsQuery['sort'], Record<string, 1 | -1>> = {
  // _id breaks ties so pagination is stable.
  date_desc: { transactionDate: -1, createdAt: -1, _id: -1 },
  date_asc: { transactionDate: 1, createdAt: 1, _id: 1 },
  amount_desc: { amountPaise: -1, transactionDate: -1, _id: -1 },
  amount_asc: { amountPaise: 1, transactionDate: -1, _id: -1 },
};

/** Looks up the other leg of a transfer so the UI can show "to"/"from" accounts. */
export const COUNTERPART_LOOKUP: PipelineStage.Lookup = {
  $lookup: {
    from: TransactionModel.collection.name,
    let: { groupId: '$transferGroupId', selfId: '$_id' },
    pipeline: [
      {
        $match: {
          $expr: {
            $and: [
              { $ne: ['$$groupId', null] },
              { $eq: ['$transferGroupId', '$$groupId'] },
              { $ne: ['$_id', '$$selfId'] },
            ],
          },
        },
      },
      { $project: { accountId: 1 } },
    ],
    as: 'counterpart',
  },
};

type WithCounterpart = TransactionLike & { counterpart: { accountId: Types.ObjectId }[] };

export async function listTransactions(userId: string, query: ListTransactionsQuery) {
  const { page, pageSize, sort, ...filters } = query;
  const [result] = await TransactionModel.aggregate<{ items: WithCounterpart[]; total: { n: number }[] }>([
    { $match: buildMatch(userId, filters) },
    { $sort: SORT_STAGES[sort] },
    {
      $facet: {
        items: [{ $skip: (page - 1) * pageSize }, { $limit: pageSize }, COUNTERPART_LOOKUP],
        total: [{ $count: 'n' }],
      },
    },
  ]);

  const total = result?.total[0]?.n ?? 0;
  return {
    transactions: (result?.items ?? []).map((tx) => toResponse(tx, tx.counterpart[0]?.accountId ?? null)),
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

/**
 * Income, expense and net per currency for the same filters as the list (transfers never count, FR-016).
 * Totals are grouped by account currency: amounts in different currencies are never added together.
 */
export async function summarizeTransactions(userId: string, filters: TransactionFilters): Promise<SummaryResponse[]> {
  const rows = await TransactionModel.aggregate<Omit<SummaryResponse, 'netPaise'> & { _id: string }>([
    { $match: buildMatch(userId, filters) },
    { $match: { type: { $in: ['INCOME', 'EXPENSE'] } } },
    {
      $lookup: {
        from: AccountModel.collection.name,
        localField: 'accountId',
        foreignField: '_id',
        pipeline: [{ $project: { currency: 1 } }],
        as: 'account',
      },
    },
    {
      $group: {
        _id: { $ifNull: [{ $first: '$account.currency' }, 'INR'] },
        incomePaise: { $sum: { $cond: [{ $eq: ['$type', 'INCOME'] }, '$amountPaise', 0] } },
        expensePaise: { $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$amountPaise', 0] } },
        transactionCount: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return rows.map(({ _id, incomePaise, expensePaise, transactionCount }) => ({
    currency: _id,
    incomePaise,
    expensePaise,
    netPaise: incomePaise - expensePaise,
    transactionCount,
  }));
}

export async function findOwnedTransaction(userId: string, transactionId: string): Promise<TransactionDocument> {
  const tx = await TransactionModel.findOne({ _id: transactionId, userId });
  if (!tx) throw AppError.notFound('Transaction not found');
  return tx;
}

async function counterpartOf(tx: TransactionDocument): Promise<Types.ObjectId | null> {
  if (!tx.transferGroupId) return null;
  const other = await TransactionModel.findOne({
    transferGroupId: tx.transferGroupId,
    userId: tx.userId,
    _id: { $ne: tx._id },
  }).select('accountId');
  return other?.accountId ?? null;
}

export async function getTransaction(userId: string, transactionId: string): Promise<TransactionResponse> {
  const tx = await findOwnedTransaction(userId, transactionId);
  return toResponse(tx, await counterpartOf(tx));
}

// ---------- commands ----------

export async function createTransaction(userId: string, input: CreateTransactionInput): Promise<TransactionResponse> {
  await Promise.all([
    findUsableAccount(userId, input.accountId),
    findUsableCategory(userId, input.categoryId, input.type),
    assertNotFuture(userId, input.date),
  ]);

  const { date, ...rest } = input;
  const tx = await TransactionModel.create({ ...rest, userId, transactionDate: parseCalendarDate(date)! });
  return toResponse(tx);
}

const TRANSFER_EDITABLE = new Set(['amountPaise', 'date', 'title', 'notes']);

export async function updateTransaction(
  userId: string,
  transactionId: string,
  input: UpdateTransactionInput,
): Promise<TransactionResponse> {
  const tx = await findOwnedTransaction(userId, transactionId);
  if (input.date && input.date !== formatCalendarDate(tx.transactionDate)) await assertNotFuture(userId, input.date);

  if (tx.transferGroupId) return updateTransfer(userId, tx, input);

  const nextType = input.type ?? (tx.type as 'INCOME' | 'EXPENSE');
  // Re-check the category whenever the type or category changes, so they always agree.
  if (input.categoryId || input.type) {
    await findUsableCategory(userId, input.categoryId ?? tx.categoryId!.toString(), nextType);
  }
  if (input.accountId && input.accountId !== tx.accountId.toString()) await findUsableAccount(userId, input.accountId);

  const { date, paymentMethod, notes, ...rest } = input;
  tx.set(rest);
  if (date) tx.transactionDate = parseCalendarDate(date)!;
  // null clears an optional field.
  if (paymentMethod !== undefined) tx.set('paymentMethod', paymentMethod ?? undefined);
  if (notes !== undefined) tx.set('notes', notes ?? undefined);
  await tx.save();
  return toResponse(tx);
}

/** Both legs of a transfer always change together, inside one database transaction (FR-015). */
async function updateTransfer(userId: string, tx: TransactionDocument, input: UpdateTransactionInput) {
  const disallowed = Object.keys(input).filter((key) => !TRANSFER_EDITABLE.has(key));
  if (disallowed.length > 0) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Only the amount, date, title and notes of a transfer can be changed. Delete it and create a new transfer instead.',
      disallowed.map((path) => ({ path, message: 'Cannot be changed on a transfer' })),
    );
  }

  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  if (input.amountPaise !== undefined) set.amountPaise = input.amountPaise;
  if (input.date) set.transactionDate = parseCalendarDate(input.date);
  if (input.title) set.title = input.title;
  if (input.notes !== undefined) {
    if (input.notes) set.notes = input.notes;
    else unset.notes = 1;
  }

  await mongoose.connection.transaction(async (session) => {
    await TransactionModel.updateMany(
      { userId: new Types.ObjectId(userId), transferGroupId: tx.transferGroupId },
      { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      { session, runValidators: true },
    );
  });
  return getTransaction(userId, tx._id.toString());
}

/** Deleting either leg of a transfer deletes both. */
export async function deleteTransaction(userId: string, transactionId: string): Promise<{ deletedCount: number }> {
  const tx = await findOwnedTransaction(userId, transactionId);
  if (!tx.transferGroupId) {
    await tx.deleteOne();
    return { deletedCount: 1 };
  }

  let deletedCount = 0;
  await mongoose.connection.transaction(async (session) => {
    const result = await TransactionModel.deleteMany(
      { userId: new Types.ObjectId(userId), transferGroupId: tx.transferGroupId },
      { session },
    );
    deletedCount = result.deletedCount;
  });
  return { deletedCount };
}
