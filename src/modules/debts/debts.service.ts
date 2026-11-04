import mongoose, { Types, type ClientSession } from 'mongoose';
import { formatCalendarDate, parseCalendarDate, todayIn } from '../../common/dates';
import { AppError } from '../../common/errors';
import type { AccountDocument } from '../accounts/account.model';
import { findOwnedAccount } from '../accounts/accounts.service';
import { CategoryModel } from '../categories/category.model';
import { TransactionModel, type TransactionType } from '../transactions/transaction.model';
import { findUsableAccount } from '../transactions/transactions.service';
import { DEFAULT_TIMEZONE, UserModel } from '../users/user.model';
import {
  DebtEntryModel,
  DebtModel,
  type DebtDirection,
  type DebtDocument,
  type DebtEntryDocument,
  type DebtEntryType,
  type DebtStatus,
} from './debt.models';
import type {
  CreateDebtEntryInput,
  CreateDebtInput,
  DebtEntryResponse,
  DebtResponse,
  DebtSummaryResponse,
  UpdateDebtInput,
} from './debts.schemas';

const BAD_DEBT_CATEGORY = { name: 'Bad Debt', icon: 'loan', color: '#8d6e63' } as const;

type Totals = Pick<DebtDocument, 'principalPaise' | 'repaidPaise' | 'writtenOffPaise'>;

const outstandingOf = (d: Totals) => d.principalPaise - d.repaidPaise - d.writtenOffPaise;

function statusFor(d: Totals): DebtStatus {
  if (outstandingOf(d) > 0) return 'OPEN';
  return d.writtenOffPaise > 0 ? 'WRITTEN_OFF' : 'SETTLED';
}

function toResponse(debt: DebtDocument, today: string): DebtResponse {
  const outstandingPaise = outstandingOf(debt);
  const dueDate = debt.dueDate ? formatCalendarDate(debt.dueDate) : null;
  const closedPaise = debt.repaidPaise + debt.writtenOffPaise;
  return {
    id: debt._id.toString(),
    direction: debt.direction,
    personName: debt.personName,
    phone: debt.phone ?? null,
    currency: debt.currency,
    startDate: formatCalendarDate(debt.startDate),
    dueDate,
    notes: debt.notes ?? null,
    principalPaise: debt.principalPaise,
    repaidPaise: debt.repaidPaise,
    writtenOffPaise: debt.writtenOffPaise,
    outstandingPaise,
    progressPercent: debt.principalPaise > 0 ? Math.floor((closedPaise * 1000) / debt.principalPaise) / 10 : 0,
    status: debt.status,
    isOverdue: debt.status === 'OPEN' && dueDate !== null && dueDate < today,
    closedAt: debt.closedAt?.toISOString() ?? null,
    createdAt: debt.createdAt.toISOString(),
  };
}

function toEntryResponse(entry: DebtEntryDocument): DebtEntryResponse {
  return {
    id: entry._id.toString(),
    debtId: entry.debtId.toString(),
    type: entry.type,
    amountPaise: entry.amountPaise,
    date: formatCalendarDate(entry.entryDate),
    accountId: entry.accountId?.toString() ?? null,
    transactionId: entry.transactionId?.toString() ?? null,
    notes: entry.notes ?? null,
    createdAt: entry.createdAt.toISOString(),
  };
}

async function userContext(userId: string) {
  const user = await UserModel.findById(userId).select('timezone currency');
  if (!user) throw AppError.unauthorized();
  return { today: todayIn(user.timezone ?? DEFAULT_TIMEZONE), currency: user.currency };
}

function validationError(path: string, message: string) {
  return new AppError(400, 'VALIDATION_ERROR', message, [{ path, message }]);
}

export async function findOwnedDebt(userId: string, debtId: string): Promise<DebtDocument> {
  const debt = await DebtModel.findOne({ _id: debtId, userId });
  if (!debt) throw AppError.notFound('Lend/borrow record not found');
  return debt;
}

// ---------- entry → transaction ----------

/** Lending and repaying a borrowed amount take money out; borrowing and being repaid bring it in. */
function cashTypeFor(direction: DebtDirection, entryType: DebtEntryType): TransactionType {
  return (direction === 'LENT') === (entryType === 'PRINCIPAL') ? 'DEBT_OUT' : 'DEBT_IN';
}

function titleFor(direction: DebtDirection, entryType: DebtEntryType, personName: string): string {
  if (entryType === 'WRITE_OFF') return `Bad debt: ${personName}`;
  if (direction === 'LENT') return entryType === 'PRINCIPAL' ? `Lent to ${personName}` : `Repayment from ${personName}`;
  return entryType === 'PRINCIPAL' ? `Borrowed from ${personName}` : `Repaid to ${personName}`;
}

