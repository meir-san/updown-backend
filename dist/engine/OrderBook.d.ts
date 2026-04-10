import { InternalOrder, OrderSide, OrderBookSnapshot } from './types';
/**
 * In-memory order book for a single option within a single market.
 * Maintains buy (bid) and sell (ask) sides with price-time priority.
 *
 * Bids: sorted by price descending (highest first), then time ascending (FIFO).
 * Asks: sorted by price ascending (lowest first), then time ascending (FIFO).
 */
export declare class OrderBook {
    readonly market: string;
    readonly option: number;
    private bids;
    private asks;
    private sortedBidPrices;
    private sortedAskPrices;
    constructor(market: string, option: number);
    addOrder(order: InternalOrder): void;
    removeOrder(orderId: string): InternalOrder | null;
    getBestBid(): number | null;
    getBestAsk(): number | null;
    peekBestBidOrders(): InternalOrder[];
    peekBestAskOrders(): InternalOrder[];
    /**
     * Remove and return the first order at the best price on the given side.
     */
    popBest(side: OrderSide): InternalOrder | null;
    getSnapshot(): OrderBookSnapshot;
    getOrderCount(): number;
    getAllOrders(): InternalOrder[];
    getOrdersByMaker(maker: string): InternalOrder[];
    private removeFrom;
    private insertPrice;
    private aggregateSide;
}
/**
 * Manages order books for all markets and options.
 * Key: `${marketAddress}:${option}` (e.g., "0xabc...:1" for UP)
 */
export declare class OrderBookManager {
    private books;
    private key;
    getOrCreate(market: string, option: number): OrderBook;
    get(market: string, option: number): OrderBook | undefined;
    getMarketSnapshot(market: string): {
        up: OrderBookSnapshot;
        down: OrderBookSnapshot;
    };
    removeMarket(market: string): void;
    allMarkets(): string[];
    /** All option books (for maintenance such as sweeping expired resting orders). */
    allBooks(): OrderBook[];
}
//# sourceMappingURL=OrderBook.d.ts.map