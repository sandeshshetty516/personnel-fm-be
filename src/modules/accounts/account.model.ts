import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';
import { SUPPORTED_CURRENCIES } from '../users/user.model';

export const ACCOUNT_TYPES = ['SAVINGS', 'CURRENT', 'CASH', 'CREDIT_CARD', 'WALLET'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

const accountSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    accountType: { type: String, enum: ACCOUNT_TYPES, required: true },
    // May be negative, e.g. an outstanding credit-card balance.
    openingBalancePaise: { type: Number, required: true, default: 0, validate: Number.isSafeInteger },
    currency: { type: String, enum: SUPPORTED_CURRENCIES, required: true },
    institution: { type: String, trim: true, maxlength: 80 },
    // Never store full account/card numbers; last four digits are enough to tell accounts apart.
    lastFourDigits: { type: String, match: /^\d{4}$/ },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Account names are unique per user, ignoring case.
accountSchema.index({ userId: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
accountSchema.index({ userId: 1, isActive: 1 });

export type Account = InferSchemaType<typeof accountSchema>;
export type AccountDocument = HydratedDocument<Account>;

export const AccountModel = model('Account', accountSchema);
