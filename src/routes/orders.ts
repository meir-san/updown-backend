import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { MatchingEngine } from '../engine/MatchingEngine';
import { OrderSide, OrderType } from '../engine/types';
import { verifyOrderSignature, verifyCancelSignature } from '../services/SignatureService';
import { MarketModel } from '../models/Market';
import { OrderModel } from '../models/Order';
import { config } from '../config';
import { parseCompositeMarketKey, compositeMatchesSettlement } from '../lib/marketKey';
import type { DMMService } from '../services/DMMService';
import { createOrderRateLimitMiddleware, tryConsumeBulkOrderRate } from '../middleware/orderRateLimit';

const MAX_BULK = 20;

function parseOrderType(type: unknown): OrderType {
  if (type === 'MARKET' || type === 1) return OrderType.MARKET;
  if (type === 'POST_ONLY' || type === 2) return OrderType.POST_ONLY;
  if (type === 'IOC' || type === 3) return OrderType.IOC;
  return OrderType.LIMIT;
}

function orderTypeLabel(t: OrderType): string {
  switch (t) {
    case OrderType.MARKET:
      return 'MARKET';
    case OrderType.POST_ONLY:
      return 'POST_ONLY';
    case OrderType.IOC:
      return 'IOC';
    default:
      return 'LIMIT';
  }
}

async function verifyAndSubmitSingle(
  engine: MatchingEngine,
  body: Record<string, unknown>
): Promise<{ ok: true; order: Awaited<ReturnType<MatchingEngine['submitOrder']>> } | { ok: false; error: string }> {
  const { maker, market, option, side, type, price, amount, nonce, expiry, signature } = body;

  if (!maker || !market || option == null || side == null || amount == null || amount === '' || !signature) {
    return { ok: false, error: 'Missing required fields' };
  }

  let amountBi: bigint;
  try {
    amountBi = BigInt(String(amount));
  } catch {
    return { ok: false, error: 'Invalid amount' };
  }
  if (amountBi <= 0n) {
    return { ok: false, error: 'Amount must be positive' };
  }

  if (option !== 1 && option !== 2) {
    return { ok: false, error: 'Option must be 1 (UP) or 2 (DOWN)' };
  }

  const sideEnum: OrderSide = side === 'BUY' || side === 0 ? OrderSide.BUY : OrderSide.SELL;
  const typeEnum = parseOrderType(type);

  if (
    typeEnum === OrderType.LIMIT ||
    typeEnum === OrderType.POST_ONLY ||
    typeEnum === OrderType.IOC
  ) {
    const p = price == null ? NaN : Number(price);
    if (Number.isNaN(p) || p < 1 || p > 9999) {
      return { ok: false, error: 'Limit-class orders require price between 1 and 9999 (basis points)' };
    }
  }

  const marketStr = String(market).toLowerCase();
  const parsed = parseCompositeMarketKey(marketStr);
  if (!parsed) {
    return { ok: false, error: 'Invalid market key (expected settlementAddress-marketId)' };
  }
  if (!compositeMatchesSettlement(parsed, config.settlementAddress)) {
    return { ok: false, error: 'Market settlement mismatch' };
  }

  const marketDoc = await MarketModel.findOne({
    address: marketStr,
    status: 'ACTIVE',
  });
  if (!marketDoc) {
    return { ok: false, error: 'Market not found or not active' };
  }

  const valid = verifyOrderSignature(
    {
      maker: String(maker),
      marketId: parsed.marketId,
      option: Number(option),
      side: sideEnum,
      type: typeEnum,
      price: price == null ? 0 : Number(price),
      amount: String(amount),
      nonce: nonce == null ? 0 : Number(nonce),
      expiry: expiry == null ? 0 : Number(expiry),
    },
    String(signature)
  );

  if (!valid) {
    return { ok: false, error: 'Invalid signature' };
  }

  try {
    const order = await engine.submitOrder({
      maker: String(maker),
      market: marketStr,
      option: Number(option),
      side: sideEnum,
      type: typeEnum,
      price: price == null ? 0 : Number(price),
      amount: String(amount),
      nonce: nonce == null ? 0 : Number(nonce),
      expiry: expiry == null ? 0 : Number(expiry),
      signature: String(signature),
    });
    return { ok: true, order };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'submit failed';
    return { ok: false, error: msg };
  }
}

