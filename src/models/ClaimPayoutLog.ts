import mongoose, { Schema, Document } from 'mongoose';

/** Prevents double-crediting the same wallet when claim distribution is retried after a partial run. */
export interface IClaimPayoutLog extends Document {
  market: string;
  wallet: string;
  amount: string;
  createdAt: Date;
}

const ClaimPayoutLogSchema = new Schema<IClaimPayoutLog>(
  {
    market: { type: String, required: true, lowercase: true },
    wallet: { type: String, required: true, lowercase: true },
    amount: { type: String, required: true },
  },
  { timestamps: true }
);

ClaimPayoutLogSchema.index({ market: 1, wallet: 1 }, { unique: true });

export const ClaimPayoutLogModel = mongoose.model<IClaimPayoutLog>('ClaimPayoutLog', ClaimPayoutLogSchema);
