import { createApp } from './app';
import { logger } from './common/logger';
import { connectDatabase, disconnectDatabase } from './config/db';
import { env } from './config/env';

async function main() {
  await connectDatabase(env.MONGO_URI);

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`MyFinance API listening on http://localhost:${env.PORT} (docs at /api/docs)`);
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    // Force exit if connections do not drain in time.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  process.exit(1);
});

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
