import mongoose, { Document } from 'mongoose';
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
export declare const TradeModel: mongoose.Model<ITrade, {}, {}, {}, mongoose.Document<unknown, {}, ITrade, {}, {}> & ITrade & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
//# sourceMappingURL=Trade.d.ts.map