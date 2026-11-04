import { z } from 'zod';
import { errorResponses, json, protectedMutation, protectedRead, registry, successResponse } from '../../docs/openapi';
import { changePasswordSchema, publicUserSchema, updateProfileSchema } from './users.schemas';

const userData = successResponse(z.object({ user: publicUserSchema }));
const { 400: badRequest, 401: unauthorized, 403: csrfInvalid } = errorResponses;

registry.registerPath({
  method: 'get',
  path: '/users/me',
  tags: ['Users'],
  summary: 'Get profile and preferences',
  security: protectedRead,
  responses: { 200: json('Profile', userData), 401: unauthorized },
});

registry.registerPath({
  method: 'patch',
  path: '/users/me',
  tags: ['Users'],
  summary: 'Update profile, currency, financial month start day, time zone or notification preferences',
  security: protectedMutation,
  request: { body: { content: { 'application/json': { schema: updateProfileSchema } } } },
  responses: { 200: json('Updated profile', userData), 400: badRequest, 401: unauthorized, 403: csrfInvalid },
});

registry.registerPath({
  method: 'post',
  path: '/users/me/change-password',
  tags: ['Users'],
  summary: 'Change password (signs out other sessions)',
  security: protectedMutation,
  request: { body: { content: { 'application/json': { schema: changePasswordSchema } } } },
  responses: {
    200: json('Password changed', successResponse(z.object({ message: z.string() }))),
    400: badRequest,
    401: unauthorized,
    403: csrfInvalid,
  },
});
