import { Router, Request, Response } from 'express';
import { TradeModel } from '../models/Trade';
import { MarketModel } from '../models/Market';

export function createStatsRouter(): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const [volAgg, activeMarketsCount, tradersAgg] = await Promise.all([
        TradeModel.aggregate<{ total: { toString(): string } | null }>([
          {
            $group: {
              _id: null,
              total: { $sum: { $toDecimal: '$amount' } },
            },
          },
        ]),
        MarketModel.countDocuments({ status: 'ACTIVE' }),
        TradeModel.aggregate<{ count?: number }>([
          {
            $project: {
              w: { $concatArrays: [['$buyer'], ['$seller']] },
            },
          },
          { $unwind: '$w' },
          { $group: { _id: '$w' } },
          { $count: 'count' },
        ]),
      ]);

      let totalVolume = '0';
      if (volAgg.length > 0 && volAgg[0].total != null) {
        totalVolume =
          typeof volAgg[0].total === 'object' && 'toString' in volAgg[0].total
            ? volAgg[0].total.toString()
            : String(volAgg[0].total);
      }

      const totalTraders = tradersAgg[0]?.count ?? 0;

      res.json({
        totalVolume,
        activeMarketsCount,
        totalTraders,
      });
    } catch (err) {
      console.error('[Stats] GET error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
