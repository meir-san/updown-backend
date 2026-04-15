import { Router, Request, Response } from 'express';
import { generatePrivateKey } from 'viem/accounts';
import { SmartAccountExecutor } from '../services/SmartAccountExecutor';
import { SmartAccountModel } from '../models/SmartAccount';
import { config } from '../config';

export function createSmartAccountRouter(deps: { executor: SmartAccountExecutor }): Router {
  const router = Router();

  router.post('/get-or-create', async (req: Request, res: Response) => {
    try {
      if (!config.alchemyApiKey) {
        res.status(503).json({ error: 'Smart accounts are not configured' });
        return;
      }

      const ownerAddress = typeof req.body?.ownerAddress === 'string' ? req.body.ownerAddress.trim() : '';
      const walletProvider =
        typeof req.body?.walletProvider === 'string' && req.body.walletProvider.trim()
          ? req.body.walletProvider.trim()
          : 'alchemy-light-account';

      if (!ownerAddress || !/^0x[a-fA-F0-9]{40}$/.test(ownerAddress)) {
        res.status(400).json({ error: 'Invalid ownerAddress' });
        return;
      }

      const normalized = ownerAddress.toLowerCase();

      const existing = await SmartAccountModel.findOne({ ownerAddress: normalized });
      if (existing) {
        await SmartAccountModel.updateOne(
          { ownerAddress: normalized },
          { $set: { lastUsed: new Date() } }
        );
        res.json({
          ownerAddress: normalized,
          smartAccountAddress: existing.smartAccountAddress,
          isNew: false,
        });
        return;
      }

      const sessionKey = generatePrivateKey();
      const smartAccountAddress = await deps.executor.getSmartAccountAddress(sessionKey);

      const bal = await deps.executor.getSmartAccountBalance(
        smartAccountAddress,
        config.usdtAddress as `0x${string}`
      );

      await SmartAccountModel.create({
        ownerAddress: normalized,
        sessionKey,
        smartAccountAddress: smartAccountAddress.toLowerCase(),
        walletProvider,
        cachedBalance: bal.toString(),
        inOrders: '0',
        balanceLastSyncedAt: new Date(),
        lastUsed: new Date(),
      });

      res.json({
        ownerAddress: normalized,
        smartAccountAddress: smartAccountAddress.toLowerCase(),
        isNew: true,
      });
    } catch (err) {
      console.error('[SmartAccount] get-or-create error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
