export declare const config: {
    readonly port: number;
    readonly mongoUri: string;
    readonly arbitrumRpcUrl: string;
    readonly relayerPrivateKey: string;
    readonly chainId: number;
    readonly autocyclerAddress: string;
    readonly factoryAddress: string;
    readonly usdtAddress: string;
    readonly platformFeeBps: number;
    readonly makerFeeBps: number;
    readonly matchingIntervalMs: number;
    readonly settlementBatchIntervalMs: number;
    readonly marketSyncIntervalMs: number;
    readonly depositConfirmations: number;
    /** Base URL for rain-speed-markets price history API (proxied at GET /prices/history/:symbol). */
    readonly speedMarketApiBaseUrl: string;
};
export declare const USDT_DECIMALS = 6;
export declare const PRICE_DECIMALS = 18;
export declare const OPTION_UP = 1;
export declare const OPTION_DOWN = 2;
export declare const MAX_UINT256: bigint;
export declare const EIP712_DOMAIN: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: `0x${string}`;
};
export declare const EIP712_ORDER_TYPES: {
    Order: {
        name: string;
        type: string;
    }[];
};
export declare const EIP712_CANCEL_TYPES: {
    Cancel: {
        name: string;
        type: string;
    }[];
};
export declare const EIP712_WITHDRAW_TYPES: {
    Withdraw: {
        name: string;
        type: string;
    }[];
};
//# sourceMappingURL=config.d.ts.map