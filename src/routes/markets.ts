import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { config } from '../config';
import { MarketModel } from '../models/Market';
import { TradeModel } from '../models/Trade';
import { OrderBookManager } from '../engine/OrderBook';
import type { OrderBookSnapshot } from '../engine/types';
import type { ClaimService } from '../services/ClaimService';
import { parsePairQueryParam } from '../lib/pairs';
import { enrichMarketLean } from '../lib/marketResponse';

function authorizeClaim(req: Request, relayerAddress: string, marketAddress: string): boolean {
  const admin = config.claimAdminApiKey;
  if (admin && req.header('x-updown-admin-key') === admin) return true;
  const sig = req.body?.signature;
  if (!sig || typeof sig !== 'string') return false;
  const msg = `updown:claim:${marketAddress.toLowerCase()}:${config.chainId}`;
  try {
    return ethers.verifyMessage(msg, sig).toLowerCase() === relayerAddress.toLowerCase();
  } catch {
    return false;
  }
}

const ALLOWED_TIMEFRAMES = new Set([300, 900, 3600]);

function bestBidAsk(snapshot: OrderBookSnapshot): {
  bestBid: { price: number; depth: string } | null;
  bestAsk: { price: number; depth: string } | null;
} {
  const bid = snapshot.bids[0];
  const ask = snapshot.asks[0];
  return {
    bestBid: bid ? { price: bid.price, depth: bid.depth } : null,
    bestAsk: ask ? { price: ask.price, depth: ask.depth } : null,
  };
}

export function createMarketsRouter(
  books: OrderBookManager,
  claimService: ClaimService,
  relayerAddress: string
): Router {
  const router = Router();

  router.get('/', async (req: Request, res: Response) => {
    try {
      const rawTf = req.query.timeframe;
      let durationFilter: number | undefined;

      if (rawTf !== undefined && rawTf !== '') {
        const n = typeof rawTf === 'string' ? parseInt(rawTf, 10) : Number(rawTf);
        if (!ALLOWED_TIMEFRAMES.has(n)) {
          res.status(400).json({
            error: 'Invalid timeframe',
            allowed: [300, 900, 3600],
          });
          return;
        }
        durationFilter = n;
      }

      const rawPair = typeof req.query.pair === 'string' ? req.query.pair : undefined;
      const pairSymbol = parsePairQueryParam(rawPair);
      if (rawPair !== undefined && rawPair !== '' && pairSymbol === undefined) {
        res.status(400).json({
          error: 'Invalid pair',
          allowed: ['BTC-USD', 'ETH-USD', 'btc-usd', 'eth-usd'],
        });
        return;
      }

      const filter: Record<string, unknown> = {
        status: { $in: ['ACTIVE', 'TRADING_ENDED', 'RESOLVED'] },
      };
      if (durationFilter !== undefined) {
        filter.duration = durationFilter;
      }
      if (pairSymbol !== undefined) {
        filter.$or = [{ pairSymbol }, { pairId: pairSymbol }];
      }

      const markets = await MarketModel.find(filter).sort({ endTime: -1 }).lean();

      const result = markets.map((m) =>
        enrichMarketLean({
          address: m.address,
          pairId: m.pairId,
          pairSymbol: m.pairSymbol,
          pairIdHex: m.pairIdHex,
          startTime: m.startTime,
          endTime: m.endTime,
          duration: m.duration,
          status: m.status,
          winner: m.winner,
          upPrice: m.upPrice,
          downPrice: m.downPrice,
          strikePrice: m.strikePrice ?? '',
          volume: m.volume,
        })
      );

      res.json(result);
    } catch (err) {
      console.error('[Markets] GET error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/:address/claim', async (req: Request, res: Response) => {
    try {
      const addr = (req.params.address as string).toLowerCase();
      if (!authorizeClaim(req, relayerAddress, addr)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      await claimService.processResolvedMarket(addr);
      res.json({ ok: true });
    } catch (err) {
      console.error('[Markets] POST /:address/claim error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/:address', async (req: Request, res: Response) => {
    try {
      const market = await MarketModel.findOne({
        address: (req.params.address as string).toLowerCase(),
      }).lean();

      if (!market) {
        res.status(404).json({ error: 'Market not found' });
        return;
      }

      const trades = await TradeModel.find({ market: market.address });
      let volume = 0n;
      for (const t of trades) {
        volume += BigInt(t.amount);
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const timeRemainingSeconds = Math.max(0, market.endTime - nowSec);

      const snap = books.getMarketSnapshot(market.address);
      const orderBook = {
        up: bestBidAsk(snap.up),
        down: bestBidAsk(snap.down),
      };

      const base = enrichMarketLean({
        ...market,
        volume: market.volume,
      });

      res.json({
        ...base,
        volume: volume.toString(),
        timeRemainingSeconds,
        orderBook,
      });
    } catch (err) {
      console.error('[Markets] GET /:address error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
