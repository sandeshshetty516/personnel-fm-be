import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AppError } from '../../common/errors';
import { env } from '../../config/env';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import * as controller from './auth.controller';
import { forgotPasswordSchema, loginSchema, registerSchema, resetPasswordSchema } from './auth.schemas';
import './auth.docs';

// Brute-force protection for endpoints that accept credentials or send reset links.
const credentialLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, _res, next) =>
    next(new AppError(429, 'TOO_MANY_REQUESTS', 'Too many attempts. Please wait a few minutes and try again.')),
});

export const authRouter = Router();

authRouter.get('/csrf', controller.getCsrfToken);
authRouter.post('/register', credentialLimiter, validate({ body: registerSchema }), controller.register);
authRouter.post('/login', credentialLimiter, validate({ body: loginSchema }), controller.login);
authRouter.post('/refresh', controller.refresh);
authRouter.post('/logout', controller.logout);
authRouter.get('/me', authenticate, controller.me);
authRouter.post(
  '/forgot-password',
  credentialLimiter,
  validate({ body: forgotPasswordSchema }),
  controller.forgotPassword,
);
authRouter.post(
  '/reset-password',
  credentialLimiter,
  validate({ body: resetPasswordSchema }),
  controller.resetPassword,
);
