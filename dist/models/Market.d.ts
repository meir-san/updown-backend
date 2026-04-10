import mongoose, { Document } from 'mongoose';
export interface IMarket extends Document {
    address: string;
    pairId: string;
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
export declare const MarketModel: mongoose.Model<IMarket, {}, {}, {}, mongoose.Document<unknown, {}, IMarket, {}, {}> & IMarket & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
//# sourceMappingURL=Market.d.ts.map