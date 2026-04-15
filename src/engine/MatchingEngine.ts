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
import { settleFillBalances } from '../models/Balance';
import {
  SmartAccountModel,
  lockSmartAccountInOrders,
  releaseSmartAccountInOrders,
} from '../models/SmartAccount';

export type MatchingEngineOptions = {
  platformFeeTreasury: string;
  /** Fire-and-forget DMM rebate after a fill credits the off-chain maker fee leg. */
  onDmmRebate?: (maker: string, makerFee: bigint) => void;
  /** After Mongo collateral moves, push a balance snapshot (no RPC on hot path). */
  onCollateralChange?: (ownerAddress: string) => void;
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
  private readonly onDmmRebate?: (maker: string, makerFee: bigint) => void;
  private readonly onCollateralChange?: (ownerAddress: string) => void;

  private pendingOrders: InternalOrder[] = [];
  private pendingCancels: { orderId: string; maker: string }[] = [];
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(books: OrderBookManager, opts: MatchingEngineOptions) {
    super();
    this.books = books;
    this.platformFeeTreasury = opts.platformFeeTreasury.toLowerCase();
    this.onDmmRebate = opts.onDmmRebate;
    this.onCollateralChange = opts.onCollateralChange;
  }

  private notifyCollateral(owner: string): void {
    try {
      this.onCollateralChange?.(owner.toLowerCase());
    } catch (e) {
      console.warn('[MatchingEngine] onCollateralChange failed:', e);
    }
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

  private isLimitPricedType(t: OrderType): boolean {
    return t === OrderType.LIMIT || t === OrderType.POST_ONLY || t === OrderType.IOC;
  }

  /** True if the order would match resting liquidity on entry (POST_ONLY guard). */
  private wouldImmediatelyTakeLiquidity(order: InternalOrder): boolean {
    if (!this.isLimitPricedType(order.type)) return false;
    const book = this.books.get(order.market, order.option);
    if (!book) return false;
    const oppositeSide = order.side === OrderSide.BUY ? OrderSide.SELL : OrderSide.BUY;
    const bestOrders =
      oppositeSide === OrderSide.SELL ? book.peekBestAskOrders() : book.peekBestBidOrders();
    if (bestOrders.length === 0) return false;
    const bestPrice =
      oppositeSide === OrderSide.SELL ? book.getBestAsk()! : book.getBestBid()!;
    if (order.side === OrderSide.BUY && bestPrice > order.price) return false;
    if (order.side === OrderSide.SELL && bestPrice < order.price) return false;
    const takerKey = order.maker.toLowerCase();
    const resting = bestOrders.find((r) => r.maker.toLowerCase() !== takerKey);
    if (!resting) return false;
    return this.calculateFillAmount(order, resting) > 0n;
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

    if (this.isLimitPricedType(typeEnum)) {
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

    const preview: InternalOrder = {
      id: '',
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

    if (typeEnum === OrderType.POST_ONLY && this.wouldImmediatelyTakeLiquidity(preview)) {
      throw new Error('POST_ONLY order would match immediately');
    }

    const order: InternalOrder = {
      ...preview,
      id: uuidv4(),
    };

    const sa = await SmartAccountModel.findOne({ ownerAddress: order.maker }).lean();
    if (!sa) {
      throw new Error('Register smart account first');
    }
    const debited = await lockSmartAccountInOrders(order.maker, order.amount);
    if (!debited) {
      throw new Error('Insufficient balance');
    }
    this.notifyCollateral(order.maker);

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
        const released = await releaseSmartAccountInOrders(order.maker, order.amount);
        if (!released) {
          console.error('[MatchingEngine] releaseSmartAccountInOrders failed for pending order', order.id, order.maker);
        }
        this.notifyCollateral(order.maker);
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
          const released = await releaseSmartAccountInOrders(order.maker, remaining);
          if (!released) {
            console.error('[MatchingEngine] releaseSmartAccountInOrders failed for resting order', order.id);
          }
          this.notifyCollateral(order.maker);
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

  /**
   * DMM kill switch: drop all pending + resting orders for one wallet in one market.
   * Optimized for low latency: one balance release, one OrderModel bulk update.
   */
  async cancelAllRestingAndPendingForMarketAndWallet(market: string, wallet: string): Promise<void> {
    const m = market.toLowerCase();
    const w = wallet.toLowerCase();
    const kept: InternalOrder[] = [];
    const pendingHits: InternalOrder[] = [];
    for (const order of this.pendingOrders) {
      if (order.market === m && order.maker === w) {
        order.status = OrderStatus.CANCELLED;
        pendingHits.push(order);
        this.emit('order_update', order);
      } else {
        kept.push(order);
      }
    }
    this.pendingOrders = kept;

    const restingHits: InternalOrder[] = [];
    for (const option of [1, 2] as const) {
      const book = this.books.get(m, option);
      if (!book) continue;
      for (const order of [...book.getAllOrders()]) {
        if (order.maker !== w) continue;
        book.removeOrder(order.id);
        order.status = OrderStatus.CANCELLED;
        restingHits.push(order);
        this.emit('order_update', order);
        this.emit('orderbook_update', {
          market: m,
          option,
          snapshot: book.getSnapshot(),
        });
      }
    }

    let releaseTotal = 0n;
    for (const o of pendingHits) releaseTotal += o.amount;
    for (const o of restingHits) releaseTotal += o.amount - o.filledAmount;

    const ids = [...pendingHits, ...restingHits].map((o) => o.id);
    if (ids.length > 0) {
      await OrderModel.updateMany(
        { orderId: { $in: ids } },
        { $set: { status: OrderStatus.CANCELLED } }
      );
    }

    if (releaseTotal > 0n) {
      const released = await releaseSmartAccountInOrders(w, releaseTotal);
      if (!released) {
        console.error('[MatchingEngine] releaseSmartAccountInOrders failed (kill switch)', w, releaseTotal.toString());
      }
      this.notifyCollateral(w);
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
        const released = await releaseSmartAccountInOrders(order.maker, order.amount);
        if (!released) {
          console.error('[MatchingEngine] releaseSmartAccountInOrders failed (expired pending)', order.id);
        }
        this.notifyCollateral(order.maker);
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
          const released = await releaseSmartAccountInOrders(order.maker, remaining);
          if (!released) {
            console.error('[MatchingEngine] releaseSmartAccountInOrders failed (sweep)', order.id);
          }
          this.notifyCollateral(order.maker);
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
            const released = await releaseSmartAccountInOrders(removed.maker, remaining);
            if (!released) {
              console.error('[MatchingEngine] releaseSmartAccountInOrders failed (cancel)', orderId);
            }
            this.notifyCollateral(removed.maker);
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

      if (this.isLimitPricedType(order.type)) {
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

    const rem = this.remainingAmount(order);
    if (rem > 0n && (order.type === OrderType.LIMIT || order.type === OrderType.POST_ONLY)) {
      book.addOrder(order);
      this.emit('orderbook_update', {
        market: order.market,
        option: order.option,
        snapshot: book.getSnapshot(),
      });
    } else if (rem > 0n && (order.type === OrderType.MARKET || order.type === OrderType.IOC)) {
      const remaining = rem;
      if (order.filledAmount > 0n) {
        order.status = OrderStatus.PARTIALLY_FILLED;
      } else {
        order.status = OrderStatus.CANCELLED;
      }
      await this.updateOrderStatus(order);
      const released = await releaseSmartAccountInOrders(order.maker, remaining);
      if (!released) {
        console.error('[MatchingEngine] releaseSmartAccountInOrders failed (market/ioc remainder)', order.id);
      }
      this.notifyCollateral(order.maker);
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

    this.notifyCollateral(buyer.maker);
    this.notifyCollateral(seller.maker);

    this.onDmmRebate?.(maker.maker, makerFee);

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
