import { InternalOrder, OrderSide, OrderStatus, PriceLevel, OrderBookSnapshot } from './types';

/**
 * In-memory order book for a single option within a single market.
 * Maintains buy (bid) and sell (ask) sides with price-time priority.
 *
 * Bids: sorted by price descending (highest first), then time ascending (FIFO).
 * Asks: sorted by price ascending (lowest first), then time ascending (FIFO).
 */
export class OrderBook {
  readonly market: string;
  readonly option: number;

  private bids: Map<number, InternalOrder[]> = new Map();
  private asks: Map<number, InternalOrder[]> = new Map();

  private sortedBidPrices: number[] = [];
  private sortedAskPrices: number[] = [];

  constructor(market: string, option: number) {
    this.market = market;
    this.option = option;
  }

  addOrder(order: InternalOrder): void {
    const side = order.side === OrderSide.BUY ? this.bids : this.asks;
    const prices = order.side === OrderSide.BUY ? this.sortedBidPrices : this.sortedAskPrices;

    let queue = side.get(order.price);
    if (!queue) {
      queue = [];
      side.set(order.price, queue);
      this.insertPrice(prices, order.price, order.side);
    }
    queue.push(order);
  }

  removeOrder(orderId: string): InternalOrder | null {
    const found = this.removeFrom(this.bids, this.sortedBidPrices, orderId);
    if (found) return found;
    return this.removeFrom(this.asks, this.sortedAskPrices, orderId);
  }

  getBestBid(): number | null {
    return this.sortedBidPrices.length > 0 ? this.sortedBidPrices[0] : null;
  }

  getBestAsk(): number | null {
    return this.sortedAskPrices.length > 0 ? this.sortedAskPrices[0] : null;
  }

  peekBestBidOrders(): InternalOrder[] {
    const best = this.getBestBid();
    if (best === null) return [];
    return this.bids.get(best) ?? [];
  }

  peekBestAskOrders(): InternalOrder[] {
    const best = this.getBestAsk();
    if (best === null) return [];
    return this.asks.get(best) ?? [];
  }

  /**
   * Remove and return the first order at the best price on the given side.
   */
  popBest(side: OrderSide): InternalOrder | null {
    const map = side === OrderSide.BUY ? this.bids : this.asks;
    const prices = side === OrderSide.BUY ? this.sortedBidPrices : this.sortedAskPrices;

    if (prices.length === 0) return null;
    const bestPrice = prices[0];
    const queue = map.get(bestPrice);
    if (!queue || queue.length === 0) return null;

    const order = queue.shift()!;
    if (queue.length === 0) {
      map.delete(bestPrice);
      prices.shift();
    }
    return order;
  }

  getSnapshot(): OrderBookSnapshot {
    return {
      bids: this.aggregateSide(this.bids, this.sortedBidPrices),
      asks: this.aggregateSide(this.asks, this.sortedAskPrices),
    };
  }

  getOrderCount(): number {
    let count = 0;
    for (const queue of this.bids.values()) count += queue.length;
    for (const queue of this.asks.values()) count += queue.length;
    return count;
  }

  getAllOrders(): InternalOrder[] {
    const orders: InternalOrder[] = [];
    for (const queue of this.bids.values()) orders.push(...queue);
    for (const queue of this.asks.values()) orders.push(...queue);
    return orders;
  }

  getOrdersByMaker(maker: string): InternalOrder[] {
    const normalized = maker.toLowerCase();
    return this.getAllOrders().filter((o) => o.maker.toLowerCase() === normalized);
  }

  private removeFrom(
    map: Map<number, InternalOrder[]>,
    prices: number[],
    orderId: string
  ): InternalOrder | null {
    for (const [price, queue] of map.entries()) {
      const idx = queue.findIndex((o) => o.id === orderId);
      if (idx !== -1) {
        const [removed] = queue.splice(idx, 1);
        if (queue.length === 0) {
          map.delete(price);
          const priceIdx = prices.indexOf(price);
          if (priceIdx !== -1) prices.splice(priceIdx, 1);
        }
        return removed;
      }
    }
    return null;
  }

  private insertPrice(prices: number[], price: number, side: OrderSide): void {
    if (side === OrderSide.BUY) {
      // Descending: highest first
      const idx = prices.findIndex((p) => p < price);
      if (idx === -1) prices.push(price);
      else prices.splice(idx, 0, price);
    } else {
      // Ascending: lowest first
      const idx = prices.findIndex((p) => p > price);
      if (idx === -1) prices.push(price);
      else prices.splice(idx, 0, price);
    }
  }

  private aggregateSide(map: Map<number, InternalOrder[]>, prices: number[]): PriceLevel[] {
    const levels: PriceLevel[] = [];
    for (const price of prices) {
      const queue = map.get(price);
      if (!queue || queue.length === 0) continue;
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

/**
 * Manages order books for all markets and options.
 * Key: `${marketAddress}:${option}` (e.g., "0xabc...:1" for UP)
 */
export class OrderBookManager {
  private books: Map<string, OrderBook> = new Map();

  private key(market: string, option: number): string {
    return `${market.toLowerCase()}:${option}`;
  }

  getOrCreate(market: string, option: number): OrderBook {
    const k = this.key(market, option);
    let book = this.books.get(k);
    if (!book) {
      book = new OrderBook(market, option);
      this.books.set(k, book);
    }
    return book;
  }

  get(market: string, option: number): OrderBook | undefined {
    return this.books.get(this.key(market, option));
  }

  getMarketSnapshot(market: string): { up: OrderBookSnapshot; down: OrderBookSnapshot } {
    const upBook = this.getOrCreate(market, 1);
    const downBook = this.getOrCreate(market, 2);
    return {
      up: upBook.getSnapshot(),
      down: downBook.getSnapshot(),
    };
  }

  removeMarket(market: string): void {
    this.books.delete(this.key(market, 1));
    this.books.delete(this.key(market, 2));
  }

  allMarkets(): string[] {
    const markets = new Set<string>();
    for (const key of this.books.keys()) {
      markets.add(key.split(':')[0]);
    }
    return Array.from(markets);
  }

  /** All option books (for maintenance such as sweeping expired resting orders). */
  allBooks(): OrderBook[] {
    return Array.from(this.books.values());
  }
}
