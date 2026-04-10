"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMarketsRouter = createMarketsRouter;
const express_1 = require("express");
const Market_1 = require("../models/Market");
const Trade_1 = require("../models/Trade");
const ALLOWED_TIMEFRAMES = new Set([300, 900, 3600]);
function bestBidAsk(snapshot) {
    const bid = snapshot.bids[0];
    const ask = snapshot.asks[0];
    return {
        bestBid: bid ? { price: bid.price, depth: bid.depth } : null,
        bestAsk: ask ? { price: ask.price, depth: ask.depth } : null,
    };
}
function createMarketsRouter(books, claimService) {
    const router = (0, express_1.Router)();
    router.get('/', async (req, res) => {
        try {
            const rawTf = req.query.timeframe;
            let durationFilter;
            if (rawTf !== undefined && rawTf !== '') {
                const n = typeof rawTf === 'string' ? parseInt(rawTf, 10) : Number(rawTf);
                if (!ALLOWED_TIMEFRAMES.has(n)) {
                    res.status(400).json({
                        error: 'Invalid timeframe',
                        allowed: [300, 900, 3600],
                    });
                    return;
                }
                durationFilter = n;
            }
            const filter = {
                status: { $in: ['ACTIVE', 'TRADING_ENDED', 'RESOLVED'] },
            };
            if (durationFilter !== undefined) {
                filter.duration = durationFilter;
            }
            const markets = await Market_1.MarketModel.find(filter).sort({ endTime: -1 }).lean();
            const result = markets.map((m) => ({
                address: m.address,
                pairId: m.pairId,
                startTime: m.startTime,
                endTime: m.endTime,
                duration: m.duration,
                status: m.status,
                winner: m.winner,
                upPrice: m.upPrice,
                downPrice: m.downPrice,
                strikePrice: m.strikePrice ?? '',
                volume: m.volume,
            }));
            res.json(result);
        }
        catch (err) {
            console.error('[Markets] GET error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    router.post('/:address/claim', async (req, res) => {
        try {
            const addr = req.params.address.toLowerCase();
            await claimService.processResolvedMarket(addr);
            res.json({ ok: true });
        }
        catch (err) {
            console.error('[Markets] POST /:address/claim error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    router.get('/:address', async (req, res) => {
        try {
            const market = await Market_1.MarketModel.findOne({
                address: req.params.address.toLowerCase(),
            }).lean();
            if (!market) {
                res.status(404).json({ error: 'Market not found' });
                return;
            }
            const trades = await Trade_1.TradeModel.find({ market: market.address });
            let volume = 0n;
            for (const t of trades) {
                volume += BigInt(t.amount);
            }
            const nowSec = Math.floor(Date.now() / 1000);
            const timeRemainingSeconds = Math.max(0, market.endTime - nowSec);
            const snap = books.getMarketSnapshot(market.address);
            const orderBook = {
                up: bestBidAsk(snap.up),
                down: bestBidAsk(snap.down),
            };
            res.json({
                ...market,
                volume: volume.toString(),
                timeRemainingSeconds,
                orderBook,
            });
        }
        catch (err) {
            console.error('[Markets] GET /:address error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    return router;
}
//# sourceMappingURL=markets.js.map