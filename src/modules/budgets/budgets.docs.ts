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
  budgetDateQuerySchema,
  budgetSchema,
  budgetSummarySchema,
  createBudgetSchema,
  updateBudgetSchema,
} from './budgets.schemas';

const budgetData = successResponse(z.object({ budget: budgetSchema }));
const body = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const { 400: badRequest, 401: unauthorized, 403: csrfInvalid } = errorResponses;
const notFound = json('Budget not found (or owned by another user)', errorResponseSchema);
const tags = ['Budgets'];

registry.registerPath({
  method: 'get',
  path: '/budgets',
  tags,
  summary: 'List budgets with their utilisation for the period containing `date`',
  security: protectedRead,
  request: { query: budgetDateQuerySchema },
  responses: {
    200: json(
      'Budgets',
      successResponse(z.object({ budgets: z.array(z.object({ budget: budgetSchema, summary: budgetSummarySchema })) })),
    ),
    401: unauthorized,
  },
});

registry.registerPath({
  method: 'post',
  path: '/budgets',
  tags,
  summary: 'Create a monthly or custom-period budget with optional category limits',
  security: protectedMutation,
  request: { body: body(createBudgetSchema) },
  responses: { 201: json('Created', budgetData), 400: badRequest, 401: unauthorized, 403: csrfInvalid, 404: notFound },
});

registry.registerPath({
  method: 'get',
  path: '/budgets/{id}',
  tags,
  summary: 'Get a budget',
  security: protectedRead,
  request: { params: idParamsSchema },
  responses: { 200: json('Budget', budgetData), 401: unauthorized, 404: notFound },
});

registry.registerPath({
  method: 'get',
  path: '/budgets/{id}/summary',
  tags,
  summary: 'Planned vs actual: spent, remaining, utilisation and reached alert thresholds',
  description:
    'Eligible expenses are EXPENSE transactions in the period from accounts in the budget currency. ' +
    'Transfers and savings-goal contributions never count.',
  security: protectedRead,
  request: { params: idParamsSchema, query: budgetDateQuerySchema },
  responses: {
    200: json('Summary', successResponse(z.object({ summary: budgetSummarySchema }))),
    401: unauthorized,
    404: notFound,
  },
});

registry.registerPath({
  method: 'patch',
  path: '/budgets/{id}',
  tags,
  summary: 'Update a budget',
  security: protectedMutation,
  request: { params: idParamsSchema, body: body(updateBudgetSchema) },
  responses: { 200: json('Updated', budgetData), 400: badRequest, 401: unauthorized, 403: csrfInvalid, 404: notFound },
});

registry.registerPath({
  method: 'delete',
  path: '/budgets/{id}',
  tags,
  summary: 'Delete a budget (transactions are unaffected)',
  security: protectedMutation,
  request: { params: idParamsSchema },
  responses: {
    200: json('Deleted', successResponse(z.object({ deleted: z.literal(true) }))),
    401: unauthorized,
    403: csrfInvalid,
    404: notFound,
  },
});
