import { OpenAPIRegistry, OpenApiGeneratorV31, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

/**
 * Single registry shared by all modules. Each module registers its paths
 * from the same Zod schemas it validates with, so docs cannot drift from behaviour.
 */
export const registry = new OpenAPIRegistry();

export const errorResponseSchema = registry.register(
  'ErrorResponse',
  z.object({
    success: z.literal(false),
    error: z.object({
      code: z.string().openapi({ example: 'VALIDATION_ERROR' }),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  }),
);

/** Wraps a data schema in the standard success envelope. */
export function successResponse<T extends z.ZodType>(data: T) {
  return z.object({ success: z.literal(true), data });
}

export const cookieAuth = registry.registerComponent('securitySchemes', 'cookieAuth', {
  type: 'apiKey',
  in: 'cookie',
  name: 'mf_access',
  description: 'HttpOnly access-token cookie set by /auth/login, /auth/register and /auth/refresh.',
});

export const csrfHeader = registry.registerComponent('securitySchemes', 'csrfHeader', {
  type: 'apiKey',
  in: 'header',
  name: 'X-CSRF-Token',
  description: 'Required on every POST/PUT/PATCH/DELETE. Obtain the value from GET /auth/csrf.',
});

/** Security requirement for protected, state-changing endpoints. */
export const protectedMutation = [{ [cookieAuth.name]: [], [csrfHeader.name]: [] }];
export const protectedRead = [{ [cookieAuth.name]: [] }];
export const csrfOnly = [{ [csrfHeader.name]: [] }];

export function json<T extends z.ZodType>(description: string, schema: T) {
  return { description, content: { 'application/json': { schema } } };
}

export const errorResponses = {
  400: json('Validation failed', errorResponseSchema),
  401: json('Not authenticated', errorResponseSchema),
  403: json('Missing or invalid CSRF token', errorResponseSchema),
  429: json('Rate limited', errorResponseSchema),
};

export function generateOpenApiDocument() {
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'MyFinance API',
      version: '1.0.0',
      description: 'Personal monthly finance management POC. All amounts are integer paise (₹1 = 100 paise).',
    },
    servers: [{ url: '/api/v1' }],
  });
}
