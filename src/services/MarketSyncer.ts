import { ethers } from 'ethers';
import { config } from '../config';
import { MarketModel } from '../models/Market';
import { OrderBookManager } from '../engine/OrderBook';
import { ClaimService } from './ClaimService';
import type { MatchingEngine } from '../engine/MatchingEngine';
import type { WsServer } from '../ws/WebSocketServer';
import UpDownSettlementAbi from '../abis/UpDownSettlement.json';
import { pairSymbolFromPairHash, type PairSymbol } from '../lib/pairs';
import { compositeMarketAddress } from '../lib/marketKey';

/**
 * Scans UpDownSettlement for markets via nextMarketId / getMarket.
 * Syncs market metadata to MongoDB.
 * Detects resolved markets and triggers ClaimService.
 */
export class MarketSyncer {
  private provider: ethers.JsonRpcProvider;
  private books: OrderBookManager;
  private claimService: ClaimService;
  private ws: WsServer | null;
  private engine: MatchingEngine;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    provider: ethers.JsonRpcProvider,
    books: OrderBookManager,
    claimService: ClaimService,
    ws: WsServer | null = null,
    engine: MatchingEngine
  ) {
    this.provider = provider;
    this.books = books;
    this.claimService = claimService;
    this.ws = ws;
    this.engine = engine;
  }

  start(): void {
    if (this.intervalHandle) return;
    this.sync().catch((err) => console.error('[MarketSyncer] initial sync error:', err));
    this.intervalHandle = setInterval(() => {
      this.sync().catch((err) => console.error('[MarketSyncer] sync error:', err));
    }, config.marketSyncIntervalMs);
    console.log(`[MarketSyncer] Started (interval=${config.marketSyncIntervalMs}ms)`);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async sync(): Promise<void> {
    if (!config.settlementAddress || config.settlementAddress === ethers.ZeroAddress) {
      return;
    }

    const settlement = new ethers.Contract(
      config.settlementAddress,
      UpDownSettlementAbi,
      this.provider
    );

    // 1. Discover new markets by scanning settlement.nextMarketId()
    await this.discoverNewMarkets(settlement);

    // 2. Update status of known non-final markets
    await this.updateExistingMarkets(settlement);
  }

  private async discoverNewMarkets(settlement: ethers.Contract): Promise<void> {
    const nextId = Number(await settlement.nextMarketId());

    const allDocs = await MarketModel.find().select('marketId').lean();
    const knownIds = new Set(
      allDocs.map((doc) => parseInt(doc.marketId, 10)).filter((n) => !isNaN(n))
    );

    // Start scanning from the lowest known ID (not 1) to skip non-existent ranges
    // from old settlement contracts. If DB is empty, start from 1.
    const minKnown = knownIds.size > 0 ? Math.min(...knownIds) : 1;
    const scanStart = Math.max(1, minKnown);

    const missingIds: number[] = [];
    for (let id = scanStart; id < nextId && missingIds.length < 50; id++) {
      if (!knownIds.has(id)) {
        missingIds.push(id);
      }
    }

    if (missingIds.length === 0) return;

    console.log(
      `[MarketSyncer] Backfilling ${missingIds.length} missing markets (IDs ${missingIds[0]}–${missingIds[missingIds.length - 1]}, known=${knownIds.size}, on-chain=${nextId - 1})`
    );

    for (const id of missingIds) {
      try {
        await this.syncMarketById(settlement, id);
      } catch (err) {
        console.error(`[MarketSyncer] Error syncing market ${id}:`, err);
      }
    }
  }

  private async syncMarketById(settlement: ethers.Contract, id: number): Promise<void> {
    const m = await settlement.getMarket(BigInt(id));

    // Guard: uninitialized market (getMarket returns zero-struct for non-existent IDs)
    const startTime = Number(m.startTime);
    const endTime = Number(m.endTime);
    if (startTime === 0 && endTime === 0) return;

    const settlementLower = config.settlementAddress.toLowerCase();
    const marketIdStr = String(id);
    const normalized = compositeMarketAddress(settlementLower, marketIdStr);

    // Read on-chain data
    const upPrice = (m.totalUp as bigint).toString();
    const downPrice = (m.totalDown as bigint).toString();
    const strikePrice = (m.strikePrice as bigint).toString();
    const settlementPrice = (m.settlementPrice as bigint).toString();
    const duration = endTime - startTime;
    const resolved: boolean = m.resolved;
    const winner = Number(m.winner);

    // Determine status from on-chain state
    const now = Math.floor(Date.now() / 1000);
    let status: string;
    if (resolved) {
      status = 'RESOLVED';
    } else if (now > endTime) {
      status = 'TRADING_ENDED';
    } else {
      status = 'ACTIVE';
    }

    // Resolve pair symbol from on-chain pairId (bytes32 hash)
    const pairIdHex = (m.pairId as string).toLowerCase();
    const symResolved = pairSymbolFromPairHash(pairIdHex);
    const pairSymbol: PairSymbol | 'OTHER' =
      symResolved === 'BTC-USD' || symResolved === 'ETH-USD' ? symResolved : 'OTHER';
    const pairLabel = pairSymbol === 'OTHER' ? pairIdHex : pairSymbol;

    // Check prior document
    const prior = await MarketModel.findOne({ address: normalized }).select('address status').lean();
    const prevStatus = prior?.status as string | undefined;

    // Upsert
    const updateFields: Record<string, unknown> = {
      address: normalized,
      marketId: marketIdStr,
      settlementAddress: settlementLower,
      pairId: pairLabel,
      pairSymbol: pairSymbol === 'OTHER' ? undefined : pairSymbol,
      pairIdHex,
      startTime,
      endTime,
      duration,
      status,
      upPrice,
      downPrice,
      strikePrice,
      settlementPrice,
    };
    // Only set winner if resolved
    if (resolved) {
      updateFields.winner = winner;
    }

    await MarketModel.findOneAndUpdate({ address: normalized }, updateFields, { upsert: true, new: true });

    // Side effects based on status transitions
    if (status === 'TRADING_ENDED' && prevStatus === 'ACTIVE') {
      await this.engine.cancelAllRestingAndPendingForMarket(normalized);
    }

    if (status === 'RESOLVED' && prevStatus !== 'RESOLVED') {
      this.ws?.broadcastMarketEvent('market_resolved', {
        address: normalized,
        winner,
      });
      await this.claimService.processResolvedMarket(normalized);
    }

    if (!prior) {
      this.ws?.broadcastMarketEvent('market_created', {
        address: normalized,
        marketId: marketIdStr,
        pairId: pairLabel,
        pairSymbol: pairSymbol === 'OTHER' ? undefined : pairSymbol,
        endTime,
        duration,
        strikePrice,
      settlementPrice,
      });
    }

    // Ensure order books exist
    this.books.getOrCreate(normalized, 1);
    this.books.getOrCreate(normalized, 2);
  }

  private async updateExistingMarkets(settlement: ethers.Contract): Promise<void> {
    const nonFinalMarkets = await MarketModel.find({
      status: { $in: ['ACTIVE', 'TRADING_ENDED'] },
    });

    for (const market of nonFinalMarkets) {
      const mid = market.marketId;
      if (!mid) continue;
      try {
        await this.syncMarketById(settlement, parseInt(mid, 10));
      } catch (err) {
        console.error(`[MarketSyncer] Error updating market ${mid}:`, err);
      }
    }
  }
}
