import mongoose, { Schema, Document } from 'mongoose';

export interface IOrder extends Document {
  orderId: string;
  maker: string;
  market: string;
  option: number;
  side: number;
  type: number;
  price: number;
  amount: string;
  filledAmount: string;
  nonce: number;
  expiry: number;
  signature: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const OrderSchema = new Schema<IOrder>(
  {
    orderId: { type: String, required: true, unique: true, index: true },
    maker: { type: String, required: true, lowercase: true, index: true },
    market: { type: String, required: true, lowercase: true, index: true },
    option: { type: Number, required: true, enum: [1, 2] },
    side: { type: Number, required: true, enum: [0, 1] },
    type: { type: Number, required: true, enum: [0, 1] },
    price: { type: Number, required: true },
    amount: { type: String, required: true },
    filledAmount: { type: String, required: true, default: '0' },
    nonce: { type: Number, required: true },
    expiry: { type: Number, required: true },
    signature: { type: String, required: true },
    status: {
      type: String,
      required: true,
      enum: ['OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED'],
      default: 'OPEN',
      index: true,
    },
  },
  { timestamps: true }
);

OrderSchema.index({ market: 1, status: 1 });
OrderSchema.index({ maker: 1, nonce: 1 }, { unique: true });

export const OrderModel = mongoose.model<IOrder>('Order', OrderSchema);
