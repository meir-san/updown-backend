import mongoose, { Schema, Document } from 'mongoose';

export interface IMarket extends Document {
  address: string;
  /** Legacy display field; prefer `pairSymbol`. */
  pairId: string;
  /** Stable API label: `BTC-USD` | `ETH-USD`. */
  pairSymbol?: string;
  /** `keccak256(utf8("BTC/USD"))` etc., 0x-prefixed lowercase. */
  pairIdHex?: string;
  startTime: number;
  endTime: number;
  duration: number;
  status: string;
  winner: number | null;
  upPrice: string;
  downPrice: string;
  /** Chainlink strike at registration (int256 as string, pool token decimals). */
  strikePrice: string;
  volume: string;
  claimedByRelayer: boolean;
  /** All MongoDB winnings from this claim have been credited (idempotent with claimedByRelayer). */
  claimDistributionComplete: boolean;
  /** Rounding dust from proportional payouts was credited to the relayer balance. */
  claimDustApplied: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const MarketSchema = new Schema<IMarket>(
  {
    address: { type: String, required: true, unique: true, lowercase: true, index: true },
    pairId: { type: String, required: true },
    pairSymbol: { type: String, index: true },
    pairIdHex: { type: String, index: true },
    startTime: { type: Number, required: true },
    endTime: { type: Number, required: true },
    duration: { type: Number, required: true },
    status: {
      type: String,
      required: true,
      enum: ['ACTIVE', 'TRADING_ENDED', 'RESOLVED', 'CLAIMED'],
      default: 'ACTIVE',
      index: true,
    },
    winner: { type: Number, default: null },
    upPrice: { type: String, default: '0' },
    downPrice: { type: String, default: '0' },
    strikePrice: { type: String, default: '' },
    volume: { type: String, default: '0' },
    claimedByRelayer: { type: Boolean, default: false },
    claimDistributionComplete: { type: Boolean, default: false },
    claimDustApplied: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const MarketModel = mongoose.model<IMarket>('Market', MarketSchema);
