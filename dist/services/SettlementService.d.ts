import { ethers } from 'ethers';
/**
 * Batches matched trades and enters aggregate positions on-chain
 * via the relayer wallet calling enterOption().
 *
 * Phase 2: all on-chain positions belong to the relayer.
 * Phase 4: will use session keys to enter from users' smart accounts.
 */
export declare class SettlementService {
    private provider;
    private relayer;
    private intervalHandle;
    private approvedPools;
    constructor(provider: ethers.JsonRpcProvider);
    get relayerAddress(): string;
    start(): void;
    stop(): void;
    private settleBatch;
    private enterOption;
    private ensureApproval;
}
//# sourceMappingURL=SettlementService.d.ts.map