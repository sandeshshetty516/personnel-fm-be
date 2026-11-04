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
  createDebtEntrySchema,
  createDebtSchema,
  debtEntryParamsSchema,
  debtEntrySchema,
  debtSchema,
  debtSummarySchema,
  listDebtsQuerySchema,
  updateDebtSchema,
} from './debts.schemas';

const debtData = successResponse(z.object({ debt: debtSchema }));
const debtWithEntry = successResponse(z.object({ debt: debtSchema, entry: debtEntrySchema }));
const body = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const { 400: badRequest, 401: unauthorized, 403: csrfInvalid } = errorResponses;
const notFound = json('Record not found (or owned by another user)', errorResponseSchema);
const tags = ['Lend & borrow'];
const cashNote =
  'With an accountId the entry also creates a DEBT_OUT/DEBT_IN transaction that moves the balance; ' +
  'these are never counted as income or expense.';

registry.registerPath({
  method: 'get',
  path: '/debts',
  tags,
  summary: 'List money lent and borrowed',
  security: protectedRead,
  request: { query: listDebtsQuerySchema },
  responses: { 200: json('Records', successResponse(z.object({ debts: z.array(debtSchema) }))), 401: unauthorized },
});

registry.registerPath({
  method: 'post',
  path: '/debts',
  tags,
  summary: 'Record money lent to, or borrowed from, a person',
  description: cashNote,
  security: protectedMutation,
  request: { body: body(createDebtSchema) },
  responses: { 201: json('Created', debtWithEntry), 400: badRequest, 401: unauthorized, 403: csrfInvalid },
});

registry.registerPath({
  method: 'get',
  path: '/debts/summary',
  tags,
  summary: 'Totals receivable and payable per currency, with a per-person breakdown',
  security: protectedRead,
  responses: {
    200: json('Summary', successResponse(z.object({ summaries: z.array(debtSummarySchema) }))),
    401: unauthorized,
  },
});

registry.registerPath({
  method: 'get',
  path: '/debts/{id}',
  tags,
  summary: 'Get a lend/borrow record',
  security: protectedRead,
  request: { params: idParamsSchema },
  responses: { 200: json('Record', debtData), 401: unauthorized, 404: notFound },
});

registry.registerPath({
  method: 'patch',
  path: '/debts/{id}',
  tags,
  summary: 'Edit the person, due date or notes',
  security: protectedMutation,
  request: { params: idParamsSchema, body: body(updateDebtSchema) },
  responses: { 200: json('Updated', debtData), 400: badRequest, 401: unauthorized, 403: csrfInvalid, 404: notFound },
});

registry.registerPath({
  method: 'delete',
  path: '/debts/{id}',
  tags,
  summary: 'Delete a record with all of its entries and transactions',
  security: protectedMutation,
  request: { params: idParamsSchema },
  responses: {
    200: json('Deleted', successResponse(z.object({ deletedTransactionCount: z.number().int() }))),
    401: unauthorized,
    403: csrfInvalid,
    404: notFound,
  },
});

registry.registerPath({
  method: 'get',
  path: '/debts/{id}/entries',
  tags,
  summary: 'Entry history, newest first',
  security: protectedRead,
  request: { params: idParamsSchema },
  responses: {
    200: json('Entries', successResponse(z.object({ entries: z.array(debtEntrySchema) }))),
    401: unauthorized,
    404: notFound,
  },
});

registry.registerPath({
  method: 'post',
  path: '/debts/{id}/entries',
  tags,
  summary: 'Add a further amount, a repayment or a write-off',
  description:
    `${cashNote} Repayments and write-offs cannot exceed the amount outstanding. ` +
    'A WRITE_OFF (lent money only) books a Bad Debt expense without moving any balance.',
  security: protectedMutation,
  request: { params: idParamsSchema, body: body(createDebtEntrySchema) },
  responses: {
    201: json('Recorded', debtWithEntry),
    400: badRequest,
    401: unauthorized,
    403: csrfInvalid,
    404: notFound,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/debts/{id}/entries/{entryId}',
  tags,
  summary: 'Remove a mistaken entry and its transaction',
  security: protectedMutation,
  request: { params: debtEntryParamsSchema },
  responses: { 200: json('Removed', debtData), 400: badRequest, 401: unauthorized, 403: csrfInvalid, 404: notFound },
});
