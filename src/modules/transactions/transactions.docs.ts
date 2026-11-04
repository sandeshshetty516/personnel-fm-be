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
  createTransactionSchema,
  createTransferSchema,
  listQueryFields,
  summarySchema,
  transactionFilterFields,
  transactionSchema,
  updateTransactionSchema,
} from './transactions.schemas';

const transactionData = successResponse(z.object({ transaction: transactionSchema }));
const body = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const { 400: badRequest, 401: unauthorized, 403: csrfInvalid } = errorResponses;
const notFound = json('Not found (or owned by another user)', errorResponseSchema);

const pageMeta = z.object({
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

registry.registerPath({
  method: 'get',
  path: '/transactions',
  tags: ['Transactions'],
  summary: 'Search, filter, sort and paginate transactions',
  description:
    'Without accountId a transfer appears once (its TRANSFER_OUT leg, with counterpartAccountId as the destination). ' +
    'With accountId, that account’s leg is returned.',
  security: protectedRead,
  request: { query: listQueryFields },
  responses: {
    200: json(
      'Page of transactions',
      successResponse(z.object({ transactions: z.array(transactionSchema) })).extend({ meta: pageMeta }),
    ),
    400: badRequest,
    401: unauthorized,
  },
});

registry.registerPath({
  method: 'get',
  path: '/transactions/summary',
  tags: ['Transactions'],
  summary: 'Income, expense and net totals for the same filters as the list',
  description: 'One row per account currency. Transfers are never counted as income or expense.',
  security: protectedRead,
  request: { query: transactionFilterFields },
  responses: {
    200: json('Totals', successResponse(z.object({ summaries: z.array(summarySchema) }))),
    400: badRequest,
    401: unauthorized,
  },
});

registry.registerPath({
  method: 'post',
  path: '/transactions',
  tags: ['Transactions'],
  summary: 'Record income or an expense',
  description: 'The account must be active and the category must match the type and not be archived.',
  security: protectedMutation,
  request: { body: body(createTransactionSchema) },
  responses: {
    201: json('Created', transactionData),
    400: badRequest,
    401: unauthorized,
    403: csrfInvalid,
    404: notFound,
  },
});

registry.registerPath({
  method: 'get',
  path: '/transactions/{id}',
  tags: ['Transactions'],
  summary: 'Get one transaction',
  security: protectedRead,
  request: { params: idParamsSchema },
  responses: { 200: json('Transaction', transactionData), 401: unauthorized, 404: notFound },
});

registry.registerPath({
  method: 'patch',
  path: '/transactions/{id}',
  tags: ['Transactions'],
  summary: 'Edit a transaction (balances and totals reflect it immediately)',
  security: protectedMutation,
  request: { params: idParamsSchema, body: body(updateTransactionSchema) },
  responses: {
    200: json('Updated', transactionData),
    400: badRequest,
    401: unauthorized,
    403: csrfInvalid,
    404: notFound,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/transactions/{id}',
  tags: ['Transactions'],
  summary: 'Delete a transaction (deleting either transfer leg deletes both)',
  security: protectedMutation,
  request: { params: idParamsSchema },
  responses: {
    200: json('Deleted', successResponse(z.object({ deletedCount: z.number().int() }))),
    401: unauthorized,
    403: csrfInvalid,
    404: notFound,
  },
});

registry.registerPath({
  method: 'post',
  path: '/accounts/transfer',
  tags: ['Accounts'],
  summary: 'Transfer money between two of your accounts',
  description:
    'Creates linked TRANSFER_OUT and TRANSFER_IN legs atomically. Both accounts must be active and use the same ' +
    'currency. Transfers do not change income or expense totals.',
  security: protectedMutation,
  request: { body: body(createTransferSchema) },
  responses: {
    201: json(
      'Transfer created',
      successResponse(
        z.object({
          transfer: z.object({ transferGroupId: z.string(), outgoing: transactionSchema, incoming: transactionSchema }),
        }),
      ),
    ),
    400: badRequest,
    401: unauthorized,
    403: csrfInvalid,
    404: notFound,
  },
});
