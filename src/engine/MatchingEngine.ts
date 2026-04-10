import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { OrderBookManager } from './OrderBook';
import {
  InternalOrder,
  OrderSide,
  OrderType,
  OrderStatus,
  TradeResult,
  OrderParams,
} from './types';
import { config } from '../config';
import { OrderModel } from '../models/Order';
import { TradeModel } from '../models/Trade';
import { MarketModel } from '../models/Market';
import { debitAvailable, releaseFromOrders, settleFillBalances } from '../models/Balance';

export type MatchingEngineOptions = {
  platformFeeTreasury: string;
};

/**
 * Off-chain matching engine with cancel-before-taker priority.
 *
 * Runs in a batch loop: processes all pending cancels, then all new orders.
 * Emits events for WebSocket broadcasting.
 */
export class MatchingEngine extends EventEmitter {
  readonly books: OrderBookManager;
  readonly platformFeeTreasury: string;

  private pendingOrders: InternalOrder[] = [];
  private pendingCancels: { orderId: string; maker: string }[] = [];
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(books: OrderBookManager, opts: MatchingEngineOptions) {
    super();
    this.books = books;
    this.platformFeeTreasury = opts.platformFeeTreasury.toLowerCase();
  }

  start(): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => {
      this.runCycle().catch((err) =>
        console.error('[MatchingEngine] cycle error:', err)
      );
    }, config.matchingIntervalMs);
    console.log(`[MatchingEngine] Started (interval=${config.matchingIntervalMs}ms)`);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async submitOrder(params: OrderParams): Promise<InternalOrder> {
    const option = Number(params.option);
    if (option !== 1 && option !== 2) {
      throw new Error('Invalid option');
    }

    let amountBi: bigint;
    try {
      amountBi = BigInt(params.amount);
    } catch {
      throw new Error('Invalid amount');
    }
    if (amountBi <= 0n) {
      throw new Error('Amount must be positive');
    }

    const sideEnum: OrderSide = params.side;
    const typeEnum: OrderType = params.type;

    if (typeEnum === OrderType.LIMIT) {
      const p = params.price;
      if (p < 1 || p > 9999) {
        throw new Error('Limit price must be between 1 and 9999 (basis points)');
      }
    }

    const marketNorm = params.market.toLowerCase();
    const marketDoc = await MarketModel.findOne({
      address: marketNorm,
      status: 'ACTIVE',
    }).lean();
    if (!marketDoc) {
      throw new Error('Market not found or not active');
    }

    const order: InternalOrder = {
      id: uuidv4(),
      maker: params.maker.toLowerCase(),
      market: marketNorm,
      option,
      side: sideEnum,
      type: typeEnum,
      price: params.price,
      amount: amountBi,
      filledAmount: 0n,
      nonce: params.nonce,
      expiry: params.expiry,
      signature: params.signature,
      status: OrderStatus.OPEN,
      createdAt: Date.now(),
    };

    const debited = await debitAvailable(order.maker, order.amount);
    if (!debited) {
      throw new Error('Insufficient balance');
    }

    await OrderModel.create({
      orderId: order.id,
      maker: order.maker,
      market: order.market,
      option: order.option,
      side: order.side,
      type: order.type,
      price: order.price,
      amount: order.amount.toString(),
      filledAmount: '0',
      nonce: order.nonce,
      expiry: order.expiry,
      signature: order.signature,
      status: order.status,
    });

    this.pendingOrders.push(order);
    return order;
  }

  submitCancel(orderId: string, maker: string): void {
    this.pendingCancels.push({ orderId, maker: maker.toLowerCase() });
  }

  /**
   * When a market stops trading, cancel all resting and queued orders and return locked collateral.
   */
  async cancelAllRestingAndPendingForMarket(market: string): Promise<void> {
    const m = market.toLowerCase();
    const kept: InternalOrder[] = [];
    for (const order of this.pendingOrders) {
      if (order.market === m) {
        order.status = OrderStatus.CANCELLED;
        await this.updateOrderStatus(order);
        const released = await releaseFromOrders(order.maker, order.amount);
        if (!released) {
          console.error('[MatchingEngine] releaseFromOrders failed for pending order', order.id, order.maker);
        }
        this.emit('order_update', order);
      } else {
        kept.push(order);
      }
    }
    this.pendingOrders = kept;

    for (const option of [1, 2] as const) {
      const book = this.books.get(m, option);
      if (!book) continue;
      const snapshotOrders = [...book.getAllOrders()];
      for (const order of snapshotOrders) {
        book.removeOrder(order.id);
        order.status = OrderStatus.CANCELLED;
        await this.updateOrderStatus(order);
        const remaining = order.amount - order.filledAmount;
        if (remaining > 0n) {
          const released = await releaseFromOrders(order.maker, remaining);
          if (!released) {
            console.error('[MatchingEngine] releaseFromOrders failed for resting order', order.id);
          }
        }
        this.emit('order_update', order);
        this.emit('orderbook_update', {
          market: m,
          option,
          snapshot: book.getSnapshot(),
        });
      }
    }
  }

  private async runCycle(): Promise<void> {
    // Step 1: Process cancels (cancel priority)
    const cancels = this.pendingCancels.splice(0);
    for (const cancel of cancels) {
      await this.processCancel(cancel.orderId, cancel.maker);
    }

    await this.sweepExpiredRestingOrders();

    // Step 2: Process new taker orders
    const orders = this.pendingOrders.splice(0);
    for (const order of orders) {
      if (order.expiry > 0 && Date.now() / 1000 > order.expiry) {
        order.status = OrderStatus.CANCELLED;
        await this.updateOrderStatus(order);
        const released = await releaseFromOrders(order.maker, order.amount);
        if (!released) {
          console.error('[MatchingEngine] releaseFromOrders failed (expired pending)', order.id);
        }
        continue;
      }
      await this.matchOrder(order);
    }
  }

  private async sweepExpiredRestingOrders(): Promise<void> {
    const now = Date.now() / 1000;
    for (const book of this.books.allBooks()) {
      const snapshotOrders = [...book.getAllOrders()];
      for (const order of snapshotOrders) {
        if (order.expiry <= 0 || now <= order.expiry) continue;
        book.removeOrder(order.id);
        order.status = OrderStatus.CANCELLED;
        await this.updateOrderStatus(order);
        const remaining = order.amount - order.filledAmount;
        if (remaining > 0n) {
          const released = await releaseFromOrders(order.maker, remaining);
          if (!released) {
            console.error('[MatchingEngine] releaseFromOrders failed (sweep)', order.id);
          }
        }
        this.emit('order_update', order);
        this.emit('orderbook_update', {
          market: order.market,
          option: order.option,
          snapshot: book.getSnapshot(),
        });
      }
    }
  }

  private async processCancel(orderId: string, maker: string): Promise<void> {
    // Try all markets and options
    for (const market of this.books.allMarkets()) {
      for (const option of [1, 2]) {
        const book = this.books.get(market, option);
        if (!book) continue;
        const removed = book.removeOrder(orderId);
        if (removed && removed.maker === maker) {
          removed.status = OrderStatus.CANCELLED;
          await this.updateOrderStatus(removed);
          const remaining = removed.amount - removed.filledAmount;
          if (remaining > 0n) {
            const released = await releaseFromOrders(removed.maker, remaining);
            if (!released) {
              console.error('[MatchingEngine] releaseFromOrders failed (cancel)', orderId);
            }
          }
          this.emit('order_update', removed);
          return;
        }
      }
    }
  }

  private async matchOrder(order: InternalOrder): Promise<void> {
    const book = this.books.getOrCreate(order.market, order.option);
    const oppositeSide = order.side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY;

    while (this.remainingAmount(order) > 0n) {
      const bestOrders =
        oppositeSide === OrderSide.SELL
          ? book.peekBestAskOrders()
          : book.peekBestBidOrders();

      if (bestOrders.length === 0) break;

      const bestPrice =
        oppositeSide === OrderSide.SELL ? book.getBestAsk()! : book.getBestBid()!;

      if (order.type === OrderType.LIMIT) {
        if (order.side === OrderSide.BUY && bestPrice > order.price) break;
        if (order.side === OrderSide.SELL && bestPrice < order.price) break;
      }

      const takerKey = order.maker.toLowerCase();
      const resting = bestOrders.find((r) => r.maker.toLowerCase() !== takerKey);
      if (!resting) break;
      const fillAmount = this.calculateFillAmount(order, resting);
      if (fillAmount <= 0n) break;

      await this.executeFill(order, resting, bestPrice, fillAmount, book);
    }

    // If order still has remaining amount and is a limit order, add to book
    if (this.remainingAmount(order) > 0n && order.type === OrderType.LIMIT) {
      book.addOrder(order);
      this.emit('orderbook_update', {
        market: order.market,
        option: order.option,
        snapshot: book.getSnapshot(),
      });
    } else if (this.remainingAmount(order) > 0n && order.type === OrderType.MARKET) {
      // Market order with unfilled remainder: cancel the rest
      const remaining = this.remainingAmount(order);
      if (order.filledAmount > 0n) {
        order.status = OrderStatus.PARTIALLY_FILLED;
      } else {
        order.status = OrderStatus.CANCELLED;
      }
      await this.updateOrderStatus(order);
      const released = await releaseFromOrders(order.maker, remaining);
      if (!released) {
        console.error('[MatchingEngine] releaseFromOrders failed (market remainder)', order.id);
      }
    }

    if (order.filledAmount > 0n) {
      await this.updateOrderStatus(order);
    }
  }

  private async executeFill(
    taker: InternalOrder,
    maker: InternalOrder,
    price: number,
    fillAmount: bigint,
    book: ReturnType<OrderBookManager['getOrCreate']>
  ): Promise<void> {
    const platformFee = (fillAmount * BigInt(config.platformFeeBps)) / 10000n;
    const makerFee = (fillAmount * BigInt(config.makerFeeBps)) / 10000n;

    const [buyer, seller] =
      taker.side === OrderSide.BUY
        ? [taker, maker]
        : [maker, taker];

    const sellerReceives = fillAmount - platformFee - makerFee;

    const settled = await settleFillBalances(
      buyer.maker,
      seller.maker,
      this.platformFeeTreasury,
      fillAmount,
      platformFee,
      sellerReceives,
      makerFee
    );
    if (!settled) {
      console.error('[MatchingEngine] settleFillBalances failed', {
        buyer: buyer.maker,
        seller: seller.maker,
        fillAmount: fillAmount.toString(),
      });
      throw new Error('Settlement accounting failed');
    }

    taker.filledAmount += fillAmount;
    maker.filledAmount += fillAmount;

    if (maker.filledAmount >= maker.amount) {
      maker.status = OrderStatus.FILLED;
      book.removeOrder(maker.id);
    } else {
      maker.status = OrderStatus.PARTIALLY_FILLED;
    }

    if (taker.filledAmount >= taker.amount) {
      taker.status = OrderStatus.FILLED;
    } else {
      taker.status = OrderStatus.PARTIALLY_FILLED;
    }

    const trade: TradeResult = {
      id: uuidv4(),
      market: taker.market,
      option: taker.option,
      buyOrderId: buyer.id,
      sellOrderId: seller.id,
      buyer: buyer.maker,
      seller: seller.maker,
      price,
      amount: fillAmount,
      platformFee,
      makerFee,
      timestamp: Date.now(),
    };

    await TradeModel.create({
      tradeId: trade.id,
      market: trade.market,
      option: trade.option,
      buyOrderId: trade.buyOrderId,
      sellOrderId: trade.sellOrderId,
      buyer: trade.buyer,
      seller: trade.seller,
      price: trade.price,
      amount: trade.amount.toString(),
      platformFee: trade.platformFee.toString(),
      makerFee: trade.makerFee.toString(),
    });

    await this.updateOrderStatus(maker);
    await this.updateOrderStatus(taker);

    this.emit('trade', trade);
    this.emit('order_update', maker);
    this.emit('order_update', taker);
    this.emit('orderbook_update', {
      market: taker.market,
      option: taker.option,
      snapshot: book.getSnapshot(),
    });
  }

  private remainingAmount(order: InternalOrder): bigint {
    return order.amount - order.filledAmount;
  }

  private calculateFillAmount(taker: InternalOrder, maker: InternalOrder): bigint {
    const takerRemaining = this.remainingAmount(taker);
    const makerRemaining = this.remainingAmount(maker);
    return takerRemaining < makerRemaining ? takerRemaining : makerRemaining;
  }

  private async updateOrderStatus(order: InternalOrder): Promise<void> {
    await OrderModel.updateOne(
      { orderId: order.id },
      {
        status: order.status,
        filledAmount: order.filledAmount.toString(),
      }
    );
  }
}
