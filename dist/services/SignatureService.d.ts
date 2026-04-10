import { OrderSide, OrderType } from '../engine/types';
export interface OrderMessage {
    maker: string;
    market: string;
    option: bigint;
    side: number;
    type: number;
    price: bigint;
    amount: bigint;
    nonce: bigint;
    expiry: bigint;
}
export interface CancelMessage {
    maker: string;
    orderId: string;
}
export interface WithdrawMessage {
    wallet: string;
    amount: bigint;
    nonce: bigint;
}
export declare function verifyOrderSignature(params: {
    maker: string;
    market: string;
    option: number;
    side: OrderSide;
    type: OrderType;
    price: number;
    amount: string;
    nonce: number;
    expiry: number;
}, signature: string): boolean;
export declare function verifyCancelSignature(maker: string, orderId: string, signature: string): boolean;
export declare function verifyWithdrawSignature(wallet: string, amount: string, nonce: number, signature: string): boolean;
//# sourceMappingURL=SignatureService.d.ts.map