/** The user's "Bad Debt" expense category, created the first time something is written off. */
async function badDebtCategoryId(userId: Types.ObjectId, session: ClientSession) {
  const category = await CategoryModel.findOneAndUpdate(
    { userId, type: 'EXPENSE', name: BAD_DEBT_CATEGORY.name },
    { $setOnInsert: { icon: BAD_DEBT_CATEGORY.icon, color: BAD_DEBT_CATEGORY.color } },
    { upsert: true, returnDocument: 'after', session, collation: { locale: 'en', strength: 2 } },
  );
  return category!._id;
}

interface EntryWrite {
  type: DebtEntryType;
  amountPaise: number;
  date: string;
  account: AccountDocument | null;
  notes?: string;
}

/** Creates the entry and, when it has an account, its transaction. Must run inside `session`. */
async function writeEntry(debt: DebtDocument, entry: EntryWrite, session: ClientSession) {
  const entryDate = parseCalendarDate(entry.date)!;
  let transactionId: Types.ObjectId | undefined;

  if (entry.account) {
    const writeOff = entry.type === 'WRITE_OFF';
    const [tx] = await TransactionModel.create(
      [
        {
          userId: debt.userId,
          accountId: entry.account._id,
          type: writeOff ? 'EXPENSE' : cashTypeFor(debt.direction, entry.type),
          amountPaise: entry.amountPaise,
          transactionDate: entryDate,
          title: titleFor(debt.direction, entry.type, debt.personName),
          ...(entry.notes ? { notes: entry.notes } : {}),
          debtId: debt._id,
          // The money already left the account when it was lent; the write-off only books the loss.
          ...(writeOff ? { categoryId: await badDebtCategoryId(debt.userId, session), affectsBalance: false } : {}),
        },
      ],
      { session },
    );
    transactionId = tx!._id;
  }

  const [created] = await DebtEntryModel.create(
    [
      {
        userId: debt.userId,
        debtId: debt._id,
        type: entry.type,
        amountPaise: entry.amountPaise,
        entryDate,
        ...(entry.account ? { accountId: entry.account._id } : {}),
        ...(transactionId ? { transactionId } : {}),
        ...(entry.notes ? { notes: entry.notes } : {}),
      },
    ],
    { session },
  );
  return created!;
}

/** Keeps status and closedAt in line with the totals after they change. */
async function syncStatus(debt: DebtDocument, session: ClientSession) {
  const status = statusFor(debt);
  if (status === debt.status) return;
  debt.status = status;
  debt.set('closedAt', status === 'OPEN' ? undefined : new Date());
  await debt.save({ session });
}

/** The account must belong to the user and use the debt's currency; amounts are never converted. */
async function resolveAccount(userId: string, accountId: string, currency: string, forWriteOff = false) {
  // A write-off moves no money, so it may be reported under a deactivated account.
  const account = forWriteOff ? await findOwnedAccount(userId, accountId) : await findUsableAccount(userId, accountId);
  if (account.currency !== currency) throw validationError('accountId', `Choose a ${currency} account`);
  return account;
}

// ---------- queries ----------

