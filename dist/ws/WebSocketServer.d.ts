import { Server as HttpServer } from 'http';
import { MatchingEngine } from '../engine/MatchingEngine';
/**
 * WebSocket server for real-time order book updates, trade events, and balance changes.
 *
 * Clients subscribe to channels:
 *   - "orderbook:<marketAddr>" -- order book updates for a market
 *   - "trades:<marketAddr>" -- trade events for a market
 *   - "markets" -- new market / resolution events
 *   - "orders:<wallet>" -- order status updates for a specific wallet
 */
export declare class WsServer {
    private wss;
    private clients;
    constructor(server: HttpServer, engine: MatchingEngine);
    broadcastMarketEvent(type: 'market_created' | 'market_resolved', data: any): void;
    broadcastBalanceUpdate(wallet: string, data: any): void;
    private handleMessage;
    private broadcast;
    private send;
}
//# sourceMappingURL=WebSocketServer.d.ts.map