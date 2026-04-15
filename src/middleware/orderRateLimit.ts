import type { Request, Response, NextFunction } from 'express';
import type { DMMService } from '../services/DMMService';

type BucketRow = { sec: number; count: number };

function createBuckets() {
  const usage = new Map<string, BucketRow>();
  return {
    async tryConsume(
      maker: string,
      cost: number,
      resolveIsDmm: (w: string) => Promise<boolean>
    ): Promise<boolean> {
      if (cost <= 0) return true;
      const lim = (await resolveIsDmm(maker.toLowerCase())) ? 100 : 10;
      const sec = Math.floor(Date.now() / 1000);
      const k = maker.toLowerCase();
      let row = usage.get(k);
      if (!row || row.sec !== sec) {
        row = { sec, count: 0 };
      }
      if (row.count + cost > lim) return false;
      row.count += cost;
      usage.set(k, row);
      return true;
    },
  };
}

const globalBuckets = createBuckets();

export async function tryConsumeOrderRate(
  maker: string,
  cost: number,
  dmm: DMMService
): Promise<boolean> {
  return globalBuckets.tryConsume(maker, cost, (w) => dmm.resolveIsDmm(w));
}

/** Per-second order budget keyed by maker (10/s or 100/s for DMMs). */
export function createOrderRateLimitMiddleware(dmm: DMMService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const cost = 1;
    const maker = (req.body?.maker as string | undefined)?.toLowerCase();
    if (!maker) {
      res.status(400).json({ error: 'maker is required' });
      return;
    }
    const ok = await tryConsumeOrderRate(maker, cost, dmm);
    if (!ok) {
      res.status(429).json({ error: 'Order rate limit exceeded' });
      return;
    }
    next();
  };
}

export async function tryConsumeBulkOrderRate(
  orders: Array<{ maker?: string }>,
  dmm: DMMService
): Promise<boolean> {
  const groups = new Map<string, number>();
  for (const o of orders) {
    const m = typeof o.maker === 'string' ? o.maker.toLowerCase() : '';
    if (!m) return false;
    groups.set(m, (groups.get(m) ?? 0) + 1);
  }
  for (const [m, c] of groups) {
    const ok = await tryConsumeOrderRate(m, c, dmm);
    if (!ok) return false;
  }
  return true;
}
