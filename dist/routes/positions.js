"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPositionsRouter = createPositionsRouter;
const express_1 = require("express");
const Trade_1 = require("../models/Trade");
const Market_1 = require("../models/Market");
function createPositionsRouter() {
    const router = (0, express_1.Router)();
    router.get('/:wallet', async (req, res) => {
        try {
            const wallet = req.params.wallet.toLowerCase();
            // Get all trades where this wallet is a buyer
            const buyTrades = await Trade_1.TradeModel.find({ buyer: wallet }).lean();
            // Aggregate positions: per market per option
            const positionMap = new Map();
            for (const trade of buyTrades) {
                const key = `${trade.market}:${trade.option}`;
                const existing = positionMap.get(key);
                const amount = BigInt(trade.amount);
                if (existing) {
                    existing.shares += amount;
                    existing.costBasis += amount;
                    existing.tradeCount++;
                }
                else {
                    positionMap.set(key, {
                        market: trade.market,
                        option: trade.option,
                        shares: amount,
                        costBasis: amount,
                        tradeCount: 1,
                    });
                }
            }
            // Subtract sold positions
            const sellTrades = await Trade_1.TradeModel.find({ seller: wallet }).lean();
            for (const trade of sellTrades) {
                const key = `${trade.market}:${trade.option}`;
                const existing = positionMap.get(key);
                const amount = BigInt(trade.amount);
                if (existing) {
                    existing.shares -= amount;
                }
            }
            const positions = [];
            for (const pos of positionMap.values()) {
                if (pos.shares <= 0n)
                    continue;
                const market = await Market_1.MarketModel.findOne({ address: pos.market }).lean();
                const avgPrice = pos.tradeCount > 0
                    ? Number(pos.costBasis) / Number(pos.shares)
                    : 0;
                positions.push({
                    market: pos.market,
                    marketStatus: market?.status ?? 'UNKNOWN',
                    option: pos.option,
                    optionLabel: pos.option === 1 ? 'UP' : 'DOWN',
                    shares: pos.shares.toString(),
                    avgPrice: Math.round(avgPrice),
                    costBasis: pos.costBasis.toString(),
                });
            }
            res.json(positions);
        }
        catch (err) {
            console.error('[Positions] GET error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    return router;
}
//# sourceMappingURL=positions.js.map