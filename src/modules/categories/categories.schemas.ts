import { z } from 'zod';
import { booleanQuerySchema, objectIdSchema } from '../../common/schemas';
import { CATEGORY_ICONS, CATEGORY_TYPES, HEX_COLOR } from './category.model';

const nameSchema = z.string().trim().min(1, 'Category name is required').max(40);
const colorSchema = z.string().regex(HEX_COLOR, 'Use a hex colour like #1f6f5c').openapi({ example: '#1f6f5c' });

export const categorySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.enum(CATEGORY_TYPES),
    icon: z.enum(CATEGORY_ICONS),
    color: z.string(),
    isDefault: z.boolean(),
    isArchived: z.boolean(),
    createdAt: z.string().openapi({ format: 'date-time' }),
  })
  .openapi('Category');

export const createCategorySchema = z
  .object({
    name: nameSchema,
    type: z.enum(CATEGORY_TYPES),
    icon: z.enum(CATEGORY_ICONS).default('other'),
    color: colorSchema.default('#607d8b'),
  })
  .strict()
  .openapi('CreateCategoryRequest');

// The type cannot change after creation: existing transactions depend on it.
export const updateCategorySchema = z
  .object({
    name: nameSchema,
    icon: z.enum(CATEGORY_ICONS),
    color: colorSchema,
    isArchived: z.boolean(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update')
  .openapi('UpdateCategoryRequest');

export const listCategoriesQuerySchema = z.object({
  type: z.enum(CATEGORY_TYPES).optional(),
  includeArchived: booleanQuerySchema,
});

export const deleteCategoryQuerySchema = z.object({
  reassignTo: objectIdSchema
    .optional()
    .openapi({ description: 'Move this category’s transactions to another category of the same type, then delete' }),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CategoryResponse = z.infer<typeof categorySchema>;
