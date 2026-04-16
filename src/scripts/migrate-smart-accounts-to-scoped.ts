/**
 * One-time cleanup: removes SmartAccount documents that predate the scoped-session schema
 * (missing sessionExpiry, sessionPermissionsContext, or sessionScope).
 * Old backend-generated custodial session keys cannot be migrated — users must POST /register again.
 */
import mongoose from 'mongoose';
import { connectDb } from '../db';
import { SmartAccountModel } from '../models/SmartAccount';

async function main(): Promise<void> {
  await connectDb();

  const filter = {
    $or: [
      { sessionExpiry: { $exists: false } },
      { sessionExpiry: null },
      { sessionPermissionsContext: { $exists: false } },
      { sessionPermissionsContext: null },
      { sessionScope: { $exists: false } },
      { sessionScope: null },
    ],
  };

  const docs = await SmartAccountModel.find(filter).select('ownerAddress').lean();
  for (const d of docs) {
    console.log(`[migrate-smart-accounts-to-scoped] Deleting SmartAccount ownerAddress=${d.ownerAddress}`);
  }

  const result = await SmartAccountModel.deleteMany(filter);
  console.log(`[migrate-smart-accounts-to-scoped] Deleted ${result.deletedCount} document(s).`);

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('[migrate-smart-accounts-to-scoped] Fatal:', err);
  process.exit(1);
});
