import mongoose, { Document } from 'mongoose';
export interface IProcessedDepositTx extends Document {
    txHash: string;
    createdAt: Date;
}
export declare const ProcessedDepositTxModel: mongoose.Model<IProcessedDepositTx, {}, {}, {}, mongoose.Document<unknown, {}, IProcessedDepositTx, {}, {}> & IProcessedDepositTx & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
//# sourceMappingURL=ProcessedDepositTx.d.ts.map