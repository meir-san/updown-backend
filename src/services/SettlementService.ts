import { ethers } from 'ethers';
import { config, MAX_UINT256, OPTION_UP, OPTION_DOWN } from '../config';
import { TradeModel, ITrade } from '../models/Trade';
import { reverseSettledFill } from '../models/Balance';
import TradePoolAbi from '../abis/TradePool.json';
import ERC20Abi from '../abis/ERC20.json';

const MAX_SETTLEMENT_RETRIES = 5;

function settlementBackoffMs(nextRetryCount: number): number {
  return Math.min(32_000, 1000 * Math.pow(2, Math.max(0, nextRetryCount - 1)));
}

/**
 * Batches matched trades and enters aggregate positions on-chain
 * via the relayer wallet calling enterOption().
 *
 * Phase 2: all on-chain positions belong to the relayer.
 * Phase 4: will use session keys to enter from users' smart accounts.
 */
export class SettlementService {
  private provider: ethers.JsonRpcProvider;
  private relayer: ethers.Wallet;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private approvedPools: Set<string> = new Set();

  constructor(provider: ethers.JsonRpcProvider) {
    this.provider = provider;
    this.relayer = new ethers.Wallet(config.relayerPrivateKey, provider);
  }

  get relayerAddress(): string {
    return this.relayer.address;
  }

  start(): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => {
      this.settleBatch().catch((err) =>
        console.error('[Settlement] batch error:', err)
      );
    }, config.settlementBatchIntervalMs);
    console.log(
      `[Settlement] Started (interval=${config.settlementBatchIntervalMs}ms, relayer=${this.relayer.address})`
    );
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async settleBatch(): Promise<void> {
    const now = new Date();
    const pendingTrades = await TradeModel.find({
      settlementStatus: 'PENDING',
      settlementRetryCount: { $lt: MAX_SETTLEMENT_RETRIES },
      $or: [{ settlementNextRetryAt: null }, { settlementNextRetryAt: { $lte: now } }],
    }).limit(50);

    if (pendingTrades.length === 0) return;

    const byMarket = new Map<string, ITrade[]>();
    for (const t of pendingTrades) {
      const list = byMarket.get(t.market) ?? [];
      list.push(t);
      byMarket.set(t.market, list);
    }

    for (const [market, trades] of byMarket) {
      const locked: ITrade[] = [];
      let up = 0n;
      let down = 0n;

      for (const t of trades) {
        const doc = await TradeModel.findOneAndUpdate(
          {
            tradeId: t.tradeId,
            settlementStatus: 'PENDING',
            settlementRetryCount: { $lt: MAX_SETTLEMENT_RETRIES },
            $or: [{ settlementNextRetryAt: null }, { settlementNextRetryAt: { $lte: now } }],
          },
          { $set: { settlementStatus: 'SUBMITTED' } },
          { new: true }
        );
        if (doc) {
          locked.push(doc);
          const amount = BigInt(doc.amount);
          if (doc.option === OPTION_UP) {
            up += amount;
          } else {
            down += amount;
          }
        }
      }

      if (locked.length === 0) continue;

      let upTxHash: string | null = null;
      let downTxHash: string | null = null;

      try {
        await this.ensureApproval(market);

        if (up > 0n) {
          const tx = await this.enterOption(market, OPTION_UP, up);
          console.log(`[Settlement] enterOption(UP, ${up}) on ${market} tx=${tx.hash}`);
          const receipt = await tx.wait();
          if (!receipt || receipt.status !== 1) {
            throw new Error('enterOption UP receipt failed');
          }
          upTxHash = receipt.hash;
        }
        if (down > 0n) {
          const tx = await this.enterOption(market, OPTION_DOWN, down);
          console.log(`[Settlement] enterOption(DOWN, ${down}) on ${market} tx=${tx.hash}`);
          const receipt = await tx.wait();
          if (!receipt || receipt.status !== 1) {
            throw new Error('enterOption DOWN receipt failed');
          }
          downTxHash = receipt.hash;
        }

        for (const t of locked) {
          const hash = t.option === OPTION_UP ? upTxHash : downTxHash;
          await TradeModel.updateOne(
            { tradeId: t.tradeId },
            {
              $set: {
                settlementStatus: 'CONFIRMED',
                settlementTxHash: hash,
              },
            }
          );
        }
      } catch (err) {
        console.error(`[Settlement] Failed to settle for market ${market}:`, err);
        for (const t of locked) {
          const prevRetries = t.settlementRetryCount ?? 0;
          const nextRetries = prevRetries + 1;
          const failed = nextRetries >= MAX_SETTLEMENT_RETRIES;
          await TradeModel.updateOne(
            { tradeId: t.tradeId },
            {
              $set: {
                settlementStatus: failed ? 'FAILED' : 'PENDING',
                settlementRetryCount: nextRetries,
                settlementNextRetryAt: failed
                  ? null
                  : new Date(Date.now() + settlementBackoffMs(nextRetries)),
              },
            }
          );
          if (failed) {
            const treasury = (
              config.feeTreasuryAddress || this.relayer.address
            ).toLowerCase();
            const ok = await reverseSettledFill(
              t.buyer,
              t.seller,
              treasury,
              BigInt(t.amount),
              BigInt(t.platformFee),
              BigInt(t.makerFee)
            );
            if (!ok) {
              console.error(
                `[Settlement] reverseSettledFill failed for FAILED trade ${t.tradeId}; manual reconciliation required`
              );
            }
          }
        }
      }
    }
  }

  private async enterOption(
    poolAddress: string,
    option: number,
    amount: bigint
  ): Promise<ethers.TransactionResponse> {
    const pool = new ethers.Contract(poolAddress, TradePoolAbi, this.relayer);
    return pool.enterOption(option, amount);
  }

  private async ensureApproval(poolAddress: string): Promise<void> {
    if (this.approvedPools.has(poolAddress)) return;

    const usdt = new ethers.Contract(config.usdtAddress, ERC20Abi, this.relayer);
    const allowance: bigint = await usdt.allowance(this.relayer.address, poolAddress);

    if (allowance < MAX_UINT256 / 2n) {
      const tx = await usdt.approve(poolAddress, MAX_UINT256);
      await tx.wait();
      console.log(`[Settlement] Approved USDT for pool ${poolAddress}`);
    }

    this.approvedPools.add(poolAddress);
  }
}
