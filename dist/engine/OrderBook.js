"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderBookManager = exports.OrderBook = void 0;
const types_1 = require("./types");
/**
 * In-memory order book for a single option within a single market.
 * Maintains buy (bid) and sell (ask) sides with price-time priority.
 *
 * Bids: sorted by price descending (highest first), then time ascending (FIFO).
 * Asks: sorted by price ascending (lowest first), then time ascending (FIFO).
 */
class OrderBook {
    market;
    option;
    bids = new Map();
    asks = new Map();
    sortedBidPrices = [];
    sortedAskPrices = [];
    constructor(market, option) {
        this.market = market;
        this.option = option;
    }
    addOrder(order) {
        const side = order.side === types_1.OrderSide.BUY ? this.bids : this.asks;
        const prices = order.side === types_1.OrderSide.BUY ? this.sortedBidPrices : this.sortedAskPrices;
        let queue = side.get(order.price);
        if (!queue) {
            queue = [];
            side.set(order.price, queue);
            this.insertPrice(prices, order.price, order.side);
        }
        queue.push(order);
    }
    removeOrder(orderId) {
        const found = this.removeFrom(this.bids, this.sortedBidPrices, orderId);
        if (found)
            return found;
        return this.removeFrom(this.asks, this.sortedAskPrices, orderId);
    }
    getBestBid() {
        return this.sortedBidPrices.length > 0 ? this.sortedBidPrices[0] : null;
    }
    getBestAsk() {
        return this.sortedAskPrices.length > 0 ? this.sortedAskPrices[0] : null;
    }
    peekBestBidOrders() {
        const best = this.getBestBid();
        if (best === null)
            return [];
        return this.bids.get(best) ?? [];
    }
    peekBestAskOrders() {
        const best = this.getBestAsk();
        if (best === null)
            return [];
        return this.asks.get(best) ?? [];
    }
    /**
     * Remove and return the first order at the best price on the given side.
     */
    popBest(side) {
        const map = side === types_1.OrderSide.BUY ? this.bids : this.asks;
        const prices = side === types_1.OrderSide.BUY ? this.sortedBidPrices : this.sortedAskPrices;
        if (prices.length === 0)
            return null;
        const bestPrice = prices[0];
        const queue = map.get(bestPrice);
        if (!queue || queue.length === 0)
            return null;
        const order = queue.shift();
        if (queue.length === 0) {
            map.delete(bestPrice);
            prices.shift();
        }
        return order;
    }
    getSnapshot() {
        return {
            bids: this.aggregateSide(this.bids, this.sortedBidPrices),
            asks: this.aggregateSide(this.asks, this.sortedAskPrices),
        };
    }
    getOrderCount() {
        let count = 0;
        for (const queue of this.bids.values())
            count += queue.length;
        for (const queue of this.asks.values())
            count += queue.length;
        return count;
    }
    getAllOrders() {
        const orders = [];
        for (const queue of this.bids.values())
            orders.push(...queue);
        for (const queue of this.asks.values())
            orders.push(...queue);
        return orders;
    }
    getOrdersByMaker(maker) {
        const normalized = maker.toLowerCase();
        return this.getAllOrders().filter((o) => o.maker.toLowerCase() === normalized);
    }
    removeFrom(map, prices, orderId) {
        for (const [price, queue] of map.entries()) {
            const idx = queue.findIndex((o) => o.id === orderId);
            if (idx !== -1) {
                const [removed] = queue.splice(idx, 1);
                if (queue.length === 0) {
                    map.delete(price);
                    const priceIdx = prices.indexOf(price);
                    if (priceIdx !== -1)
                        prices.splice(priceIdx, 1);
                }
                return removed;
            }
        }
        return null;
    }
    insertPrice(prices, price, side) {
        if (side === types_1.OrderSide.BUY) {
            // Descending: highest first
            const idx = prices.findIndex((p) => p < price);
            if (idx === -1)
                prices.push(price);
            else
                prices.splice(idx, 0, price);
        }
        else {
            // Ascending: lowest first
            const idx = prices.findIndex((p) => p > price);
            if (idx === -1)
                prices.push(price);
            else
                prices.splice(idx, 0, price);
        }
    }
    aggregateSide(map, prices) {
        const levels = [];
        for (const price of prices) {
            const queue = map.get(price);
            if (!queue || queue.length === 0)
                continue;
            let depth = 0n;
            for (const o of queue) {
                depth += o.amount - o.filledAmount;
            }
            levels.push({
                price,
                depth: depth.toString(),
                count: queue.length,
            });
        }
        return levels;
    }
}
exports.OrderBook = OrderBook;
/**
 * Manages order books for all markets and options.
 * Key: `${marketAddress}:${option}` (e.g., "0xabc...:1" for UP)
 */
class OrderBookManager {
    books = new Map();
    key(market, option) {
        return `${market.toLowerCase()}:${option}`;
    }
    getOrCreate(market, option) {
        const k = this.key(market, option);
        let book = this.books.get(k);
        if (!book) {
            book = new OrderBook(market, option);
            this.books.set(k, book);
        }
        return book;
    }
    get(market, option) {
        return this.books.get(this.key(market, option));
    }
    getMarketSnapshot(market) {
        const upBook = this.getOrCreate(market, 1);
        const downBook = this.getOrCreate(market, 2);
        return {
            up: upBook.getSnapshot(),
            down: downBook.getSnapshot(),
        };
    }
    removeMarket(market) {
        this.books.delete(this.key(market, 1));
        this.books.delete(this.key(market, 2));
    }
    allMarkets() {
        const markets = new Set();
        for (const key of this.books.keys()) {
            markets.add(key.split(':')[0]);
        }
        return Array.from(markets);
    }
    /** All option books (for maintenance such as sweeping expired resting orders). */
    allBooks() {
        return Array.from(this.books.values());
    }
}
exports.OrderBookManager = OrderBookManager;
//# sourceMappingURL=OrderBook.js.map