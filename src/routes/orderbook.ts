import { Router, Request, Response } from 'express';
import { OrderBookManager } from '../engine/OrderBook';

export function createOrderBookRouter(books: OrderBookManager): Router {
  const router = Router();

  router.get('/:marketId', (req: Request, res: Response) => {
    try {
      const marketId = req.params.marketId as string;
      const snapshot = books.getMarketSnapshot(marketId.toLowerCase());
      res.json(snapshot);
    } catch (err) {
      console.error('[OrderBook] GET error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
