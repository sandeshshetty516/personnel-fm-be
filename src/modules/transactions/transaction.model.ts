import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';

/**
 * Amounts are always positive paise; the type decides the direction.
 * A transfer is two documents sharing a transferGroupId: TRANSFER_OUT on the source account and
 * TRANSFER_IN on the destination. Transfers never count as income or expense (FR-016).
 */
export const TRANSACTION_TYPES = ['INCOME', 'EXPENSE', 'TRANSFER_IN', 'TRANSFER_OUT'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/** Types that add to / subtract from an account balance. */
export const CREDIT_TYPES: readonly TransactionType[] = ['INCOME', 'TRANSFER_IN'];
export const DEBIT_TYPES: readonly TransactionType[] = ['EXPENSE', 'TRANSFER_OUT'];

export const PAYMENT_METHODS = ['CASH', 'UPI', 'DEBIT_CARD', 'CREDIT_CARD', 'NET_BANKING', 'CHEQUE', 'OTHER'] as const;

const transactionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true },
    // Required for INCOME/EXPENSE, absent for transfers (enforced in the service layer).
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category' },
    type: { type: String, enum: TRANSACTION_TYPES, required: true },
    amountPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    transactionDate: { type: Date, required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    paymentMethod: { type: String, enum: PAYMENT_METHODS },
    notes: { type: String, trim: true, maxlength: 1000 },
    transferGroupId: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

transactionSchema.index({ userId: 1, transactionDate: -1 });
transactionSchema.index({ userId: 1, accountId: 1, transactionDate: -1 });
transactionSchema.index({ userId: 1, categoryId: 1 });
transactionSchema.index({ transferGroupId: 1 }, { sparse: true });

export type Transaction = InferSchemaType<typeof transactionSchema>;
export type TransactionDocument = HydratedDocument<Transaction>;

export const TransactionModel = model('Transaction', transactionSchema);
