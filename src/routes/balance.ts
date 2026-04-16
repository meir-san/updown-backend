import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { SmartAccountModel, bumpWithdrawNonce } from '../models/SmartAccount';
import { verifyWithdrawSignature } from '../services/SignatureService';
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
        res.status(404).json({ error: 'Smart account not found; call POST /api/smart-account/get-or-create first' });
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

  router.post('/withdraw', async (req: Request, res: Response) => {
    try {
      if (!deps.executor) {
        res.status(503).json({ error: 'Withdrawals require smart account executor (Alchemy) configuration' });
        return;
      }

      const { wallet, amount, signature } = req.body;

      if (!wallet || !amount || !signature) {
        res.status(400).json({ error: 'Missing wallet, amount, or signature' });
        return;
      }

      let withdrawAmount: bigint;
      try {
        withdrawAmount = BigInt(amount);
      } catch {
        res.status(400).json({ error: 'Invalid amount' });
        return;
      }
      if (withdrawAmount <= 0n) {
        res.status(400).json({ error: 'Amount must be positive' });
        return;
      }

      const w = String(wallet).toLowerCase();
      const sa = await SmartAccountModel.findOne({ ownerAddress: w });
      if (!sa) {
        res.status(404).json({ error: 'Smart account not found' });
        return;
      }

      const valid = verifyWithdrawSignature(wallet, amount, sa.withdrawNonce, signature);
      if (!valid) {
        res.status(401).json({ error: 'Invalid withdrawal signature' });
        return;
      }

      const spendable = BigInt(sa.cachedBalance || '0') - BigInt(sa.inOrders || '0');
      if (spendable < withdrawAmount) {
        res.status(400).json({ error: 'Insufficient available balance' });
        return;
      }

      const to = ethers.getAddress(String(wallet)) as `0x${string}`;
      const txHash = await deps.executor.withdrawFromSmartAccount(sa.sessionKey, to, withdrawAmount);

      await bumpWithdrawNonce(w);
      await deps.balanceSync.refreshOwner(w);

      const after = await SmartAccountModel.findOne({ ownerAddress: w }).lean();

      res.json({
        txHash,
        amount: withdrawAmount.toString(),
        newAvailable: after
          ? (BigInt(after.cachedBalance || '0') - BigInt(after.inOrders || '0')).toString()
          : '0',
      });
    } catch (err) {
      console.error('[Balance] POST /withdraw error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
