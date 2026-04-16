import { Router, Request, Response } from 'express';
import { ethers } from 'ethers';
import { SmartAccountExecutor } from '../services/SmartAccountExecutor';
import { SmartAccountModel } from '../models/SmartAccount';
import { config } from '../config';

const ENTER_POSITION_SELECTOR = ethers.id('enterPosition(uint256,uint8,uint256)').slice(0, 10).toLowerCase();

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const SESSION_KEY_RE = /^0x[a-fA-F0-9]{64}$/;
/** Hex from grantPermissions `context`; even length, non-empty body after 0x. */
const PERMISSIONS_CONTEXT_RE = /^0x[a-fA-F0-9]+$/;

function settlementConfigured(): boolean {
  try {
    return config.settlementAddress.trim() !== '' && config.settlementAddress !== ethers.ZeroAddress;
  } catch {
    return false;
  }
}

export function createSmartAccountRouter(deps: { executor: SmartAccountExecutor | null }): Router {
  const router = Router();

  router.post('/register', async (req: Request, res: Response) => {
    try {
      const ownerRaw = typeof req.body?.ownerAddress === 'string' ? req.body.ownerAddress.trim() : '';
      if (!ownerRaw || !ADDR_RE.test(ownerRaw)) {
        res.status(400).json({ error: 'Invalid ownerAddress' });
        return;
      }

      const saRaw =
        typeof req.body?.smartAccountAddress === 'string' ? req.body.smartAccountAddress.trim() : '';
      if (!saRaw || !ADDR_RE.test(saRaw)) {
        res.status(400).json({ error: 'Invalid smartAccountAddress' });
        return;
      }

      const skRaw = typeof req.body?.sessionKey === 'string' ? req.body.sessionKey.trim() : '';
      if (!skRaw || !SESSION_KEY_RE.test(skRaw)) {
        res.status(400).json({ error: 'Invalid sessionKey' });
        return;
      }

      const expRaw = req.body?.sessionExpiry;
      if (expRaw === undefined || expRaw === null) {
        res.status(400).json({ error: 'sessionExpiry must be a future unix timestamp' });
        return;
      }
      const nowSec = Math.floor(Date.now() / 1000);
      let sessionExpirySec: number;
      if (typeof expRaw === 'number' && Number.isFinite(expRaw)) {
        sessionExpirySec = Math.trunc(expRaw);
      } else if (typeof expRaw === 'string' && expRaw.trim() && /^\d+$/.test(expRaw.trim())) {
        sessionExpirySec = parseInt(expRaw.trim(), 10);
      } else {
        res.status(400).json({ error: 'sessionExpiry must be a future unix timestamp' });
        return;
      }
      if (sessionExpirySec <= nowSec) {
        res.status(400).json({ error: 'sessionExpiry must be a future unix timestamp' });
        return;
      }

      const permRaw =
        typeof req.body?.permissionsContext === 'string' ? req.body.permissionsContext.trim() : '';
      if (!permRaw || !PERMISSIONS_CONTEXT_RE.test(permRaw) || permRaw.length % 2 !== 0) {
        res.status(400).json({ error: 'Invalid permissionsContext' });
        return;
      }

      const scope = req.body?.sessionScope;
      if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
        res.status(400).json({ error: 'Invalid sessionScope' });
        return;
      }

      const settlementInBody =
        typeof scope.settlementAddress === 'string' ? scope.settlementAddress.trim() : '';
      if (!settlementInBody || !ADDR_RE.test(settlementInBody)) {
        res.status(400).json({ error: 'sessionScope.settlementAddress does not match configured settlement contract' });
        return;
      }
      if (!settlementConfigured()) {
        res.status(400).json({ error: 'sessionScope.settlementAddress does not match configured settlement contract' });
        return;
      }
      let cfgSettlement: string;
      try {
        cfgSettlement = ethers.getAddress(config.settlementAddress).toLowerCase();
      } catch {
        res.status(400).json({ error: 'sessionScope.settlementAddress does not match configured settlement contract' });
        return;
      }
      const bodySettlement = ethers.getAddress(settlementInBody).toLowerCase();
      if (bodySettlement !== cfgSettlement) {
        res.status(400).json({ error: 'sessionScope.settlementAddress does not match configured settlement contract' });
        return;
      }

      const fnSel =
        typeof scope.functionSelector === 'string' ? scope.functionSelector.trim().toLowerCase() : '';
      if (!fnSel || fnSel !== ENTER_POSITION_SELECTOR) {
        res.status(400).json({ error: 'sessionScope.functionSelector does not match enterPosition' });
        return;
      }

      const allowanceRaw = scope.usdtAllowance;
      let usdtAllowanceBn: bigint;
      try {
        if (typeof allowanceRaw !== 'string' && typeof allowanceRaw !== 'number') {
          res.status(400).json({ error: 'sessionScope.usdtAllowance must be a positive base-unit integer' });
          return;
        }
        const s = String(allowanceRaw).trim();
        usdtAllowanceBn = BigInt(s);
      } catch {
        res.status(400).json({ error: 'sessionScope.usdtAllowance must be a positive base-unit integer' });
        return;
      }
      if (usdtAllowanceBn <= 0n) {
        res.status(400).json({ error: 'sessionScope.usdtAllowance must be a positive base-unit integer' });
        return;
      }

      if (!deps.executor) {
        res.status(503).json({
          error: 'Smart accounts are not configured on this server. ALCHEMY_API_KEY is missing.',
        });
        return;
      }

      const normalized = ownerRaw.toLowerCase();
      const smartAccountLower = saRaw.toLowerCase();

      const prior = await SmartAccountModel.findOne({ ownerAddress: normalized }).lean();
      const isNew = prior === null;

      if (
        prior &&
        typeof prior.smartAccountAddress === 'string' &&
        prior.smartAccountAddress.toLowerCase() !== smartAccountLower
      ) {
        console.warn(
          `[SmartAccount] register: smartAccountAddress changed for ${normalized}: was ${prior.smartAccountAddress}, now ${smartAccountLower}`
        );
      }

      let initialCachedBalance = '0';
      if (isNew) {
        try {
          const bal = await deps.executor.getSmartAccountBalance(
            smartAccountLower as `0x${string}`,
            config.usdtAddress as `0x${string}`
          );
          initialCachedBalance = bal.toString();
        } catch {
          res.status(502).json({ error: 'Failed to read initial balance from chain; try again' });
          return;
        }
      }

      const sessionExpiryDate = new Date(sessionExpirySec * 1000);
      const usdtAllowanceStr = usdtAllowanceBn.toString();

      await SmartAccountModel.findOneAndUpdate(
        { ownerAddress: normalized },
        {
          $set: {
            sessionKey: skRaw.toLowerCase(),
            sessionExpiry: sessionExpiryDate,
            sessionPermissionsContext: permRaw.toLowerCase(),
            sessionScope: {
              settlementAddress: bodySettlement,
              functionSelector: fnSel,
              usdtAllowance: usdtAllowanceStr,
            },
            smartAccountAddress: smartAccountLower,
            lastUsed: new Date(),
          },
          $setOnInsert: {
            ownerAddress: normalized,
            cachedBalance: initialCachedBalance,
            inOrders: '0',
            withdrawNonce: 0,
            balanceLastSyncedAt: new Date(),
            walletProvider: 'alchemy-modular-account-v2',
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      res.json({
        ownerAddress: normalized,
        smartAccountAddress: smartAccountLower,
        isNew,
        sessionExpiry: sessionExpirySec,
      });
    } catch (err) {
      console.error('[SmartAccount] register error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
