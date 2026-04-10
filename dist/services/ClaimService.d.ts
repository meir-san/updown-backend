import { ethers } from 'ethers';
/**
 * After a market is resolved (ChainlinkResolver called chooseWinner),
 * the relayer claims its USDT payout and distributes winnings
 * to users based on their off-chain positions in MongoDB.
 */
export declare class ClaimService {
    private provider;
    private relayer;
    constructor(provider: ethers.JsonRpcProvider);
    processResolvedMarket(marketAddress: string): Promise<void>;
    private distributeWinnings;
}
//# sourceMappingURL=ClaimService.d.ts.map