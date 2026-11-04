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
import { accountSchema, createAccountSchema, listAccountsQuerySchema, updateAccountSchema } from './accounts.schemas';

const accountData = successResponse(z.object({ account: accountSchema }));
const body = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const { 400: badRequest, 401: unauthorized, 403: csrfInvalid } = errorResponses;
const notFound = json('Account not found (or owned by another user)', errorResponseSchema);
const duplicate = json('An account with this name already exists', errorResponseSchema);

registry.registerPath({
  method: 'get',
  path: '/accounts',
  tags: ['Accounts'],
  summary: 'List accounts with current balances',
  security: protectedRead,
  request: { query: listAccountsQuerySchema },
  responses: {
    200: json('Accounts', successResponse(z.object({ accounts: z.array(accountSchema) }))),
    401: unauthorized,
  },
});

registry.registerPath({
  method: 'post',
  path: '/accounts',
  tags: ['Accounts'],
  summary: 'Create an account',
  security: protectedMutation,
  request: { body: body(createAccountSchema) },
  responses: {
    201: json('Created', accountData),
    400: badRequest,
    401: unauthorized,
    403: csrfInvalid,
    409: duplicate,
  },
});

registry.registerPath({
  method: 'get',
  path: '/accounts/{id}',
  tags: ['Accounts'],
  summary: 'Get one account with its current balance',
  security: protectedRead,
  request: { params: idParamsSchema },
  responses: { 200: json('Account', accountData), 401: unauthorized, 404: notFound },
});

registry.registerPath({
  method: 'patch',
  path: '/accounts/{id}',
  tags: ['Accounts'],
  summary: 'Update an account (or reactivate it with isActive: true)',
  security: protectedMutation,
  request: { params: idParamsSchema, body: body(updateAccountSchema) },
  responses: {
    200: json('Updated', accountData),
    400: badRequest,
    401: unauthorized,
    403: csrfInvalid,
    404: notFound,
    409: duplicate,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/accounts/{id}',
  tags: ['Accounts'],
  summary: 'Deactivate an account',
  description: 'Accounts are never hard-deleted; their transactions stay in history and reports.',
  security: protectedMutation,
  request: { params: idParamsSchema },
  responses: { 200: json('Deactivated', accountData), 401: unauthorized, 403: csrfInvalid, 404: notFound },
});
