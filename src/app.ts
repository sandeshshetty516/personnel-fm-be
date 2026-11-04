import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { AppError } from './common/errors';
import { logger } from './common/logger';
import { env, isProduction } from './config/env';
import { generateOpenApiDocument } from './docs/openapi';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';

export function createApp() {
  const app = express();

  // Render/AWS terminate TLS at a proxy; needed for secure cookies and correct client IPs in rate limiting.
  if (isProduction) app.set('trust proxy', 1);

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      // Strict allowlist; credentials are required for HttpOnly cookie auth across origins.
      origin(origin, callback) {
        if (!origin || env.CORS_ORIGINS.includes(origin)) return callback(null, true);
        callback(AppError.forbidden('Origin not allowed by CORS'));
      },
      credentials: true,
    }),
  );
  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, _res, next) =>
        next(new AppError(429, 'TOO_MANY_REQUESTS', 'Too many requests, please try again later')),
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/v1/health' } }));

  const openApiDocument = generateOpenApiDocument();
  app.get('/api/docs.json', (_req, res) => res.json(openApiDocument));
  // Swagger UI needs inline scripts, so relax Helmet's CSP for the docs route only.
  app.use('/api/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(openApiDocument));

  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
