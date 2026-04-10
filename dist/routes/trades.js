"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTradesRouter = createTradesRouter;
const express_1 = require("express");
const Trade_1 = require("../models/Trade");
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
function createTradesRouter() {
    const router = (0, express_1.Router)();
    router.get('/:wallet', async (req, res) => {
        try {
            const wallet = req.params.wallet.toLowerCase();
            let limit = DEFAULT_LIMIT;
            const rawLimit = req.query.limit;
            if (rawLimit !== undefined && rawLimit !== '') {
                const n = typeof rawLimit === 'string' ? parseInt(rawLimit, 10) : Number(rawLimit);
                if (!Number.isFinite(n) || n < 1) {
                    res.status(400).json({ error: 'Invalid limit' });
                    return;
                }
                limit = Math.min(n, MAX_LIMIT);
            }
            let skip = 0;
            const rawOffset = req.query.offset ?? req.query.skip;
            if (rawOffset !== undefined && rawOffset !== '') {
                const o = typeof rawOffset === 'string' ? parseInt(rawOffset, 10) : Number(rawOffset);
                if (!Number.isFinite(o) || o < 0) {
                    res.status(400).json({ error: 'Invalid offset' });
                    return;
                }
                skip = Math.min(o, MAX_LIMIT * 10);
            }
            const rows = await Trade_1.TradeModel.find({
                $or: [{ buyer: wallet }, { seller: wallet }],
            })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean();
            const trades = rows.map((t) => ({
                tradeId: t.tradeId,
                market: t.market,
                option: t.option,
                buyOrderId: t.buyOrderId,
                sellOrderId: t.sellOrderId,
                buyer: t.buyer,
                seller: t.seller,
                price: t.price,
                amount: t.amount,
                platformFee: t.platformFee,
                makerFee: t.makerFee,
                settlementStatus: t.settlementStatus,
                createdAt: t.createdAt,
            }));
            res.json(trades);
        }
        catch (err) {
            console.error('[Trades] GET error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    return router;
}
//# sourceMappingURL=trades.js.map