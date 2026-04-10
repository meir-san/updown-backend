"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStatsRouter = createStatsRouter;
const express_1 = require("express");
const Trade_1 = require("../models/Trade");
const Market_1 = require("../models/Market");
function createStatsRouter() {
    const router = (0, express_1.Router)();
    router.get('/', async (_req, res) => {
        try {
            const [volAgg, activeMarketsCount, tradersAgg] = await Promise.all([
                Trade_1.TradeModel.aggregate([
                    {
                        $group: {
                            _id: null,
                            total: { $sum: { $toDecimal: '$amount' } },
                        },
                    },
                ]),
                Market_1.MarketModel.countDocuments({ status: 'ACTIVE' }),
                Trade_1.TradeModel.aggregate([
                    {
                        $project: {
                            w: { $concatArrays: [['$buyer'], ['$seller']] },
                        },
                    },
                    { $unwind: '$w' },
                    { $group: { _id: '$w' } },
                    { $count: 'count' },
                ]),
            ]);
            let totalVolume = '0';
            if (volAgg.length > 0 && volAgg[0].total != null) {
                totalVolume =
                    typeof volAgg[0].total === 'object' && 'toString' in volAgg[0].total
                        ? volAgg[0].total.toString()
                        : String(volAgg[0].total);
            }
            const totalTraders = tradersAgg[0]?.count ?? 0;
            res.json({
                totalVolume,
                activeMarketsCount,
                totalTraders,
            });
        }
        catch (err) {
            console.error('[Stats] GET error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    return router;
}
//# sourceMappingURL=stats.js.map