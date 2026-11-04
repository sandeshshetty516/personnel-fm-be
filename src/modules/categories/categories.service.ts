import mongoose, { Types } from 'mongoose';
import { AppError } from '../../common/errors';
import { TransactionModel } from '../transactions/transaction.model';
import { UserModel } from '../users/user.model';
import type { CategoryResponse, CreateCategoryInput, UpdateCategoryInput } from './categories.schemas';
import { CategoryModel, type CategoryDocument, type CategoryType } from './category.model';
import { DEFAULT_CATEGORIES } from './defaultCategories';

function toResponse(category: CategoryDocument): CategoryResponse {
  return {
    id: category._id.toString(),
    name: category.name,
    type: category.type,
    icon: category.icon,
    color: category.color,
    isDefault: category.isDefault,
    isArchived: category.isArchived,
    createdAt: category.createdAt.toISOString(),
  };
}

function duplicateNameGuard(err: unknown): never {
  if ((err as { code?: number }).code === 11000) {
    throw AppError.conflict('A category with this name already exists for this type');
  }
  throw err;
}

/**
 * Copies the default categories to a user exactly once. Safe to call repeatedly and concurrently:
 * the user flag is claimed atomically, and the unique index absorbs any name collisions.
 */
export async function ensureDefaultCategories(userId: string): Promise<void> {
  const claimed = await UserModel.updateOne(
    { _id: userId, defaultCategoriesSeededAt: { $exists: false } },
    { $set: { defaultCategoriesSeededAt: new Date() } },
  );
  if (claimed.modifiedCount === 0) return;

  const docs = DEFAULT_CATEGORIES.map((c) => ({ ...c, userId, isDefault: true }));
  await CategoryModel.insertMany(docs, { ordered: false }).catch((err: { code?: number }) => {
    if (err.code !== 11000) throw err;
  });
}

/** Loads a category only if it belongs to the user; other users' ids look like missing ones (AC-03). */
export async function findOwnedCategory(userId: string, categoryId: string): Promise<CategoryDocument> {
  const category = await CategoryModel.findOne({ _id: categoryId, userId });
  if (!category) throw AppError.notFound('Category not found');
  return category;
}

export async function listCategories(
  userId: string,
  filters: { type?: CategoryType; includeArchived?: boolean },
): Promise<CategoryResponse[]> {
  await ensureDefaultCategories(userId);
  const categories = await CategoryModel.find({
    userId,
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.includeArchived ? {} : { isArchived: false }),
  })
    .collation({ locale: 'en', strength: 2 })
    .sort({ type: 1, isArchived: 1, name: 1 });
  return categories.map(toResponse);
}

export async function createCategory(userId: string, input: CreateCategoryInput): Promise<CategoryResponse> {
  const category = await CategoryModel.create({ ...input, userId }).catch(duplicateNameGuard);
  return toResponse(category);
}

export async function updateCategory(
  userId: string,
  categoryId: string,
  input: UpdateCategoryInput,
): Promise<CategoryResponse> {
  const category = await findOwnedCategory(userId, categoryId);
  category.set(input);
  await category.save().catch(duplicateNameGuard);
  return toResponse(category);
}

/**
 * Deletes a category (FR-020). A category still referenced by transactions is only deleted when
 * `reassignTo` names another active category of the same type; its transactions are moved there
 * and the category removed in one database transaction. Otherwise the caller is told to reassign or archive.
 */
export async function deleteCategory(
  userId: string,
  categoryId: string,
  reassignTo?: string,
): Promise<{ deleted: true; reassignedTransactions: number }> {
  const category = await findOwnedCategory(userId, categoryId);
  const owner = new Types.ObjectId(userId);
  const usage = await TransactionModel.countDocuments({ userId: owner, categoryId: category._id });

  if (usage > 0 && !reassignTo) {
    throw AppError.conflict(
      `This category is used by ${usage} transaction${usage === 1 ? '' : 's'}. Reassign them to another category or archive it instead.`,
      { reason: 'CATEGORY_IN_USE', transactionCount: usage },
    );
  }

  if (!reassignTo || usage === 0) {
    await category.deleteOne();
    return { deleted: true, reassignedTransactions: 0 };
  }

  if (reassignTo === categoryId) throw AppError.badRequest('Choose a different category to reassign to');
  const target = await findOwnedCategory(userId, reassignTo);
  if (target.type !== category.type) {
    throw AppError.badRequest(`Transactions can only move to another ${category.type.toLowerCase()} category`);
  }
  if (target.isArchived) throw AppError.badRequest('Cannot reassign transactions to an archived category');

  let moved = 0;
  await mongoose.connection.transaction(async (session) => {
    const result = await TransactionModel.updateMany(
      { userId: owner, categoryId: category._id },
      { $set: { categoryId: target._id } },
      { session },
    );
    moved = result.modifiedCount;
    await CategoryModel.deleteOne({ _id: category._id, userId: owner }, { session });
  });
  return { deleted: true, reassignedTransactions: moved };
}
