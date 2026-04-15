import { ethers } from 'ethers';
import { config, MAX_UINT256, OPTION_UP, OPTION_DOWN } from '../config';
import { TradeModel, ITrade } from '../models/Trade';
import { reverseSettledFill } from '../models/Balance';
import UpDownSettlementAbi from '../abis/UpDownSettlement.json';
import ERC20Abi from '../abis/ERC20.json';
import { parseCompositeMarketKey } from '../lib/marketKey';

const MAX_SETTLEMENT_RETRIES = 5;

function settlementBackoffMs(nextRetryCount: number): number {
  return Math.min(32_000, 1000 * Math.pow(2, Math.max(0, nextRetryCount - 1)));
}

/**
 * Batches matched trades and enters aggregate positions on-chain
 * via the relayer wallet calling enterPosition on UpDownSettlement.
 */
export class SettlementService {
  private provider: ethers.JsonRpcProvider;
  private relayer: ethers.Wallet;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private usdtApprovedForSettlement = false;

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

  private parseMarketIdFromTradeMarket(market: string): bigint {
    const p = parseCompositeMarketKey(market);
    if (!p) throw new Error(`Invalid market key for settlement: ${market}`);
    return BigInt(p.marketId);
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
        await this.ensureApproval();

        const marketId = this.parseMarketIdFromTradeMarket(market);

        if (up > 0n) {
          const tx = await this.enterPosition(marketId, OPTION_UP, up);
          console.log(`[Settlement] enterPosition(UP, ${up}) marketId=${marketId} tx=${tx.hash}`);
          const receipt = await tx.wait();
          if (!receipt || receipt.status !== 1) {
            throw new Error('enterPosition UP receipt failed');
          }
          upTxHash = receipt.hash;
        }
        if (down > 0n) {
          const tx = await this.enterPosition(marketId, OPTION_DOWN, down);
          console.log(`[Settlement] enterPosition(DOWN, ${down}) marketId=${marketId} tx=${tx.hash}`);
          const receipt = await tx.wait();
          if (!receipt || receipt.status !== 1) {
            throw new Error('enterPosition DOWN receipt failed');
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

  private async enterPosition(
    marketId: bigint,
    option: number,
    amount: bigint
  ): Promise<ethers.TransactionResponse> {
    const settlement = new ethers.Contract(
      config.settlementAddress,
      UpDownSettlementAbi,
      this.relayer
    );
    return settlement.enterPosition(marketId, option, amount);
  }

  private async ensureApproval(): Promise<void> {
    if (this.usdtApprovedForSettlement) return;

    const usdt = new ethers.Contract(config.usdtAddress, ERC20Abi, this.relayer);
    const allowance: bigint = await usdt.allowance(this.relayer.address, config.settlementAddress);

    if (allowance < MAX_UINT256 / 2n) {
      const tx = await usdt.approve(config.settlementAddress, MAX_UINT256);
      await tx.wait();
      console.log(`[Settlement] Approved USDT for settlement ${config.settlementAddress}`);
    }

    this.usdtApprovedForSettlement = true;
  }
}
