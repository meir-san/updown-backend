import mongoose, { Document } from 'mongoose';
export interface IBalance extends Document {
    wallet: string;
    available: string;
    inOrders: string;
    totalDeposited: string;
    totalWithdrawn: string;
    withdrawNonce: number;
    updatedAt: Date;
}
export declare const BalanceModel: mongoose.Model<IBalance, {}, {}, {}, mongoose.Document<unknown, {}, IBalance, {}, {}> & IBalance & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
export declare function getOrCreateBalance(wallet: string): Promise<IBalance>;
export declare function creditBalance(wallet: string, amount: bigint, field?: 'available' | 'totalDeposited'): Promise<void>;
/** Atomic move from available → inOrders when balance is sufficient (MongoDB $expr + aggregation update). */
export declare function debitAvailable(wallet: string, amount: bigint): Promise<boolean>;
/**
 * After an on-chain USDT transfer succeeds, atomically debit available, bump withdraw nonce,
 * and increase totalWithdrawn.
 */
export declare function applyWithdrawalAccounting(wallet: string, amount: bigint): Promise<boolean>;
export declare function releaseFromOrders(wallet: string, amount: bigint): Promise<void>;
export declare function settleTrade(buyer: string, seller: string, amount: bigint, makerFee: bigint): Promise<void>;
//# sourceMappingURL=Balance.d.ts.map