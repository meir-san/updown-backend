"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MatchingEngine = void 0;
const uuid_1 = require("uuid");
const events_1 = require("events");
const types_1 = require("./types");
const config_1 = require("../config");
const Order_1 = require("../models/Order");
const Trade_1 = require("../models/Trade");
const Balance_1 = require("../models/Balance");
/**
 * Off-chain matching engine with cancel-before-taker priority.
 *
 * Runs in a batch loop: processes all pending cancels, then all new orders.
 * Emits events for WebSocket broadcasting.
 */
class MatchingEngine extends events_1.EventEmitter {
    books;
    pendingOrders = [];
    pendingCancels = [];
    intervalHandle = null;
    constructor(books) {
        super();
        this.books = books;
    }
    start() {
        if (this.intervalHandle)
            return;
        this.intervalHandle = setInterval(() => {
            this.runCycle().catch((err) => console.error('[MatchingEngine] cycle error:', err));
        }, config_1.config.matchingIntervalMs);
        console.log(`[MatchingEngine] Started (interval=${config_1.config.matchingIntervalMs}ms)`);
    }
    stop() {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }
    async submitOrder(params) {
        const order = {
            id: (0, uuid_1.v4)(),
            maker: params.maker.toLowerCase(),
            market: params.market.toLowerCase(),
            option: params.option,
            side: params.side,
            type: params.type,
            price: params.price,
            amount: BigInt(params.amount),
            filledAmount: 0n,
            nonce: params.nonce,
            expiry: params.expiry,
            signature: params.signature,
            status: types_1.OrderStatus.OPEN,
            createdAt: Date.now(),
        };
        const debited = await (0, Balance_1.debitAvailable)(order.maker, order.amount);
        if (!debited) {
            throw new Error('Insufficient balance');
        }
        await Order_1.OrderModel.create({
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
    submitCancel(orderId, maker) {
        this.pendingCancels.push({ orderId, maker: maker.toLowerCase() });
    }
    async runCycle() {
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
                order.status = types_1.OrderStatus.CANCELLED;
                await this.updateOrderStatus(order);
                await (0, Balance_1.releaseFromOrders)(order.maker, order.amount);
                continue;
            }
            await this.matchOrder(order);
        }
    }
    async sweepExpiredRestingOrders() {
        const now = Date.now() / 1000;
        for (const book of this.books.allBooks()) {
            const snapshotOrders = [...book.getAllOrders()];
            for (const order of snapshotOrders) {
                if (order.expiry <= 0 || now <= order.expiry)
                    continue;
                book.removeOrder(order.id);
                order.status = types_1.OrderStatus.CANCELLED;
                await this.updateOrderStatus(order);
                const remaining = order.amount - order.filledAmount;
                if (remaining > 0n) {
                    await (0, Balance_1.releaseFromOrders)(order.maker, remaining);
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
    async processCancel(orderId, maker) {
        // Try all markets and options
        for (const market of this.books.allMarkets()) {
            for (const option of [1, 2]) {
                const book = this.books.get(market, option);
                if (!book)
                    continue;
                const removed = book.removeOrder(orderId);
                if (removed && removed.maker === maker) {
                    removed.status = types_1.OrderStatus.CANCELLED;
                    await this.updateOrderStatus(removed);
                    const remaining = removed.amount - removed.filledAmount;
                    if (remaining > 0n) {
                        await (0, Balance_1.releaseFromOrders)(removed.maker, remaining);
                    }
                    this.emit('order_update', removed);
                    return;
                }
            }
        }
    }
    async matchOrder(order) {
        const book = this.books.getOrCreate(order.market, order.option);
        const oppositeSide = order.side === types_1.OrderSide.BUY ? types_1.OrderSide.SELL : types_1.OrderSide.BUY;
        while (this.remainingAmount(order) > 0n) {
            const bestOrders = oppositeSide === types_1.OrderSide.SELL
                ? book.peekBestAskOrders()
                : book.peekBestBidOrders();
            if (bestOrders.length === 0)
                break;
            const bestPrice = oppositeSide === types_1.OrderSide.SELL ? book.getBestAsk() : book.getBestBid();
            if (order.type === types_1.OrderType.LIMIT) {
                if (order.side === types_1.OrderSide.BUY && bestPrice > order.price)
                    break;
                if (order.side === types_1.OrderSide.SELL && bestPrice < order.price)
                    break;
            }
            const takerKey = order.maker.toLowerCase();
            const resting = bestOrders.find((r) => r.maker.toLowerCase() !== takerKey);
            if (!resting)
                break;
            const fillAmount = this.calculateFillAmount(order, resting);
            if (fillAmount <= 0n)
                break;
            await this.executeFill(order, resting, bestPrice, fillAmount, book);
        }
        // If order still has remaining amount and is a limit order, add to book
        if (this.remainingAmount(order) > 0n && order.type === types_1.OrderType.LIMIT) {
            book.addOrder(order);
            this.emit('orderbook_update', {
                market: order.market,
                option: order.option,
                snapshot: book.getSnapshot(),
            });
        }
        else if (this.remainingAmount(order) > 0n && order.type === types_1.OrderType.MARKET) {
            // Market order with unfilled remainder: cancel the rest
            const remaining = this.remainingAmount(order);
            if (order.filledAmount > 0n) {
                order.status = types_1.OrderStatus.PARTIALLY_FILLED;
            }
            else {
                order.status = types_1.OrderStatus.CANCELLED;
            }
            await this.updateOrderStatus(order);
            await (0, Balance_1.releaseFromOrders)(order.maker, remaining);
        }
        if (order.filledAmount > 0n) {
            await this.updateOrderStatus(order);
        }
    }
    async executeFill(taker, maker, price, fillAmount, book) {
        taker.filledAmount += fillAmount;
        maker.filledAmount += fillAmount;
        if (maker.filledAmount >= maker.amount) {
            maker.status = types_1.OrderStatus.FILLED;
            book.removeOrder(maker.id);
        }
        else {
            maker.status = types_1.OrderStatus.PARTIALLY_FILLED;
        }
        if (taker.filledAmount >= taker.amount) {
            taker.status = types_1.OrderStatus.FILLED;
        }
        else {
            taker.status = types_1.OrderStatus.PARTIALLY_FILLED;
        }
        const totalFeeBps = config_1.config.platformFeeBps + config_1.config.makerFeeBps;
        const platformFee = (fillAmount * BigInt(config_1.config.platformFeeBps)) / 10000n;
        const makerFee = (fillAmount * BigInt(config_1.config.makerFeeBps)) / 10000n;
        const [buyer, seller] = taker.side === types_1.OrderSide.BUY
            ? [taker, maker]
            : [maker, taker];
        const trade = {
            id: (0, uuid_1.v4)(),
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
        // Settle balances: buyer's locked funds go to seller (minus fees)
        const sellerReceives = fillAmount - platformFee - makerFee;
        await (0, Balance_1.settleTrade)(buyer.maker, seller.maker, sellerReceives, makerFee);
        await Trade_1.TradeModel.create({
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
    remainingAmount(order) {
        return order.amount - order.filledAmount;
    }
    calculateFillAmount(taker, maker) {
        const takerRemaining = this.remainingAmount(taker);
        const makerRemaining = this.remainingAmount(maker);
        return takerRemaining < makerRemaining ? takerRemaining : makerRemaining;
    }
    async updateOrderStatus(order) {
        await Order_1.OrderModel.updateOne({ orderId: order.id }, {
            status: order.status,
            filledAmount: order.filledAmount.toString(),
        });
    }
}
exports.MatchingEngine = MatchingEngine;
//# sourceMappingURL=MatchingEngine.js.map