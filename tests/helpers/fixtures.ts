import { Types } from 'mongoose';
import { TransactionModel, type TransactionType } from '../../src/modules/transactions/transaction.model';

/** Inserts a transaction directly (the transactions API arrives in Phase 3). */
export function insertTransaction(fields: {
  userId: string;
  accountId: string;
  type: TransactionType;
  amountPaise: number;
  categoryId?: string;
}) {
  return TransactionModel.create({
    ...fields,
    title: `${fields.type} test`,
    transactionDate: new Date(),
    ...(fields.type.startsWith('TRANSFER') ? { transferGroupId: new Types.ObjectId() } : {}),
  });
}
