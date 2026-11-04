import { z } from 'zod';
import { idParamsSchema } from '../../common/schemas';
import {
  errorResponseSchema,
  errorResponses,
  json,
  protectedMutation,
  protectedRead,
  registry,
  successResponse,
} from '../../docs/openapi';
import {
  categorySchema,
  createCategorySchema,
  deleteCategoryQuerySchema,
  listCategoriesQuerySchema,
  updateCategorySchema,
} from './categories.schemas';

const categoryData = successResponse(z.object({ category: categorySchema }));
const body = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const { 400: badRequest, 401: unauthorized, 403: csrfInvalid } = errorResponses;
const notFound = json('Category not found (or owned by another user)', errorResponseSchema);
const duplicate = json('A category with this name already exists for this type', errorResponseSchema);

registry.registerPath({
  method: 'get',
  path: '/categories',
  tags: ['Categories'],
  summary: 'List categories (default set is created on first use)',
  security: protectedRead,
  request: { query: listCategoriesQuerySchema },
  responses: {
    200: json('Categories', successResponse(z.object({ categories: z.array(categorySchema) }))),
    401: unauthorized,
  },
});

registry.registerPath({
  method: 'post',
  path: '/categories',
  tags: ['Categories'],
  summary: 'Create a custom category',
  security: protectedMutation,
  request: { body: body(createCategorySchema) },
  responses: {
    201: json('Created', categoryData),
    400: badRequest,
    401: unauthorized,
    403: csrfInvalid,
    409: duplicate,
  },
});

registry.registerPath({
  method: 'patch',
  path: '/categories/{id}',
  tags: ['Categories'],
  summary: 'Rename, restyle, archive or unarchive a category',
  security: protectedMutation,
  request: { params: idParamsSchema, body: body(updateCategorySchema) },
  responses: {
    200: json('Updated', categoryData),
    400: badRequest,
    401: unauthorized,
    403: csrfInvalid,
    404: notFound,
    409: duplicate,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/categories/{id}',
  tags: ['Categories'],
  summary: 'Delete a category',
  description:
    'Fails with 409 (details.reason = CATEGORY_IN_USE) while transactions reference it, unless reassignTo names ' +
    'another active category of the same type.',
  security: protectedMutation,
  request: { params: idParamsSchema, query: deleteCategoryQuerySchema },
  responses: {
    200: json(
      'Deleted',
      successResponse(z.object({ deleted: z.literal(true), reassignedTransactions: z.number().int() })),
    ),
    400: badRequest,
    401: unauthorized,
    403: csrfInvalid,
    404: notFound,
    409: json('Category is used by transactions', errorResponseSchema),
  },
});
