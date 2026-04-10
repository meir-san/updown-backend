import type { ApiConfig } from "./types.js";
export declare const ORDER_TYPES: {
    readonly Order: readonly [{
        readonly name: "maker";
        readonly type: "address";
    }, {
        readonly name: "market";
        readonly type: "address";
    }, {
        readonly name: "option";
        readonly type: "uint256";
    }, {
        readonly name: "side";
        readonly type: "uint8";
    }, {
        readonly name: "type";
        readonly type: "uint8";
    }, {
        readonly name: "price";
        readonly type: "uint256";
    }, {
        readonly name: "amount";
        readonly type: "uint256";
    }, {
        readonly name: "nonce";
        readonly type: "uint256";
    }, {
        readonly name: "expiry";
        readonly type: "uint256";
    }];
};
export type OrderSignMessage = {
    maker: `0x${string}`;
    market: `0x${string}`;
    option: bigint;
    side: number;
    type: number;
    price: bigint;
    amount: bigint;
    nonce: bigint;
    expiry: bigint;
};
export declare function buildOrderTypedData(cfg: ApiConfig, msg: OrderSignMessage): {
    domain: ApiConfig["eip712"]["domain"];
    types: typeof ORDER_TYPES;
    primaryType: "Order";
    message: OrderSignMessage;
};
