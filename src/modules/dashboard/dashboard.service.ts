import { Types } from 'mongoose';
import {
  addDays,
  currentFinancialMonth,
  financialMonthBuckets,
  formatCalendarDate,
  parseCalendarDate,
  todayIn,
} from '../../common/dates';
import { AppError } from '../../common/errors';
import { AccountModel } from '../accounts/account.model';
import { getNetMovements } from '../accounts/accountBalance.service';
import { CategoryModel } from '../categories/category.model';
import { TransactionModel } from '../transactions/transaction.model';
import { COUNTERPART_LOOKUP, toResponse } from '../transactions/transactions.service';
import { DEFAULT_TIMEZONE, SUPPORTED_CURRENCIES, UserModel } from '../users/user.model';
import {
  MAX_TREND_BUCKETS,
  type BreakdownQuery,
  type CashFlowBucket,
  type CategorySlice,
  type DashboardSummary,
  type PeriodQuery,
  type RecentQuery,
  type SavingsBucket,
} from './dashboard.schemas';

interface Scope {
  userId: Types.ObjectId;
  from: string;
  to: string;
  currency: (typeof SUPPORTED_CURRENCIES)[number];
  monthStartDay: number;
  /** All of the user's accounts in the chosen currency, active or not (history still counts). */
  accountIds: Types.ObjectId[];
}

/** One decimal place, computed from integers; display-only, never fed back into totals. */
function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part * 1000) / whole) / 10 : null;
}

/** Resolves the shared period/currency scope every dashboard widget uses. */
async function resolveScope(userId: string, query: PeriodQuery): Promise<Scope> {
  const user = await UserModel.findById(userId).select('currency monthStartDay timezone');
  if (!user) throw AppError.unauthorized();

  const currency = query.currency ?? user.currency;
  const period =
    query.from && query.to
      ? { from: query.from, to: query.to }
      : currentFinancialMonth(todayIn(user.timezone ?? DEFAULT_TIMEZONE), user.monthStartDay);
  const accounts = await AccountModel.find({ userId, currency }).select('_id');

  return {
    userId: new Types.ObjectId(userId),
    ...period,
    currency,
    monthStartDay: user.monthStartDay,
    accountIds: accounts.map((a) => a._id),
  };
}

function dateRange(from: string, to: string) {
  return { $gte: parseCalendarDate(from)!, $lt: addDays(parseCalendarDate(to)!, 1) };
}

/** Income and expense only; transfers never count (FR-016). */
function entryMatch(scope: Scope) {
  return {
    userId: scope.userId,
    accountId: { $in: scope.accountIds },
    transactionDate: dateRange(scope.from, scope.to),
    type: { $in: ['INCOME', 'EXPENSE'] },
  };
}

