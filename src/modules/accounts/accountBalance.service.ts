import { Types } from 'mongoose';
import { CREDIT_TYPES, TransactionModel } from '../transactions/transaction.model';

/**
 * Net transaction movement per account, in paise: credits (income, transfers and debts in) minus
 * debits (expenses, transfers and debts out). Computed by aggregation rather than stored, so balances
 * always reflect the latest transaction state (FR-031) and cannot drift. Bad-debt write-offs
 * (affectsBalance: false) are expenses that never move a balance (FR-079).
 */
export async function getNetMovements(userId: string, accountIds: Types.ObjectId[]): Promise<Map<string, number>> {
  if (accountIds.length === 0) return new Map();

  const rows = await TransactionModel.aggregate<{ _id: Types.ObjectId; netPaise: number }>([
    {
      $match: {
        userId: new Types.ObjectId(userId),
        accountId: { $in: accountIds },
        affectsBalance: { $ne: false },
      },
    },
    {
      $group: {
        _id: '$accountId',
        netPaise: {
          $sum: { $cond: [{ $in: ['$type', CREDIT_TYPES] }, '$amountPaise', { $multiply: ['$amountPaise', -1] }] },
        },
      },
    },
  ]);

  return new Map(rows.map((row) => [row._id.toString(), row.netPaise]));
}
