import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../src/config/db';

/** Each test file gets its own database on the shared in-memory replica set. */
export async function connectTestDatabase() {
  const uri = new URL(process.env.MONGO_URI as string);
  uri.pathname = `/test-${process.pid}-${Date.now()}`;
  await connectDatabase(uri.toString());
}

export async function closeTestDatabase() {
  await mongoose.connection.dropDatabase();
  await disconnectDatabase();
}
