import mongoose, { Document } from 'mongoose';
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
export declare const OrderModel: mongoose.Model<IOrder, {}, {}, {}, mongoose.Document<unknown, {}, IOrder, {}, {}> & IOrder & Required<{
    _id: mongoose.Types.ObjectId;
}> & {
    __v: number;
}, any>;
//# sourceMappingURL=Order.d.ts.map