import { logger } from '../../common/logger';

/**
 * Delivers password-reset links. The POC has no email provider, so the link is logged;
 * swap this implementation for a mailer (e.g. Nodemailer/SES) without touching the auth service.
 */
export const passwordResetNotifier = {
  async send(email: string, resetUrl: string): Promise<void> {
    logger.warn({ email, resetUrl }, 'Password reset requested (no mailer configured; link logged instead)');
  },
};
