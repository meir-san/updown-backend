import mongoose from 'mongoose';
import { config } from './config';

export async function connectDb(): Promise<void> {
  try {
    await mongoose.connect(config.mongoUri);
    console.log(`[DB] Connected to MongoDB at ${config.mongoUri}`);
  } catch (err) {
    console.error('[DB] Failed to connect:', err);
    process.exit(1);
  }

  mongoose.connection.on('error', (err) => {
    console.error('[DB] Connection error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('[DB] Disconnected from MongoDB');
  });
}