export async function listDebts(
  userId: string,
  filters: { direction?: DebtDirection; status?: DebtStatus },
): Promise<DebtResponse[]> {
  const { today } = await userContext(userId);
  const debts = await DebtModel.find({
    userId,
    ...(filters.direction ? { direction: filters.direction } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  }).sort({ status: 1, startDate: -1, createdAt: -1 });
  return debts.map((d) => toResponse(d, today));
}

export async function getDebt(userId: string, debtId: string): Promise<DebtResponse> {
  const { today } = await userContext(userId);
  return toResponse(await findOwnedDebt(userId, debtId), today);
}

export async function getEntries(userId: string, debtId: string): Promise<DebtEntryResponse[]> {
  const debt = await findOwnedDebt(userId, debtId);
  const entries = await DebtEntryModel.find({ userId: new Types.ObjectId(userId), debtId: debt._id }).sort({
    entryDate: -1,
    createdAt: -1,
  });
  return entries.map(toEntryResponse);
}

/** Totals receivable and payable per currency, with a per-person breakdown of open debts (FR-081). */
export async function getSummary(userId: string): Promise<DebtSummaryResponse[]> {
  const { today } = await userContext(userId);
  const todayDate = parseCalendarDate(today)!;
  const outstanding = { $subtract: ['$principalPaise', { $add: ['$repaidPaise', '$writtenOffPaise'] }] };
  const lent = (value: unknown) => ({ $cond: [{ $eq: ['$direction', 'LENT'] }, value, 0] });
  const borrowed = (value: unknown) => ({ $cond: [{ $eq: ['$direction', 'BORROWED'] }, value, 0] });

  const rows = await DebtModel.aggregate<{
    _id: string;
    receivablePaise: number;
    payablePaise: number;
    openLentCount: number;
    openBorrowedCount: number;
    overdueCount: number;
    people: { personName: string; receivablePaise: number; payablePaise: number }[];
  }>([
    { $match: { userId: new Types.ObjectId(userId), status: 'OPEN' } },
    {
      $group: {
        _id: { currency: '$currency', person: { $toLower: '$personName' } },
        personName: { $first: '$personName' },
        receivablePaise: { $sum: lent(outstanding) },
        payablePaise: { $sum: borrowed(outstanding) },
        openLentCount: { $sum: lent(1) },
        openBorrowedCount: { $sum: borrowed(1) },
        overdueCount: { $sum: { $cond: [{ $and: ['$dueDate', { $lt: ['$dueDate', todayDate] }] }, 1, 0] } },
      },
    },
    { $sort: { personName: 1 } },
    {
      $group: {
        _id: '$_id.currency',
        receivablePaise: { $sum: '$receivablePaise' },
        payablePaise: { $sum: '$payablePaise' },
        openLentCount: { $sum: '$openLentCount' },
        openBorrowedCount: { $sum: '$openBorrowedCount' },
        overdueCount: { $sum: '$overdueCount' },
        people: { $push: { personName: '$personName', receivablePaise: '$receivablePaise', payablePaise: '$payablePaise' } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return rows.map(({ _id, people, ...totals }) => ({
    currency: _id,
    ...totals,
    people: people.map((p) => ({ ...p, netPaise: p.receivablePaise - p.payablePaise })),
  }));
}

// ---------- commands ----------

/** Records money lent or borrowed: the debt, its first entry and any transaction are written together. */
export async function createDebt(
  userId: string,
  input: CreateDebtInput,
): Promise<{ debt: DebtResponse; entry: DebtEntryResponse }> {
  const { today, currency: userCurrency } = await userContext(userId);
  if (input.date > today) throw validationError('date', 'Date cannot be in the future');
  const account = input.accountId ? await findUsableAccount(userId, input.accountId) : null;

  let debt: DebtDocument | undefined;
  let entry: DebtEntryDocument | undefined;
  await mongoose.connection.transaction(async (session) => {
    [debt] = await DebtModel.create(
      [
        {
          userId,
          direction: input.direction,
          personName: input.personName,
          ...(input.phone ? { phone: input.phone } : {}),
          currency: account?.currency ?? userCurrency,
          startDate: parseCalendarDate(input.date)!,
          ...(input.dueDate ? { dueDate: parseCalendarDate(input.dueDate)! } : {}),
          ...(input.notes ? { notes: input.notes } : {}),
          principalPaise: input.amountPaise,
        },
      ],
      { session },
    );
    entry = await writeEntry(debt!, { type: 'PRINCIPAL', amountPaise: input.amountPaise, date: input.date, account }, session);
  });

  return { debt: toResponse(debt!, today), entry: toEntryResponse(entry!) };
}

export async function updateDebt(userId: string, debtId: string, input: UpdateDebtInput): Promise<DebtResponse> {
  const { today } = await userContext(userId);
  const debt = await findOwnedDebt(userId, debtId);
  if (input.dueDate && input.dueDate < formatCalendarDate(debt.startDate)) {
    throw validationError('dueDate', 'Due date cannot be before the start date');
  }
  if (input.personName) debt.personName = input.personName;
  // null clears an optional field.
  if (input.phone !== undefined) debt.set('phone', input.phone || undefined);
  if (input.notes !== undefined) debt.set('notes', input.notes || undefined);
  if (input.dueDate !== undefined) debt.set('dueDate', input.dueDate ? parseCalendarDate(input.dueDate)! : undefined);
  await debt.save();
  return toResponse(debt, today);
}

const TOTAL_FIELD: Record<DebtEntryType, 'principalPaise' | 'repaidPaise' | 'writtenOffPaise'> = {
  PRINCIPAL: 'principalPaise',
  REPAYMENT: 'repaidPaise',
  WRITE_OFF: 'writtenOffPaise',
};

/**
 * Adds a further amount, a repayment or a write-off (FR-076, FR-079). Repayments and write-offs are
 * applied with a conditional update, so they can never exceed what is outstanding (FR-080).
 */
export async function addEntry(
  userId: string,
  debtId: string,
  input: CreateDebtEntryInput,
): Promise<{ debt: DebtResponse; entry: DebtEntryResponse }> {
  const { today } = await userContext(userId);
  const debt = await findOwnedDebt(userId, debtId);
  if (input.date > today) throw validationError('date', 'Date cannot be in the future');
  if (input.date < formatCalendarDate(debt.startDate)) {
    throw validationError('date', 'Date cannot be before the record was started');
  }

  const writeOff = input.type === 'WRITE_OFF';
  if (writeOff && debt.direction !== 'LENT') {
    throw validationError('type', 'Only money you lent can be written off');
  }

  let accountId = input.accountId;
  if (writeOff && !accountId) {
    // Report the loss under the account the money was lent from.
    const lentFrom = await DebtEntryModel.findOne({
      debtId: debt._id,
      type: 'PRINCIPAL',
      accountId: { $exists: true },
    }).sort({ entryDate: -1, createdAt: -1 });
    accountId = lentFrom?.accountId?.toString();
    if (!accountId) throw validationError('accountId', 'Choose the account to report this expense under');
  }
  const account = accountId ? await resolveAccount(userId, accountId, debt.currency, writeOff) : null;

  const closing = input.type !== 'PRINCIPAL';
  let updated: DebtDocument | null = null;
  let entry: DebtEntryDocument | undefined;
  await mongoose.connection.transaction(async (session) => {
    updated = await DebtModel.findOneAndUpdate(
      {
        _id: debt._id,
        userId,
        ...(closing
          ? {
              $expr: {
                $gte: [
                  { $subtract: ['$principalPaise', { $add: ['$repaidPaise', '$writtenOffPaise'] }] },
                  input.amountPaise,
                ],
              },
            }
          : {}),
      },
      { $inc: { [TOTAL_FIELD[input.type]]: input.amountPaise } },
      { session, returnDocument: 'after' },
    );
    if (!updated) {
      throw validationError('amountPaise', 'More than the amount outstanding');
    }
    await syncStatus(updated, session);
    entry = await writeEntry(
      updated,
      { type: input.type, amountPaise: input.amountPaise, date: input.date, account, notes: input.notes },
      session,
    );
  });

  return { debt: toResponse(updated!, today), entry: toEntryResponse(entry!) };
}

/** Removes a mistaken entry and its transaction, reversing its effect on the totals and the balance. */
export async function deleteEntry(userId: string, debtId: string, entryId: string): Promise<DebtResponse> {
  const { today } = await userContext(userId);
  const debt = await findOwnedDebt(userId, debtId);
  const entry = await DebtEntryModel.findOne({ _id: entryId, debtId: debt._id, userId });
  if (!entry) throw AppError.notFound('Entry not found');

  let updated: DebtDocument | null = null;
  await mongoose.connection.transaction(async (session) => {
    updated = await DebtModel.findOneAndUpdate(
      {
        _id: debt._id,
        userId,
        // A lent/borrowed amount can only go if what is left still covers repayments and write-offs.
        ...(entry.type === 'PRINCIPAL'
          ? {
              $expr: {
                $and: [
                  { $gt: [{ $subtract: ['$principalPaise', entry.amountPaise] }, 0] },
                  {
                    $gte: [
                      { $subtract: ['$principalPaise', entry.amountPaise] },
                      { $add: ['$repaidPaise', '$writtenOffPaise'] },
                    ],
                  },
                ],
              },
            }
          : {}),
      },
      { $inc: { [TOTAL_FIELD[entry.type]]: -entry.amountPaise } },
      { session, returnDocument: 'after' },
    );
    if (!updated) {
      throw AppError.badRequest(
        'Removing this amount would leave less than has been repaid or written off. ' +
          'Remove those entries first, or delete the whole record.',
      );
    }
    await syncStatus(updated, session);
    if (entry.transactionId) await TransactionModel.deleteOne({ _id: entry.transactionId, userId }, { session });
    await DebtEntryModel.deleteOne({ _id: entry._id }, { session });
  });
  return toResponse(updated!, today);
}

/** Deletes a record with all of its entries and transactions, restoring the affected balances. */
export async function deleteDebt(userId: string, debtId: string): Promise<{ deletedTransactionCount: number }> {
  const debt = await findOwnedDebt(userId, debtId);
  const scope = { userId: new Types.ObjectId(userId), debtId: debt._id };
  let deletedTransactionCount = 0;
  await mongoose.connection.transaction(async (session) => {
    const result = await TransactionModel.deleteMany(scope, { session });
    deletedTransactionCount = result.deletedCount;
    await DebtEntryModel.deleteMany(scope, { session });
    await DebtModel.deleteOne({ _id: debt._id }, { session });
  });
  return { deletedTransactionCount };
}
