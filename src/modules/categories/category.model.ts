import { model, Schema, type HydratedDocument, type InferSchemaType } from 'mongoose';

export const CATEGORY_TYPES = ['INCOME', 'EXPENSE'] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];

/** Icon keys; the frontend maps each key to an icon component. */
export const CATEGORY_ICONS = [
  'salary',
  'freelance',
  'business',
  'interest',
  'investment',
  'gift',
  'refund',
  'home',
  'groceries',
  'dining',
  'fuel',
  'transport',
  'utilities',
  'phone',
  'shopping',
  'health',
  'education',
  'entertainment',
  'travel',
  'insurance',
  'loan',
  'personal-care',
  'pets',
  'kids',
  'subscriptions',
  'tax',
  'charity',
  'other',
] as const;
export type CategoryIcon = (typeof CATEGORY_ICONS)[number];

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const categorySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    type: { type: String, enum: CATEGORY_TYPES, required: true },
    icon: { type: String, enum: CATEGORY_ICONS, default: 'other' },
    color: { type: String, match: HEX_COLOR, default: '#607d8b' },
    // True for categories created from the default set; they can still be renamed, archived or deleted.
    isDefault: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Names are unique per user and type, ignoring case ("Salary" income vs "salary" income clash).
categorySchema.index({ userId: 1, type: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

export type Category = InferSchemaType<typeof categorySchema>;
export type CategoryDocument = HydratedDocument<Category>;

export const CategoryModel = model('Category', categorySchema);
