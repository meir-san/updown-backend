import { ethers } from 'ethers';
import { OrderBookManager } from '../engine/OrderBook';
import { ClaimService } from './ClaimService';
import type { WsServer } from '../ws/WebSocketServer';
/**
 * Polls the UpDownAutoCycler contract for active markets.
 * Syncs market metadata to MongoDB.
 * Detects resolved markets and triggers ClaimService.
 */
export declare class MarketSyncer {
    private provider;
    private books;
    private claimService;
    private ws;
    private intervalHandle;
    constructor(provider: ethers.JsonRpcProvider, books: OrderBookManager, claimService: ClaimService, ws?: WsServer | null);
    start(): void;
    stop(): void;
    sync(): Promise<void>;
    private syncMarket;
    private checkResolution;
}
//# sourceMappingURL=MarketSyncer.d.ts.map