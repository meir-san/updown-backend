import { EventEmitter } from 'events';
import { OrderBookManager } from './OrderBook';
import { InternalOrder, OrderParams } from './types';
/**
 * Off-chain matching engine with cancel-before-taker priority.
 *
 * Runs in a batch loop: processes all pending cancels, then all new orders.
 * Emits events for WebSocket broadcasting.
 */
export declare class MatchingEngine extends EventEmitter {
    readonly books: OrderBookManager;
    private pendingOrders;
    private pendingCancels;
    private intervalHandle;
    constructor(books: OrderBookManager);
    start(): void;
    stop(): void;
    submitOrder(params: OrderParams): Promise<InternalOrder>;
    submitCancel(orderId: string, maker: string): void;
    private runCycle;
    private sweepExpiredRestingOrders;
    private processCancel;
    private matchOrder;
    private executeFill;
    private remainingAmount;
    private calculateFillAmount;
    private updateOrderStatus;
}
//# sourceMappingURL=MatchingEngine.d.ts.map