import mongoose, { Schema, Document } from 'mongoose';

export interface ITrade extends Document {
  tradeId: string;
  market: string;
  option: number;
  buyOrderId: string;
  sellOrderId: string;
  buyer: string;
  seller: string;
  price: number;
  amount: string;
  platformFee: string;
  makerFee: string;
  settlementTxHash: string | null;
  settlementStatus: string;
  settlementRetryCount: number;
  settlementNextRetryAt: Date | null;
  createdAt: Date;
}

const TradeSchema = new Schema<ITrade>(
  {
    tradeId: { type: String, required: true, unique: true, index: true },
    market: { type: String, required: true, lowercase: true, index: true },
    option: { type: Number, required: true, enum: [1, 2] },
    buyOrderId: { type: String, required: true, index: true },
    sellOrderId: { type: String, required: true, index: true },
    buyer: { type: String, required: true, lowercase: true, index: true },
    seller: { type: String, required: true, lowercase: true, index: true },
    price: { type: Number, required: true },
    amount: { type: String, required: true },
    platformFee: { type: String, required: true, default: '0' },
    makerFee: { type: String, required: true, default: '0' },
    settlementTxHash: { type: String, default: null },
    settlementStatus: {
      type: String,
      enum: ['PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED'],
      default: 'PENDING',
    },
    settlementRetryCount: { type: Number, default: 0 },
    settlementNextRetryAt: { type: Date, default: null },
  },
  { timestamps: true }
);

TradeSchema.index({ market: 1, buyer: 1 });
TradeSchema.index({ market: 1, seller: 1 });
TradeSchema.index({ settlementStatus: 1 });

export const TradeModel = mongoose.model<ITrade>('Trade', TradeSchema);
