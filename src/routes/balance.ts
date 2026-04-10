import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { config } from '../config';
import { getOrCreateBalance, applyWithdrawalAccounting } from '../models/Balance';
import { verifyWithdrawSignature } from '../services/SignatureService';
import ERC20Abi from '../abis/ERC20.json';

export function createBalanceRouter(
  provider: ethers.JsonRpcProvider,
  relayerWallet: ethers.Wallet
): Router {
  const router = Router();

  router.get('/:wallet', async (req: Request, res: Response) => {
    try {
      const bal = await getOrCreateBalance(req.params.wallet as string);
      res.json({
        wallet: bal.wallet,
        available: bal.available,
        inOrders: bal.inOrders,
        totalDeposited: bal.totalDeposited,
        totalWithdrawn: bal.totalWithdrawn,
        withdrawNonce: bal.withdrawNonce,
      });
    } catch (err) {
      console.error('[Balance] GET error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/withdraw', async (req: Request, res: Response) => {
    try {
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

      const bal = await getOrCreateBalance(wallet);

      const valid = verifyWithdrawSignature(wallet, amount, bal.withdrawNonce, signature);
      if (!valid) {
        res.status(401).json({ error: 'Invalid withdrawal signature' });
        return;
      }

      const available = BigInt(bal.available);

      if (available < withdrawAmount) {
        res.status(400).json({ error: 'Insufficient available balance' });
        return;
      }

      const usdt = new ethers.Contract(config.usdtAddress, ERC20Abi, relayerWallet);
      const tx = await usdt.transfer(wallet, withdrawAmount);
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) {
        res.status(502).json({ error: 'On-chain transfer failed' });
        return;
      }

      const ok = await applyWithdrawalAccounting(wallet, withdrawAmount);
      if (!ok) {
        console.error('[Balance] Withdraw transfer succeeded but accounting update failed', {
          wallet,
          amount: withdrawAmount.toString(),
          txHash: receipt.hash,
        });
        res.status(500).json({ error: 'Transfer confirmed but balance update failed; contact support' });
        return;
      }

      const after = await getOrCreateBalance(wallet);

      res.json({
        txHash: receipt.hash,
        amount: withdrawAmount.toString(),
        newAvailable: after.available,
      });
    } catch (err) {
      console.error('[Balance] POST /withdraw error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
