import type { CategoryIcon, CategoryType } from './category.model';

interface DefaultCategory {
  name: string;
  type: CategoryType;
  icon: CategoryIcon;
  color: string;
}

/** Copied into each new user's account (FR-017), so users can rename, recolour or archive them freely. */
export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
  { type: 'INCOME', name: 'Salary', icon: 'salary', color: '#2e7d32' },
  { type: 'INCOME', name: 'Freelance', icon: 'freelance', color: '#00897b' },
  { type: 'INCOME', name: 'Business', icon: 'business', color: '#3949ab' },
  { type: 'INCOME', name: 'Interest', icon: 'interest', color: '#00838f' },
  { type: 'INCOME', name: 'Investments', icon: 'investment', color: '#6a1b9a' },
  { type: 'INCOME', name: 'Gifts', icon: 'gift', color: '#ad1457' },
  { type: 'INCOME', name: 'Refunds', icon: 'refund', color: '#558b2f' },
  { type: 'INCOME', name: 'Other Income', icon: 'other', color: '#546e7a' },

  { type: 'EXPENSE', name: 'Rent', icon: 'home', color: '#5d4037' },
  { type: 'EXPENSE', name: 'Groceries', icon: 'groceries', color: '#43a047' },
  { type: 'EXPENSE', name: 'Food & Dining', icon: 'dining', color: '#ef6c00' },
  { type: 'EXPENSE', name: 'Fuel', icon: 'fuel', color: '#c62828' },
  { type: 'EXPENSE', name: 'Transport', icon: 'transport', color: '#1565c0' },
  { type: 'EXPENSE', name: 'Utilities', icon: 'utilities', color: '#f9a825' },
  { type: 'EXPENSE', name: 'Mobile & Internet', icon: 'phone', color: '#0277bd' },
  { type: 'EXPENSE', name: 'Shopping', icon: 'shopping', color: '#d81b60' },
  { type: 'EXPENSE', name: 'Healthcare', icon: 'health', color: '#e53935' },
  { type: 'EXPENSE', name: 'Education', icon: 'education', color: '#3949ab' },
  { type: 'EXPENSE', name: 'Entertainment', icon: 'entertainment', color: '#8e24aa' },
  { type: 'EXPENSE', name: 'Travel', icon: 'travel', color: '#00acc1' },
  { type: 'EXPENSE', name: 'Insurance', icon: 'insurance', color: '#455a64' },
  { type: 'EXPENSE', name: 'EMI & Loans', icon: 'loan', color: '#6d4c41' },
  { type: 'EXPENSE', name: 'Personal Care', icon: 'personal-care', color: '#ec407a' },
  { type: 'EXPENSE', name: 'Subscriptions', icon: 'subscriptions', color: '#7e57c2' },
  { type: 'EXPENSE', name: 'Other Expense', icon: 'other', color: '#78909c' },
];
