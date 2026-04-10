"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPricesRouter = createPricesRouter;
const express_1 = require("express");
const config_1 = require("../config");
const PROXY_TIMEOUT_MS = 10_000;
/**
 * Proxies BTC (and other) price history to the existing speed-markets API
 * for the TradingChart (GET /prices/history/:symbol → upstream /coins/price/history/:symbol).
 */
function createPricesRouter() {
    const router = (0, express_1.Router)();
    router.get('/history/:symbol', async (req, res) => {
        try {
            const symbol = encodeURIComponent(req.params.symbol);
            const base = config_1.config.speedMarketApiBaseUrl.replace(/\/$/, '');
            const qs = new URLSearchParams();
            for (const [k, v] of Object.entries(req.query)) {
                if (v === undefined)
                    continue;
                if (Array.isArray(v)) {
                    for (const item of v) {
                        if (item != null)
                            qs.append(k, String(item));
                    }
                }
                else {
                    qs.append(k, String(v));
                }
            }
            const q = qs.toString();
            const url = `${base}/coins/price/history/${symbol}${q ? `?${q}` : ''}`;
            const ac = new AbortController();
            const t = setTimeout(() => ac.abort(), PROXY_TIMEOUT_MS);
            let upstreamRes;
            try {
                upstreamRes = await fetch(url, { signal: ac.signal });
            }
            finally {
                clearTimeout(t);
            }
            const ct = upstreamRes.headers.get('content-type') ?? '';
            const body = ct.includes('application/json') ? await upstreamRes.json() : await upstreamRes.text();
            res.status(upstreamRes.status);
            if (ct.includes('application/json')) {
                res.json(body);
            }
            else {
                res.type(ct || 'text/plain').send(body);
            }
        }
        catch (err) {
            console.error('[Prices] proxy error:', err);
            const message = err?.name === 'AbortError' ? 'Upstream request timed out' : 'Failed to fetch price history';
            res.status(502).json({ error: message });
        }
    });
    return router;
}
//# sourceMappingURL=prices.js.map