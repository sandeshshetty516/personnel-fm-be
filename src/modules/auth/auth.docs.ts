import { z } from 'zod';
import {
  csrfOnly,
  errorResponseSchema,
  errorResponses,
  json,
  protectedRead,
  registry,
  successResponse,
} from '../../docs/openapi';
import { publicUserSchema } from '../users/users.schemas';
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema } from './auth.schemas';

const userData = successResponse(z.object({ user: publicUserSchema }));
const messageData = successResponse(z.object({ message: z.string() }));
const body = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const { 400: badRequest, 401: unauthorized, 403: csrfInvalid, 429: rateLimited } = errorResponses;

registry.registerPath({
  method: 'get',
  path: '/auth/csrf',
  tags: ['Auth'],
  summary: 'Issue a CSRF token',
  description: 'Sets the mf_csrf cookie and returns the same value; send it as X-CSRF-Token on mutations.',
  responses: { 200: json('CSRF token', successResponse(z.object({ csrfToken: z.string() }))) },
});

registry.registerPath({
  method: 'post',
  path: '/auth/register',
  tags: ['Auth'],
  summary: 'Create an account and start a session',
  security: csrfOnly,
  request: { body: body(registerSchema) },
  responses: {
    201: json('Registered; auth cookies set', userData),
    400: badRequest,
    403: csrfInvalid,
    409: json('Email already registered', errorResponseSchema),
    429: rateLimited,
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/login',
  tags: ['Auth'],
  summary: 'Log in with email and password',
  security: csrfOnly,
  request: { body: body(loginSchema) },
  responses: {
    200: json('Logged in; auth cookies set', userData),
    400: badRequest,
    401: unauthorized,
    403: csrfInvalid,
    429: rateLimited,
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/refresh',
  tags: ['Auth'],
  summary: 'Rotate the refresh token and issue a new access token',
  description: 'Uses the mf_refresh cookie. Replaying an already-rotated token revokes the whole session family.',
  security: csrfOnly,
  responses: { 200: json('New auth cookies set', userData), 401: unauthorized, 403: csrfInvalid },
});

registry.registerPath({
  method: 'post',
  path: '/auth/logout',
  tags: ['Auth'],
  summary: 'Revoke the current session and clear auth cookies',
  security: csrfOnly,
  responses: { 200: json('Logged out', successResponse(z.object({ loggedOut: z.literal(true) }))), 403: csrfInvalid },
});

registry.registerPath({
  method: 'get',
  path: '/auth/me',
  tags: ['Auth'],
  summary: 'Get the authenticated user (session restoration)',
  security: protectedRead,
  responses: { 200: json('Current user', userData), 401: unauthorized },
});

registry.registerPath({
  method: 'post',
  path: '/auth/forgot-password',
  tags: ['Auth'],
  summary: 'Request a password reset link',
  description: 'Always returns 200, whether or not the email is registered.',
  security: csrfOnly,
  request: { body: body(forgotPasswordSchema) },
  responses: { 200: json('Reset requested', messageData), 400: badRequest, 403: csrfInvalid, 429: rateLimited },
});

registry.registerPath({
  method: 'post',
  path: '/auth/reset-password',
  tags: ['Auth'],
  summary: 'Set a new password using a reset token',
  description: 'Consumes the token and signs the user out of every session.',
  security: csrfOnly,
  request: { body: body(resetPasswordSchema) },
  responses: { 200: json('Password reset', messageData), 400: badRequest, 403: csrfInvalid, 429: rateLimited },
});
