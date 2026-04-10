import type { ApiConfig, MarketListItem, PostOrderBody, PairSymbol } from "./types.js";
export declare class UpDownHttpClient {
    private readonly baseUrl;
    constructor(baseUrl: string);
    getConfig(): Promise<ApiConfig>;
    getMarkets(opts?: {
        timeframe?: 300 | 900 | 3600;
        pair?: PairSymbol;
    }): Promise<MarketListItem[]>;
    getMarket(address: string): Promise<MarketListItem & Record<string, unknown>>;
    getOrderbook(marketId: string): Promise<unknown>;
    getBalance(wallet: string): Promise<unknown>;
    getPositions(wallet: string): Promise<unknown>;
    postOrder(body: PostOrderBody): Promise<unknown>;
}
export declare function wsUrlFromHttpBase(httpBase: string): string;
