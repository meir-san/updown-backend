import { ethers } from 'ethers';
import { config } from '../config';
import UpDownSettlementAbi from '../abis/UpDownSettlement.json';

function normAddr(a: string): string {
  return a.toLowerCase();
}

/**
 * DMM whitelist + on-chain rebate accumulation. Admin routes mutate `listed`;
 * `isDMM` is refreshed from chain for rate limits and rebate eligibility.
 */
export class DMMService {
  private relayer: ethers.Wallet;
  private settlementRead: ethers.Contract;
  private settlementWrite: ethers.Contract;
  /** Addresses we know were added via admin (or bootstrap); always checked on-chain for rebates. */
  private listed = new Set<string>();
  private cache = new Map<string, { is: boolean; exp: number }>();
  private readonly ttlMs = 30_000;
  private rebateDrain: Promise<void> = Promise.resolve();

  constructor(provider: ethers.JsonRpcProvider) {
    this.relayer = new ethers.Wallet(config.relayerPrivateKey, provider);
    this.settlementRead = new ethers.Contract(
      config.settlementAddress,
      UpDownSettlementAbi,
      provider
    );
    this.settlementWrite = new ethers.Contract(
      config.settlementAddress,
      UpDownSettlementAbi,
      this.relayer
    );
    const raw = optionalCsv('DMM_BOOTSTRAP_ADDRESSES');
    for (const a of raw) {
      if (ethers.isAddress(a)) this.listed.add(normAddr(a));
    }
  }

  listKnown(): string[] {
    return [...this.listed].sort();
  }

  /** Best-effort synchronous: listed set or fresh cache entry. */
  isDmmCached(wallet: string): boolean {
    const w = normAddr(wallet);
    if (this.listed.has(w)) return true;
    const row = this.cache.get(w);
    if (row && row.exp > Date.now()) return row.is;
    void this.refreshIsDmm(w);
    return false;
  }

  /** Await chain (with short TTL cache). */
  async resolveIsDmm(wallet: string): Promise<boolean> {
    const w = normAddr(wallet);
    if (this.listed.has(w)) return true;
    const now = Date.now();
    const row = this.cache.get(w);
    if (row && row.exp > now) return row.is;
    return this.refreshIsDmm(w);
  }

  private async refreshIsDmm(wallet: string): Promise<boolean> {
    const w = normAddr(wallet);
    let is = false;
    try {
      is = Boolean(await this.settlementRead.isDMM(w));
    } catch (e) {
      console.error('[DMM] isDMM failed', w, e);
    }
    this.cache.set(w, { is, exp: Date.now() + this.ttlMs });
    return is;
  }

  invalidateCache(wallet: string): void {
    this.cache.delete(normAddr(wallet));
  }

  async dmmRebateAccumulated(wallet: string): Promise<bigint> {
    const v: bigint = await this.settlementRead.dmmRebateAccumulated(normAddr(wallet));
    return v;
  }

  async addDMM(account: string): Promise<ethers.TransactionReceipt | null> {
    const tx = await this.settlementWrite.addDMM(account);
    const rec = await tx.wait();
    this.listed.add(normAddr(account));
    this.cache.set(normAddr(account), { is: true, exp: Date.now() + this.ttlMs });
    return rec;
  }

  async removeDMM(account: string): Promise<ethers.TransactionReceipt | null> {
    const tx = await this.settlementWrite.removeDMM(account);
    const rec = await tx.wait();
    this.listed.delete(normAddr(account));
    this.cache.set(normAddr(account), { is: false, exp: Date.now() + this.ttlMs });
    return rec;
  }

  /**
   * After an off-chain fill, rebate a portion of maker fee to the maker when they are a DMM on-chain.
   * Rebates: (makerFee * dmmRebateBps) / 10_000 — see config.dmmRebateBps.
   */
  scheduleRebateFromFill(maker: string, makerFee: bigint): void {
    this.rebateDrain = this.rebateDrain.then(() => this.applyRebate(maker, makerFee)).catch((e) => {
      console.error('[DMM] rebate chain failed', maker, e);
    });
  }

  private async applyRebate(maker: string, makerFee: bigint): Promise<void> {
    const w = normAddr(maker);
    const is = await this.resolveIsDmm(w);
    if (!is) return;
    const bps = BigInt(config.dmmRebateBps);
    const rebate = (makerFee * bps) / 10000n;
    if (rebate <= 0n) return;
    try {
      const tx = await this.settlementWrite.accumulateRebate(w, rebate);
      await tx.wait();
    } catch (e) {
      console.error('[DMM] accumulateRebate failed', w, rebate.toString(), e);
    }
  }
}

function optionalCsv(key: string): string[] {
  const v = process.env[key];
  if (!v?.trim()) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
