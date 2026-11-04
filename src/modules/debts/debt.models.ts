import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { SUPPORTED_CURRENCIES } from '../users/user.model';

export const DEBT_DIRECTIONS = ['LENT', 'BORROWED'] as const;
export const DEBT_STATUSES = ['OPEN', 'SETTLED', 'WRITTEN_OFF'] as const;
export const DEBT_ENTRY_TYPES = ['PRINCIPAL', 'REPAYMENT', 'WRITE_OFF'] as const;
export type DebtDirection = (typeof DEBT_DIRECTIONS)[number];
export type DebtStatus = (typeof DEBT_STATUSES)[number];
export type DebtEntryType = (typeof DEBT_ENTRY_TYPES)[number];

/**
 * Money lent to (LENT) or borrowed from (BORROWED) another person, interest-free (FR-075).
 * The running totals are kept in step with debtEntries inside a transaction; outstanding is
 * principal − repaid − writtenOff, and the conditional update on it stops repayments overshooting (FR-080).
 */
const debtSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    direction: { type: String, enum: DEBT_DIRECTIONS, required: true },
    personName: { type: String, required: true, trim: true, maxlength: 80 },
    phone: { type: String, trim: true, maxlength: 20 },
    currency: { type: String, enum: SUPPORTED_CURRENCIES, required: true },
    startDate: { type: Date, required: true },
    dueDate: { type: Date },
    notes: { type: String, trim: true, maxlength: 500 },
    principalPaise: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    repaidPaise: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    writtenOffPaise: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    status: { type: String, enum: DEBT_STATUSES, default: 'OPEN' },
    closedAt: { type: Date },
  },
  { timestamps: true },
);
debtSchema.index({ userId: 1, direction: 1, status: 1 });

/**
 * One change to a debt. With an accountId it also has a transaction (transactionId) that moves that
 * account's balance; a write-off's transaction is a Bad Debt expense that moves no balance (FR-079).
 */
const debtEntrySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    debtId: { type: Schema.Types.ObjectId, ref: 'Debt', required: true },
    type: { type: String, enum: DEBT_ENTRY_TYPES, required: true },
    amountPaise: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    entryDate: { type: Date, required: true },
    accountId: { type: Schema.Types.ObjectId, ref: 'Account' },
    transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction' },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true },
);
debtEntrySchema.index({ userId: 1, debtId: 1, entryDate: -1 });

export type DebtDocument = HydratedDocument<InferSchemaType<typeof debtSchema>>;
export type DebtEntryDocument = HydratedDocument<InferSchemaType<typeof debtEntrySchema>>;

export const DebtModel = model('Debt', debtSchema, 'debts');
export const DebtEntryModel = model('DebtEntry', debtEntrySchema, 'debtEntries');
