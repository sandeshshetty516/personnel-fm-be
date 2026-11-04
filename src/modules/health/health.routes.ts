import { Router } from 'express';
import { z } from 'zod';
import { sendSuccess } from '../../common/response';
import { isDatabaseConnected } from '../../config/db';
import { errorResponseSchema, registry, successResponse } from '../../docs/openapi';

const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  database: z.enum(['connected', 'disconnected']),
  uptimeSeconds: z.number(),
  timestamp: z.string().openapi({ format: 'date-time' }),
});

registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['Health'],
  summary: 'Liveness and database connectivity check',
  responses: {
    200: {
      description: 'Service and database are healthy',
      content: { 'application/json': { schema: successResponse(healthSchema) } },
    },
    503: {
      description: 'Database is unreachable',
      content: { 'application/json': { schema: successResponse(healthSchema) } },
    },
    500: { description: 'Unexpected error', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  const connected = isDatabaseConnected();
  const body: z.infer<typeof healthSchema> = {
    status: connected ? 'ok' : 'degraded',
    database: connected ? 'connected' : 'disconnected',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
  sendSuccess(res, body, connected ? 200 : 503);
});