const SUM_BY_TYPE = {
  incomePaise: { $sum: { $cond: [{ $eq: ['$type', 'INCOME'] }, '$amountPaise', 0] } },
  expensePaise: { $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$amountPaise', 0] } },
  count: { $sum: 1 },
};

export async function getSummary(userId: string, query: PeriodQuery): Promise<DashboardSummary> {
  const scope = await resolveScope(userId, query);
  const [[totals], currencies, activeAccounts] = await Promise.all([
    TransactionModel.aggregate<{ incomePaise: number; expensePaise: number; count: number }>([
      { $match: entryMatch(scope) },
      { $group: { _id: null, ...SUM_BY_TYPE } },
    ]),
    AccountModel.distinct('currency', { userId: scope.userId }),
    AccountModel.find({ userId: scope.userId, currency: scope.currency, isActive: true }).select('openingBalancePaise'),
  ]);

  const movements = await getNetMovements(
    userId,
    activeAccounts.map((a) => a._id),
  );
  const totalBalancePaise = activeAccounts.reduce(
    (sum, a) => sum + a.openingBalancePaise + (movements.get(a._id.toString()) ?? 0),
    0,
  );

  const incomePaise = totals?.incomePaise ?? 0;
  const expensePaise = totals?.expensePaise ?? 0;
  const netPaise = incomePaise - expensePaise;

  return {
    period: { from: scope.from, to: scope.to, currency: scope.currency },
    availableCurrencies: (currencies as string[]).sort(),
    incomePaise,
    expensePaise,
    netPaise,
    savingsRatePercent: percent(netPaise, incomePaise),
    totalBalancePaise,
    activeAccountCount: activeAccounts.length,
    transactionCount: totals?.count ?? 0,
  };
}

/**
 * Income and expense per financial month across the period (FR-058). Months with no activity are
 * included as zeros so the trend has no gaps.
 */
export async function getCashFlow(
  userId: string,
  query: PeriodQuery,
): Promise<{
  period: { from: string; to: string; currency: string };
  buckets: CashFlowBucket[];
}> {
  const scope = await resolveScope(userId, query);
  const buckets = financialMonthBuckets(scope.from, scope.to, scope.monthStartDay);
  if (buckets.length > MAX_TREND_BUCKETS) {
    throw AppError.badRequest(`Choose a period of at most ${MAX_TREND_BUCKETS} months for trends`);
  }

  const boundaries = [...buckets.map((b) => b.start), buckets.at(-1)!.end];
  const rows = await TransactionModel.aggregate<{ _id: Date; incomePaise: number; expensePaise: number }>([
    { $match: entryMatch(scope) },
    { $bucket: { groupBy: '$transactionDate', boundaries, output: SUM_BY_TYPE } },
  ]);
  const byStart = new Map(rows.map((row) => [row._id.getTime(), row]));

  return {
    period: { from: scope.from, to: scope.to, currency: scope.currency },
    buckets: buckets.map(({ start, end }) => {
      const row = byStart.get(start.getTime());
      const incomePaise = row?.incomePaise ?? 0;
      const expensePaise = row?.expensePaise ?? 0;
      return {
        from: formatCalendarDate(start),
        to: formatCalendarDate(addDays(end, -1)),
        incomePaise,
        expensePaise,
        netPaise: incomePaise - expensePaise,
      };
    }),
  };
}

/** Net savings per month, running total and savings rate, from the same buckets as the cash flow. */
export async function getSavingsTrend(userId: string, query: PeriodQuery) {
  const { period, buckets } = await getCashFlow(userId, query);
  let cumulative = 0;
  const trend: SavingsBucket[] = buckets.map((bucket) => {
    cumulative += bucket.netPaise;
    return {
      from: bucket.from,
      to: bucket.to,
      netPaise: bucket.netPaise,
      cumulativeNetPaise: cumulative,
      savingsRatePercent: percent(bucket.netPaise, bucket.incomePaise),
    };
  });
  return { period, buckets: trend };
}

/** Totals per category for the period, largest first (FR-057). */
export async function getCategoryBreakdown(userId: string, query: BreakdownQuery) {
  const scope = await resolveScope(userId, query);
  const rows = await TransactionModel.aggregate<{ _id: Types.ObjectId; amountPaise: number; count: number }>([
    { $match: { ...entryMatch(scope), type: query.type } },
    { $group: { _id: '$categoryId', amountPaise: { $sum: '$amountPaise' }, count: { $sum: 1 } } },
    { $sort: { amountPaise: -1, _id: 1 } },
  ]);

  const categories = await CategoryModel.find({ userId: scope.userId, _id: { $in: rows.map((r) => r._id) } });
  const byId = new Map(categories.map((c) => [c._id.toString(), c]));
  const totalPaise = rows.reduce((sum, row) => sum + row.amountPaise, 0);

  const slices: CategorySlice[] = rows.map((row) => {
    const category = byId.get(row._id?.toString() ?? '');
    return {
      categoryId: row._id?.toString() ?? 'uncategorised',
      name: category?.name ?? 'Uncategorised',
      icon: category?.icon ?? 'other',
      color: category?.color ?? '#78909c',
      amountPaise: row.amountPaise,
      sharePercent: percent(row.amountPaise, totalPaise) ?? 0,
      transactionCount: row.count,
    };
  });

  return {
    period: { from: scope.from, to: scope.to, currency: scope.currency },
    type: query.type,
    totalPaise,
    categories: slices,
  };
}

/** Latest transactions in the period; each transfer appears once (FR-059). */
export async function getRecentTransactions(userId: string, query: RecentQuery) {
  const scope = await resolveScope(userId, query);
  const rows = await TransactionModel.aggregate([
    {
      $match: {
        userId: scope.userId,
        accountId: { $in: scope.accountIds },
        transactionDate: dateRange(scope.from, scope.to),
        type: { $ne: 'TRANSFER_IN' },
      },
    },
    { $sort: { transactionDate: -1, createdAt: -1, _id: -1 } },
    { $limit: query.limit },
    COUNTERPART_LOOKUP,
  ]);
  return {
    period: { from: scope.from, to: scope.to, currency: scope.currency },
    transactions: rows.map((tx) => toResponse(tx, tx.counterpart[0]?.accountId ?? null)),
  };
}
