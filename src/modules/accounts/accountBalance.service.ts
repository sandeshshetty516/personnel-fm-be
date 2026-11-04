import { Types } from 'mongoose';
import { CREDIT_TYPES, TransactionModel } from '../transactions/transaction.model';

/**
 * Net transaction movement per account, in paise: credits (income, transfers in) minus
 * debits (expenses, transfers out). Computed by aggregation rather than stored, so balances
 * always reflect the latest transaction state (FR-031) and cannot drift.
 */
export async function getNetMovements(userId: string, accountIds: Types.ObjectId[]): Promise<Map<string, number>> {
  if (accountIds.length === 0) return new Map();

  const rows = await TransactionModel.aggregate<{ _id: Types.ObjectId; netPaise: number }>([
    { $match: { userId: new Types.ObjectId(userId), accountId: { $in: accountIds } } },
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
