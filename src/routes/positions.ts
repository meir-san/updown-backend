import { Router, Request, Response } from 'express';
import { TradeModel } from '../models/Trade';
import { MarketModel } from '../models/Market';

export function createPositionsRouter(): Router {
  const router = Router();

  router.get('/:wallet', async (req: Request, res: Response) => {
    try {
      const wallet = (req.params.wallet as string).toLowerCase();

      // Get all trades where this wallet is a buyer
      const buyTrades = await TradeModel.find({ buyer: wallet }).lean();

      // Aggregate positions: per market per option
      const positionMap = new Map<
        string,
        { market: string; option: number; shares: bigint; costBasis: bigint; tradeCount: number }
      >();

      for (const trade of buyTrades) {
        const key = `${trade.market}:${trade.option}`;
        const existing = positionMap.get(key);
        const amount = BigInt(trade.amount);

        if (existing) {
          existing.shares += amount;
          existing.costBasis += amount;
          existing.tradeCount++;
        } else {
          positionMap.set(key, {
            market: trade.market,
            option: trade.option,
            shares: amount,
            costBasis: amount,
            tradeCount: 1,
          });
        }
      }

      // Subtract sold positions
      const sellTrades = await TradeModel.find({ seller: wallet }).lean();
      for (const trade of sellTrades) {
        const key = `${trade.market}:${trade.option}`;
        const existing = positionMap.get(key);
        const amount = BigInt(trade.amount);

        if (existing) {
          existing.shares -= amount;
        }
      }

      const positions = [];
      for (const pos of positionMap.values()) {
        if (pos.shares <= 0n) continue;

        const market = await MarketModel.findOne({ address: pos.market }).lean();
        const avgPrice =
          pos.tradeCount > 0
            ? Number(pos.costBasis) / Number(pos.shares)
            : 0;

        positions.push({
          market: pos.market,
          marketStatus: market?.status ?? 'UNKNOWN',
          option: pos.option,
          optionLabel: pos.option === 1 ? 'UP' : 'DOWN',
          shares: pos.shares.toString(),
          avgPrice: Math.round(avgPrice),
          costBasis: pos.costBasis.toString(),
        });
      }

      res.json(positions);
    } catch (err) {
      console.error('[Positions] GET error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
