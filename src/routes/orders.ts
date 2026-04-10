import { Router, Request, Response } from 'express';
import { MatchingEngine } from '../engine/MatchingEngine';
import { OrderSide, OrderType } from '../engine/types';
import { verifyOrderSignature, verifyCancelSignature } from '../services/SignatureService';
import { MarketModel } from '../models/Market';
import { OrderModel } from '../models/Order';
import { ordersWriteLimiter } from '../middleware/rateLimit';

export function createOrdersRouter(engine: MatchingEngine): Router {
  const router = Router();

  router.post('/', ordersWriteLimiter, async (req: Request, res: Response) => {
    try {
      const { maker, market, option, side, type, price, amount, nonce, expiry, signature } =
        req.body;

      if (!maker || !market || option == null || side == null || amount == null || amount === '' || !signature) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
      }

      let amountBi: bigint;
      try {
        amountBi = BigInt(amount);
      } catch {
        res.status(400).json({ error: 'Invalid amount' });
        return;
      }
      if (amountBi <= 0n) {
        res.status(400).json({ error: 'Amount must be positive' });
        return;
      }

      if (option !== 1 && option !== 2) {
        res.status(400).json({ error: 'Option must be 1 (UP) or 2 (DOWN)' });
        return;
      }

      const sideEnum: OrderSide = side === 'BUY' || side === 0 ? OrderSide.BUY : OrderSide.SELL;
      const typeEnum: OrderType =
        type === 'MARKET' || type === 1 ? OrderType.MARKET : OrderType.LIMIT;

      if (typeEnum === OrderType.LIMIT && (price == null || price < 1 || price > 9999)) {
        res.status(400).json({ error: 'Limit orders require price between 1 and 9999 (basis points)' });
        return;
      }

      // Verify market exists and is active
      const marketDoc = await MarketModel.findOne({
        address: market.toLowerCase(),
        status: 'ACTIVE',
      });
      if (!marketDoc) {
        res.status(400).json({ error: 'Market not found or not active' });
        return;
      }

      // Verify EIP-712 signature
      const valid = verifyOrderSignature(
        {
          maker,
          market,
          option,
          side: sideEnum,
          type: typeEnum,
          price: price ?? 0,
          amount,
          nonce: nonce ?? 0,
          expiry: expiry ?? 0,
        },
        signature
      );

      if (!valid) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      const order = await engine.submitOrder({
        maker,
        market,
        option,
        side: sideEnum,
        type: typeEnum,
        price: price ?? 0,
        amount,
        nonce: nonce ?? 0,
        expiry: expiry ?? 0,
        signature,
      });

      res.status(201).json({
        id: order.id,
        status: order.status,
        market: order.market,
        option: order.option,
        side: order.side === OrderSide.BUY ? 'BUY' : 'SELL',
        type: order.type === OrderType.LIMIT ? 'LIMIT' : 'MARKET',
        price: order.price,
        amount: order.amount.toString(),
        createdAt: order.createdAt,
      });
    } catch (err: any) {
      if (err.message === 'Insufficient balance') {
        res.status(400).json({ error: 'Insufficient balance' });
        return;
      }
      console.error('[Orders] POST error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.delete('/:id', ordersWriteLimiter, async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const { maker, signature } = req.body;

      if (!maker || !signature) {
        res.status(400).json({ error: 'Missing maker or signature' });
        return;
      }

      const order = await OrderModel.findOne({ orderId: id });
      if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
      }

      if (order.maker !== maker.toLowerCase()) {
        res.status(403).json({ error: 'Not the order maker' });
        return;
      }

      if (order.status === 'CANCELLED' || order.status === 'FILLED') {
        res.status(400).json({ error: `Order already ${order.status.toLowerCase()}` });
        return;
      }

      const valid = verifyCancelSignature(maker as string, id, signature as string);
      if (!valid) {
        res.status(401).json({ error: 'Invalid cancel signature' });
        return;
      }

      engine.submitCancel(id, maker as string);
      res.json({ id, status: 'CANCEL_PENDING' });
    } catch (err) {
      console.error('[Orders] DELETE error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