export function createOrdersRouter(engine: MatchingEngine, dmmService: DMMService): Router {
  const router = Router();
  const orderLimit = createOrderRateLimitMiddleware(dmmService);

  router.post('/', orderLimit, async (req: Request, res: Response) => {
    const r = await verifyAndSubmitSingle(engine, req.body);
    if (!r.ok) {
      const code =
        r.error === 'Insufficient balance' || r.error.includes('POST_ONLY')
          ? 400
          : r.error === 'Invalid signature'
            ? 401
            : 400;
      res.status(code).json({ error: r.error });
      return;
    }
    const order = r.order;
    res.status(201).json({
      id: order.id,
      status: order.status,
      market: order.market,
      option: order.option,
      side: order.side === OrderSide.BUY ? 'BUY' : 'SELL',
      type: orderTypeLabel(order.type),
      price: order.price,
      amount: order.amount.toString(),
      createdAt: order.createdAt,
    });
  });

  router.post('/bulk', async (req: Request, res: Response) => {
    try {
      const { orders } = req.body ?? {};
      if (!Array.isArray(orders) || orders.length === 0) {
        res.status(400).json({ error: 'orders array required' });
        return;
      }
      if (orders.length > MAX_BULK) {
        res.status(400).json({ error: `At most ${MAX_BULK} orders per bulk request` });
        return;
      }
      const okRate = await tryConsumeBulkOrderRate(orders, dmmService);
      if (!okRate) {
        res.status(429).json({ error: 'Order rate limit exceeded' });
        return;
      }

      const results: Array<{ ok: boolean; error?: string; order?: unknown }> = [];
      for (let i = 0; i < orders.length; i++) {
        const r = await verifyAndSubmitSingle(engine, orders[i] as Record<string, unknown>);
        if (r.ok) {
          const order = r.order;
          results.push({
            ok: true,
            order: {
              id: order.id,
              status: order.status,
              market: order.market,
              option: order.option,
              side: order.side === OrderSide.BUY ? 'BUY' : 'SELL',
              type: orderTypeLabel(order.type),
              price: order.price,
              amount: order.amount.toString(),
              createdAt: order.createdAt,
            },
          });
        } else {
          results.push({ ok: false, error: r.error });
        }
      }
      res.status(200).json({ results });
    } catch (err) {
      console.error('[Orders] bulk error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.delete('/market/:marketAddress', orderLimit, async (req: Request, res: Response) => {
    try {
      const market = (req.params.marketAddress as string).toLowerCase();
      const { maker, signature } = req.body ?? {};
      if (!maker || !signature) {
        res.status(400).json({ error: 'Missing maker or signature' });
        return;
      }
      const makerLower = String(maker).toLowerCase();
      const isDmm = await dmmService.resolveIsDmm(makerLower);
      if (!isDmm) {
        res.status(403).json({ error: 'DMM only' });
        return;
      }
      const msg = `updown:cancelAllOrders:${market}:${config.chainId}`;
      let recovered: string;
      try {
        recovered = ethers.verifyMessage(msg, String(signature)).toLowerCase();
      } catch {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
      if (recovered !== makerLower) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      const t0 = performance.now();
      await engine.cancelAllRestingAndPendingForMarketAndWallet(market, makerLower);
      const ms = performance.now() - t0;
      res.json({ ok: true, cancelledMs: ms });
    } catch (err) {
      console.error('[Orders] kill-switch error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.delete('/:id', orderLimit, async (req: Request, res: Response) => {
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
