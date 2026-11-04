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
  contributionParamsSchema,
  contributionSchema,
  createContributionSchema,
  createGoalSchema,
  goalSchema,
  listGoalsQuerySchema,
  updateGoalSchema,
} from './savings.schemas';

const goalData = successResponse(z.object({ goal: goalSchema }));
const body = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const { 400: badRequest, 401: unauthorized, 403: csrfInvalid } = errorResponses;
const notFound = json('Goal not found (or owned by another user)', errorResponseSchema);
const tags = ['Savings goals'];
const earmarkNote =
  'Contributions earmark money for a goal; they never create transactions, so they are never counted as expenses.';

registry.registerPath({
  method: 'get',
  path: '/savings-goals',
  tags,
  summary: 'List savings goals with progress',
  security: protectedRead,
  request: { query: listGoalsQuerySchema },
  responses: { 200: json('Goals', successResponse(z.object({ goals: z.array(goalSchema) }))), 401: unauthorized },
});

registry.registerPath({
  method: 'post',
  path: '/savings-goals',
  tags,
  summary: 'Create a savings goal',
  security: protectedMutation,
  request: { body: body(createGoalSchema) },
  responses: { 201: json('Created', goalData), 400: badRequest, 401: unauthorized, 403: csrfInvalid },
});

registry.registerPath({
  method: 'get',
  path: '/savings-goals/{id}',
  tags,
  summary: 'Get a savings goal',
  security: protectedRead,
  request: { params: idParamsSchema },
  responses: { 200: json('Goal', goalData), 401: unauthorized, 404: notFound },
});

registry.registerPath({
  method: 'patch',
  path: '/savings-goals/{id}',
  tags,
  summary: 'Edit, complete, archive or reactivate a goal',
  security: protectedMutation,
  request: { params: idParamsSchema, body: body(updateGoalSchema) },
  responses: { 200: json('Updated', goalData), 400: badRequest, 401: unauthorized, 403: csrfInvalid, 404: notFound },
});

registry.registerPath({
  method: 'post',
  path: '/savings-goals/{id}/contributions',
  tags,
  summary: 'Add money to, or withdraw money from, a goal',
  description: `${earmarkNote} Withdrawals cannot exceed the saved amount.`,
  security: protectedMutation,
  request: { params: idParamsSchema, body: body(createContributionSchema) },
  responses: {
    201: json('Recorded', successResponse(z.object({ goal: goalSchema, contribution: contributionSchema }))),
    400: badRequest,
    401: unauthorized,
    403: csrfInvalid,
    404: notFound,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/savings-goals/{id}/contributions/{contributionId}',
  tags,
  summary: 'Remove a mistaken contribution or withdrawal',
  security: protectedMutation,
  request: { params: contributionParamsSchema },
  responses: { 200: json('Removed', goalData), 400: badRequest, 401: unauthorized, 403: csrfInvalid, 404: notFound },
});

registry.registerPath({
  method: 'get',
  path: '/savings-goals/{id}/history',
  tags,
  summary: 'Contribution and withdrawal history, newest first',
  security: protectedRead,
  request: { params: idParamsSchema },
  responses: {
    200: json('History', successResponse(z.object({ contributions: z.array(contributionSchema) }))),
    401: unauthorized,
    404: notFound,
  },
});
