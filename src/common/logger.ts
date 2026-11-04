import pino from 'pino';
import { env, isProduction, isTest } from '../config/env';

export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  // Never log credentials or session material (NFR-010).
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
  transport: isProduction || isTest ? undefined : { target: 'pino-pretty', options: { colorize: true } },
});
