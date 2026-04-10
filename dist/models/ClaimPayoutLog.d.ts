import mongoose, { Document } from 'mongoose';
/** Prevents double-crediting the same wallet when claim distribution is retried after a partial run. */
export interface IClaimPayoutLog extends Document {
    market: string;
    wallet: string;
    amount: string;
    createdAt: Date;
}
export declare const ClaimPayoutLogModel: mongoose.Model<IClaimPayoutLog, {}, {}, {}, mongoose.Document<unknown, {}, IClaimPayoutLog, {}, {}> & IClaimPayoutLog & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
//# sourceMappingURL=ClaimPayoutLog.d.ts.map