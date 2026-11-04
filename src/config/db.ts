import mongoose from 'mongoose';
import { logger } from '../common/logger';

mongoose.set('strictQuery', true);

export async function connectDatabase(uri: string): Promise<void> {
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB connection error'));

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
  // Wait for every model's indexes before serving traffic: unique indexes enforce rules such as
  // one account name per user, and an index build running mid-transaction aborts the transaction.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  logger.info({ db: mongoose.connection.name }, 'MongoDB connected');
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === mongoose.ConnectionStates.connected;
}
