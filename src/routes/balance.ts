import { Router, Request, Response } from 'express';
import { SmartAccountModel } from '../models/SmartAccount';
import type { SmartAccountExecutor } from '../services/SmartAccountExecutor';
import type { SmartAccountBalanceSync } from '../services/SmartAccountBalanceSync';

export function createBalanceRouter(deps: {
  executor: SmartAccountExecutor | null;
  balanceSync: SmartAccountBalanceSync;
}): Router {
  const router = Router();

  router.get('/:wallet', async (req: Request, res: Response) => {
    try {
      const wallet = (req.params.wallet as string).toLowerCase();
      const refresh = req.query.refresh === '1' || req.query.refresh === 'true';

      if (refresh && deps.executor) {
        await deps.balanceSync.refreshOwner(wallet);
      }

      const sa = await SmartAccountModel.findOne({ ownerAddress: wallet }).lean();
      if (!sa) {
        res.status(404).json({ error: 'Smart account not found; call POST /api/smart-account/register first' });
        return;
      }

      const cached = BigInt(sa.cachedBalance || '0');
      const inOrd = BigInt(sa.inOrders || '0');
      const available = (cached - inOrd).toString();

      res.json({
        wallet,
        smartAccountAddress: sa.smartAccountAddress,
        available,
        inOrders: sa.inOrders,
        cachedBalance: sa.cachedBalance,
        balanceLastSyncedAt: sa.balanceLastSyncedAt ?? null,
        withdrawNonce: sa.withdrawNonce,
      });
    } catch (err) {
      console.error('[Balance] GET error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
