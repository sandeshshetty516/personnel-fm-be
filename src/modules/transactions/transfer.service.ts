import mongoose, { Types } from 'mongoose';
import { parseCalendarDate } from '../../common/dates';
import { AppError } from '../../common/errors';
import { TransactionModel } from './transaction.model';
import type { CreateTransferInput, TransactionResponse } from './transactions.schemas';
import { assertNotFuture, findUsableAccount, toResponse } from './transactions.service';

export interface TransferResponse {
  transferGroupId: string;
  outgoing: TransactionResponse;
  incoming: TransactionResponse;
}

/**
 * Moves money between two of the user's accounts (FR-014). Both legs share a transferGroupId and are
 * written in one MongoDB transaction, so either both exist or neither does (FR-015). Transfers never
 * count as income or expense (FR-016).
 */
export async function createTransfer(userId: string, input: CreateTransferInput): Promise<TransferResponse> {
  const [from, to] = await Promise.all([
    findUsableAccount(userId, input.fromAccountId),
    findUsableAccount(userId, input.toAccountId),
    assertNotFuture(userId, input.date),
  ]);

  // No exchange-rate policy exists yet (spec §11), so cross-currency transfers are refused.
  if (from.currency !== to.currency) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Both accounts must use the same currency', [
      { path: 'toAccountId', message: `Choose a ${from.currency} account` },
    ]);
  }

  const transferGroupId = new Types.ObjectId();
  const shared = {
    userId: new Types.ObjectId(userId),
    amountPaise: input.amountPaise,
    transactionDate: parseCalendarDate(input.date)!,
    title: input.title ?? `${from.name} → ${to.name}`,
    ...(input.notes ? { notes: input.notes } : {}),
    transferGroupId,
  };

  const [outgoing, incoming] = await mongoose.connection.transaction(async (session) =>
    TransactionModel.create(
      [
        { ...shared, accountId: from._id, type: 'TRANSFER_OUT' },
        { ...shared, accountId: to._id, type: 'TRANSFER_IN' },
      ],
      { session, ordered: true },
    ),
  );

  return {
    transferGroupId: transferGroupId.toString(),
    outgoing: toResponse(outgoing!, to._id),
    incoming: toResponse(incoming!, from._id),
  };
}
