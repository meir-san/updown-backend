import { ethers } from 'ethers';
import { config, OPTION_UP, OPTION_DOWN } from '../config';
import { TradeModel, ITrade } from '../models/Trade';
import { reverseSettledFill } from '../models/Balance';
import { parseCompositeMarketKey } from '../lib/marketKey';
import { SmartAccountModel } from '../models/SmartAccount';
import type { SmartAccountExecutor } from './SmartAccountExecutor';

const MAX_SETTLEMENT_RETRIES = 5;

function settlementBackoffMs(nextRetryCount: number): number {
  return Math.min(32_000, 1000 * Math.pow(2, Math.max(0, nextRetryCount - 1)));
}

/**
 * Batches matched trades and enters aggregate positions on-chain per (market, buyer)
 * via each buyer's Modular Account V2 scoped session (UserOp enterPosition; grant covers USDT).
 */
export class SettlementService {
  private provider: ethers.JsonRpcProvider;
  private relayer: ethers.Wallet;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly executor: SmartAccountExecutor | null;
  private readonly onBuyerSettled?: (buyer: string) => void | Promise<void>;

  constructor(
    provider: ethers.JsonRpcProvider,
    executor: SmartAccountExecutor | null,
    onBuyerSettled?: (buyer: string) => void | Promise<void>
  ) {
    this.provider = provider;
    this.relayer = new ethers.Wallet(config.relayerPrivateKey, provider);
    this.executor = executor;
    this.onBuyerSettled = onBuyerSettled;
  }

  get relayerAddress(): string {
    return this.relayer.address;
  }

  start(): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => {
      this.settleBatch().catch((err) => console.error('[Settlement] batch error:', err));
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
    if (!this.executor) {
      return;
    }

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
      const byBuyer = new Map<string, ITrade[]>();
      for (const t of trades) {
        const k = t.buyer.toLowerCase();
        const list = byBuyer.get(k) ?? [];
        list.push(t);
        byBuyer.set(k, list);
      }

      for (const [buyer, buyerTrades] of byBuyer) {
        const locked: ITrade[] = [];
        let up = 0n;
        let down = 0n;

        for (const t of buyerTrades) {
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

        let lastTxHash: string | null = null;

        try {
          const marketId = this.parseMarketIdFromTradeMarket(market);
          const sa = await SmartAccountModel.findOne({ ownerAddress: buyer }).lean();
          if (!sa) {
            throw new Error(`No smart account for buyer ${buyer}`);
          }
          if (!sa.sessionPermissionsContext || !sa.smartAccountAddress) {
            throw new Error(`Smart account for buyer ${buyer} is missing scoped session; POST /api/smart-account/register`);
          }

          const settlementSession = {
            smartAccountAddress: sa.smartAccountAddress,
            sessionPermissionsContext: sa.sessionPermissionsContext,
          };

          if (up > 0n) {
            const h = await this.executor.enterPosition(
              sa.sessionKey,
              marketId,
              OPTION_UP,
              up,
              settlementSession
            );
            console.log(`[Settlement] enterPosition UP buyer=${buyer} amount=${up} tx=${h}`);
            lastTxHash = h;
          }
          if (down > 0n) {
            const h = await this.executor.enterPosition(
              sa.sessionKey,
              marketId,
              OPTION_DOWN,
              down,
              settlementSession
            );
            console.log(`[Settlement] enterPosition DOWN buyer=${buyer} amount=${down} tx=${h}`);
            lastTxHash = h;
          }

          for (const t of locked) {
            await TradeModel.updateOne(
              { tradeId: t.tradeId },
              {
                $set: {
                  settlementStatus: 'CONFIRMED',
                  settlementTxHash: lastTxHash,
                },
              }
            );
          }

          await this.onBuyerSettled?.(buyer);
        } catch (err) {
          console.error(`[Settlement] Failed to settle for market ${market} buyer ${buyer}:`, err);
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
  }
}
