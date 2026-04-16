import { config } from '../config';
import { SmartAccountModel, setSmartAccountCachedBalance } from '../models/SmartAccount';

/**
 * Refreshes `cachedBalance` from chain (USDT balanceOf smart account).
 * Poller runs every 30s; also invoked after settlement confirmation, withdraw, and claim payouts.
 */
export class SmartAccountBalanceSync {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly pollIntervalMs = 30_000) {}

  start(): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => {
      this.refreshAll().catch((e) => console.error('[SmartAccountBalanceSync] poll error:', e));
    }, this.pollIntervalMs);
    void this.refreshAll().catch((e) => console.error('[SmartAccountBalanceSync] initial poll error:', e));
    console.log(`[SmartAccountBalanceSync] Started (interval=${this.pollIntervalMs}ms)`);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async refreshOwner(ownerAddress: string): Promise<void> {
    const o = ownerAddress.toLowerCase();
    const doc = await SmartAccountModel.findOne({ ownerAddress: o }).lean();
    if (!doc) return;
    const bal = await this.readUsdtBalance(doc.smartAccountAddress as `0x${string}`);
    await setSmartAccountCachedBalance(o, bal.toString());
  }

  async refreshAll(): Promise<void> {
    const docs = await SmartAccountModel.find({}).select('ownerAddress smartAccountAddress').lean();
    for (const d of docs) {
      try {
        const bal = await this.readUsdtBalance(d.smartAccountAddress as `0x${string}`);
        await setSmartAccountCachedBalance(d.ownerAddress, bal.toString());
      } catch (e) {
        console.error('[SmartAccountBalanceSync] refresh row failed', d.ownerAddress, e);
      }
    }
  }

  private async readUsdtBalance(smartAccountAddress: `0x${string}`): Promise<bigint> {
    const { createPublicClient, http, erc20Abi } = await import('viem');
    const { arbitrum, arbitrumSepolia } = await import('viem/chains');
    const chain = config.chainId === 421614 ? arbitrumSepolia : arbitrum;
    const pc = createPublicClient({
      chain,
      transport: http(config.arbitrumRpcUrl),
    });
    return pc.readContract({
      address: config.usdtAddress as `0x${string}`,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [smartAccountAddress],
    });
  }
}
