import { Router, Request, Response } from 'express';
import { config } from '../config';

const BINANCE_TIMEOUT_MS = 5000;

function binancePairFromSymbol(symbol: string): string | null {
  const s = symbol.trim().toUpperCase();
  if (s === 'BTC') return 'BTCUSDT';
  if (s === 'ETH') return 'ETHUSDT';
  return null;
}

/**
 * GET /prices/history/:symbol — last hour of 1m candles from Binance public klines (no auth).
 * Response: `[[closeTimeMs, closePriceString], ...]` for the frontend price chart parser.
 */
export function createPricesRouter(): Router {
  const router = Router();

  router.get('/history/:symbol', async (req: Request, res: Response) => {
    const pair = binancePairFromSymbol(String(req.params.symbol ?? ''));
    if (!pair) {
      res.status(400).json({ error: 'Unsupported symbol' });
      return;
    }

    const base = config.binanceKlinesBaseUrl.replace(/\/$/, '');
    const url = `${base}/api/v3/klines?symbol=${encodeURIComponent(pair)}&interval=1m&limit=60`;

    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), BINANCE_TIMEOUT_MS);

    try {
      let upstreamRes: globalThis.Response;
      try {
        upstreamRes = await fetch(url, { signal: ac.signal });
      } finally {
        clearTimeout(t);
      }

      if (!upstreamRes.ok) {
        console.error(`[Prices] Binance upstream non-2xx: ${upstreamRes.status}`);
        res.status(502).json({ error: 'Upstream error' });
        return;
      }

      let body: unknown;
      try {
        body = await upstreamRes.json();
      } catch (e) {
        console.error('[Prices] JSON parse failure:', e);
        res.status(502).json({ error: 'Upstream returned unexpected data' });
        return;
      }

      if (!Array.isArray(body)) {
        console.error('[Prices] Binance response was not a JSON array');
        res.status(502).json({ error: 'Upstream returned unexpected data' });
        return;
      }

      const points = body
        .filter((row): row is unknown[] => Array.isArray(row) && row.length >= 7)
        .map((row) => {
          const closeTime = Number(row[6]);
          const close = String(row[4]);
          return [closeTime, close] as [number, string];
        });

      res.json(points);
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'AbortError') {
        console.error('[Prices] Upstream timed out (AbortError)');
        res.status(504).json({ error: 'Upstream timed out' });
        return;
      }
      console.error('[Prices] Internal error:', err);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  return router;
}
