"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOrderBookRouter = createOrderBookRouter;
const express_1 = require("express");
function createOrderBookRouter(books) {
    const router = (0, express_1.Router)();
    router.get('/:marketId', (req, res) => {
        try {
            const marketId = req.params.marketId;
            const snapshot = books.getMarketSnapshot(marketId.toLowerCase());
            res.json(snapshot);
        }
        catch (err) {
            console.error('[OrderBook] GET error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    return router;
}
//# sourceMappingURL=orderbook.js.map