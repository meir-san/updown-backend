import { ethers } from 'ethers';
import { config } from '../config';
import { MarketModel } from '../models/Market';
import { OrderBookManager } from '../engine/OrderBook';
import { ClaimService } from './ClaimService';
import type { MatchingEngine } from '../engine/MatchingEngine';
import type { WsServer } from '../ws/WebSocketServer';
import AutoCyclerAbi from '../abis/AutoCycler.json';
import TradePoolAbi from '../abis/TradePool.json';
import { pairSymbolFromPairHash, type PairSymbol } from '../lib/pairs';

const RESOLVER_MARKETS_IFACE = new ethers.Interface([
  'function markets(address pool) view returns (bytes32 pairId, int256 strikePrice, bool resolved)',
]);

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
    if (!config.autocyclerAddress) return;

    const cycler = new ethers.Contract(
      config.autocyclerAddress,
      AutoCyclerAbi,
      this.provider
    );

    const count: bigint = await cycler.activeMarketCount();
    const marketCount = Number(count);

    for (let i = 0; i < marketCount; i++) {
      try {
        const [poolAddr, endTime, pairId] = await cycler.activeMarkets(i);
        await this.syncMarket(poolAddr, Number(endTime), pairId);
      } catch (err) {
        console.error(`[MarketSyncer] Error syncing market at index ${i}:`, err);
      }
    }

    // Check for resolved markets
    const activeMarkets = await MarketModel.find({
      status: { $in: ['ACTIVE', 'TRADING_ENDED'] },
    });

    for (const market of activeMarkets) {
      await this.checkResolution(market.address);
    }
  }

  private async syncMarket(
    poolAddress: string,
    endTime: number,
    pairId: string
  ): Promise<void> {
    const normalized = poolAddress.toLowerCase();
    const pool = new ethers.Contract(poolAddress, TradePoolAbi, this.provider);

    let startTime: number;
    let upPrice = '0';
    let downPrice = '0';

    try {
      startTime = Number(await pool.startTime());
    } catch {
      startTime = Math.floor(Date.now() / 1000);
    }

    try {
      const upPriceRaw: bigint = await pool.getCurrentPrice(1);
      const downPriceRaw: bigint = await pool.getCurrentPrice(2);
      upPrice = upPriceRaw.toString();
      downPrice = downPriceRaw.toString();
    } catch {
      // Pool may not have prices yet
    }

    let strikePrice = '';
    try {
      const resolverAddr: string = await pool.resolver();
      if (resolverAddr && resolverAddr !== ethers.ZeroAddress) {
        const resolver = new ethers.Contract(resolverAddr, RESOLVER_MARKETS_IFACE, this.provider);
        const row = await resolver.markets(poolAddress);
        strikePrice = row.strikePrice.toString();
      }
    } catch {
      // Resolver missing or markets() not available
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
        pairId: pairLabel,
        pairSymbol: pairSymbol === 'OTHER' ? undefined : pairSymbol,
        endTime,
        duration: endTime - startTime,
        strikePrice,
      });
    }

    // Initialize order books
    this.books.getOrCreate(normalized, 1);
    this.books.getOrCreate(normalized, 2);
  }

  private async checkResolution(marketAddress: string): Promise<void> {
    try {
      const pool = new ethers.Contract(marketAddress, TradePoolAbi, this.provider);
      const finalized: boolean = await pool.poolFinalized();

      if (finalized) {
        const winner = Number(await pool.winner());
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
    } catch (err) {
      // Pool may not be in a state to check yet
    }
  }
}
