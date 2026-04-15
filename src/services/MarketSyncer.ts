import { ethers } from 'ethers';
import { config } from '../config';
import { MarketModel } from '../models/Market';
import { OrderBookManager } from '../engine/OrderBook';
import { ClaimService } from './ClaimService';
import type { MatchingEngine } from '../engine/MatchingEngine';
import type { WsServer } from '../ws/WebSocketServer';
import AutoCyclerAbi from '../abis/AutoCycler.json';
import UpDownSettlementAbi from '../abis/UpDownSettlement.json';
import { pairSymbolFromPairHash, type PairSymbol } from '../lib/pairs';
import { compositeMarketAddress, parseCompositeMarketKey } from '../lib/marketKey';

/**
 * Polls the UpDownAutoCycler contract for active markets.
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
    if (!config.autocyclerAddress || !config.settlementAddress || config.settlementAddress === ethers.ZeroAddress) {
      return;
    }

    const cycler = new ethers.Contract(
      config.autocyclerAddress,
      AutoCyclerAbi,
      this.provider
    );

    const settlement = new ethers.Contract(
      config.settlementAddress,
      UpDownSettlementAbi,
      this.provider
    );

    const count: bigint = await cycler.activeMarketCount();
    const marketCount = Number(count);

    for (let i = 0; i < marketCount; i++) {
      try {
        const [marketIdBn, endTime, pairId] = await cycler.activeMarkets(i);
        await this.syncMarket(settlement, marketIdBn, Number(endTime), pairId);
      } catch (err) {
        console.error(`[MarketSyncer] Error syncing market at index ${i}:`, err);
      }
    }

    // Check for resolved markets
    const activeMarkets = await MarketModel.find({
      status: { $in: ['ACTIVE', 'TRADING_ENDED'] },
    });

    for (const market of activeMarkets) {
      const mid =
        market.marketId ?? parseCompositeMarketKey(market.address)?.marketId;
      if (!mid) continue;
      await this.checkResolution(settlement, market.address, mid);
    }
  }

  private async syncMarket(
    settlement: ethers.Contract,
    marketIdBn: bigint,
    endTime: number,
    pairId: string
  ): Promise<void> {
    const settlementLower = config.settlementAddress.toLowerCase();
    const marketIdStr = marketIdBn.toString();
    const normalized = compositeMarketAddress(settlementLower, marketIdStr);

    let startTime = Math.floor(Date.now() / 1000);
    let upPrice = '0';
    let downPrice = '0';
    let strikePrice = '';

    try {
      const m = await settlement.markets(marketIdBn);
      startTime = Number(m.startTime);
      upPrice = (m.upTotal as bigint).toString();
      downPrice = (m.downTotal as bigint).toString();
      strikePrice = (m.strikePrice as bigint).toString();
    } catch {
      // Market row may not exist yet
    }

    const now = Math.floor(Date.now() / 1000);
    let status = 'ACTIVE';
    if (now > endTime) {
      status = 'TRADING_ENDED';
    }

    const pairIdHex = ethers.zeroPadValue(pairId as `0x${string}`, 32).toLowerCase();
    const symResolved = pairSymbolFromPairHash(pairIdHex);
    const pairSymbol: PairSymbol | 'OTHER' =
      symResolved === 'BTC-USD' || symResolved === 'ETH-USD' ? symResolved : 'OTHER';
    const pairLabel = pairSymbol === 'OTHER' ? pairIdHex : pairSymbol;

    const prior = await MarketModel.findOne({ address: normalized }).select('address status').lean();
    const prevStatus = prior?.status as string | undefined;

    await MarketModel.findOneAndUpdate(
      { address: normalized },
      {
        address: normalized,
        marketId: marketIdStr,
        settlementAddress: settlementLower,
        pairId: pairLabel,
        pairSymbol: pairSymbol === 'OTHER' ? undefined : pairSymbol,
        pairIdHex,
        startTime,
        endTime,
        duration: endTime - startTime,
        status,
        upPrice,
        downPrice,
        strikePrice,
      },
      { upsert: true, new: true }
    );

    if (status === 'TRADING_ENDED' && prevStatus === 'ACTIVE') {
      await this.engine.cancelAllRestingAndPendingForMarket(normalized);
    }

    if (!prior) {
      this.ws?.broadcastMarketEvent('market_created', {
        address: normalized,
        marketId: marketIdStr,
        pairId: pairLabel,
        pairSymbol: pairSymbol === 'OTHER' ? undefined : pairSymbol,
        endTime,
        duration: endTime - startTime,
        strikePrice,
      });
    }

    this.books.getOrCreate(normalized, 1);
    this.books.getOrCreate(normalized, 2);
  }

  private async checkResolution(
    settlement: ethers.Contract,
    marketAddress: string,
    marketIdStr: string
  ): Promise<void> {
    try {
      const m = await settlement.markets(BigInt(marketIdStr));
      const resolved: boolean = m.resolved;

      if (resolved) {
        const winner = Number(m.winner);
        await MarketModel.updateOne(
          { address: marketAddress.toLowerCase() },
          { status: 'RESOLVED', winner }
        );

        this.ws?.broadcastMarketEvent('market_resolved', {
          address: marketAddress.toLowerCase(),
          winner,
        });

        await this.claimService.processResolvedMarket(marketAddress);
      }
    } catch {
      // Market may not be resolvable yet
    }
  }
}
