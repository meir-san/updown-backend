import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { config } from '../config';
import type { DMMService } from '../services/DMMService';

function authorizeAdmin(req: Request): boolean {
  const admin = config.claimAdminApiKey;
  return Boolean(admin && req.header('x-updown-admin-key') === admin);
}

export function createDmmRouter(dmm: DMMService): Router {
  const router = Router();

  router.get('/list', (_req: Request, res: Response) => {
    res.json({ dmms: dmm.listKnown() });
  });

  router.get('/rebates/:wallet', async (req: Request, res: Response) => {
    try {
      const w = req.params.wallet as string;
      if (!ethers.isAddress(w)) {
        res.status(400).json({ error: 'Invalid wallet' });
        return;
      }
      const accumulated = await dmm.dmmRebateAccumulated(w);
      res.json({ wallet: w.toLowerCase(), accumulated: accumulated.toString() });
    } catch (e) {
      console.error('[DMM] rebates', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/add', async (req: Request, res: Response) => {
    try {
      if (!authorizeAdmin(req)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const { address } = req.body ?? {};
      if (!address || !ethers.isAddress(String(address))) {
        res.status(400).json({ error: 'Invalid address' });
        return;
      }
      const rec = await dmm.addDMM(String(address));
      res.status(201).json({ ok: true, tx: rec?.hash });
    } catch (e) {
      console.error('[DMM] add', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/remove', async (req: Request, res: Response) => {
    try {
      if (!authorizeAdmin(req)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      const { address } = req.body ?? {};
      if (!address || !ethers.isAddress(String(address))) {
        res.status(400).json({ error: 'Invalid address' });
        return;
      }
      const rec = await dmm.removeDMM(String(address));
      res.json({ ok: true, tx: rec?.hash });
    } catch (e) {
      console.error('[DMM] remove', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
