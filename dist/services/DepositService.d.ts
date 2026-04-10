import { ethers } from 'ethers';
import type { WsServer } from '../ws/WebSocketServer';
/**
 * Monitors USDT Transfer events to the relayer address.
 * On confirmed deposit, credits the sender's balance in MongoDB.
 */
export declare class DepositService {
    private provider;
    private usdtContract;
    private relayerAddress;
    private ws;
    private running;
    constructor(provider: ethers.JsonRpcProvider, relayerAddress: string, ws?: WsServer | null);
    start(): Promise<void>;
    stop(): void;
}
//# sourceMappingURL=DepositService.d.ts.map