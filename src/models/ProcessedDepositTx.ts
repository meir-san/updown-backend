import mongoose, { Schema, Document } from 'mongoose';

export interface IProcessedDepositTx extends Document {
  txHash: string;
  createdAt: Date;
}

const ProcessedDepositTxSchema = new Schema<IProcessedDepositTx>(
  {
    txHash: { type: String, required: true, unique: true, lowercase: true, index: true },
  },
  { timestamps: true }
);

export const ProcessedDepositTxModel = mongoose.model<IProcessedDepositTx>(
  'ProcessedDepositTx',
  ProcessedDepositTxSchema
);
