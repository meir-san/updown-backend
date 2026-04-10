"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOrdersRouter = createOrdersRouter;
const express_1 = require("express");
const types_1 = require("../engine/types");
const SignatureService_1 = require("../services/SignatureService");
const Market_1 = require("../models/Market");
const Order_1 = require("../models/Order");
function createOrdersRouter(engine) {
    const router = (0, express_1.Router)();
    router.post('/', async (req, res) => {
        try {
            const { maker, market, option, side, type, price, amount, nonce, expiry, signature } = req.body;
            if (!maker || !market || option == null || side == null || !amount || !signature) {
                res.status(400).json({ error: 'Missing required fields' });
                return;
            }
            if (option !== 1 && option !== 2) {
                res.status(400).json({ error: 'Option must be 1 (UP) or 2 (DOWN)' });
                return;
            }
            const sideEnum = side === 'BUY' || side === 0 ? types_1.OrderSide.BUY : types_1.OrderSide.SELL;
            const typeEnum = type === 'MARKET' || type === 1 ? types_1.OrderType.MARKET : types_1.OrderType.LIMIT;
            if (typeEnum === types_1.OrderType.LIMIT && (price == null || price <= 0 || price >= 10000)) {
                res.status(400).json({ error: 'Limit orders require price between 1 and 9999 (basis points)' });
                return;
            }
            // Verify market exists and is active
            const marketDoc = await Market_1.MarketModel.findOne({
                address: market.toLowerCase(),
                status: 'ACTIVE',
            });
            if (!marketDoc) {
                res.status(400).json({ error: 'Market not found or not active' });
                return;
            }
            // Verify EIP-712 signature
            const valid = (0, SignatureService_1.verifyOrderSignature)({
                maker,
                market,
                option,
                side: sideEnum,
                type: typeEnum,
                price: price ?? 0,
                amount,
                nonce: nonce ?? 0,
                expiry: expiry ?? 0,
            }, signature);
            if (!valid) {
                res.status(401).json({ error: 'Invalid signature' });
                return;
            }
            const order = await engine.submitOrder({
                maker,
                market,
                option,
                side: sideEnum,
                type: typeEnum,
                price: price ?? 0,
                amount,
                nonce: nonce ?? 0,
                expiry: expiry ?? 0,
                signature,
            });
            res.status(201).json({
                id: order.id,
                status: order.status,
                market: order.market,
                option: order.option,
                side: order.side === types_1.OrderSide.BUY ? 'BUY' : 'SELL',
                type: order.type === types_1.OrderType.LIMIT ? 'LIMIT' : 'MARKET',
                price: order.price,
                amount: order.amount.toString(),
                createdAt: order.createdAt,
            });
        }
        catch (err) {
            if (err.message === 'Insufficient balance') {
                res.status(400).json({ error: 'Insufficient balance' });
                return;
            }
            console.error('[Orders] POST error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    router.delete('/:id', async (req, res) => {
        try {
            const id = req.params.id;
            const { maker, signature } = req.body;
            if (!maker || !signature) {
                res.status(400).json({ error: 'Missing maker or signature' });
                return;
            }
            const order = await Order_1.OrderModel.findOne({ orderId: id });
            if (!order) {
                res.status(404).json({ error: 'Order not found' });
                return;
            }
            if (order.maker !== maker.toLowerCase()) {
                res.status(403).json({ error: 'Not the order maker' });
                return;
            }
            if (order.status === 'CANCELLED' || order.status === 'FILLED') {
                res.status(400).json({ error: `Order already ${order.status.toLowerCase()}` });
                return;
            }
            const valid = (0, SignatureService_1.verifyCancelSignature)(maker, id, signature);
            if (!valid) {
                res.status(401).json({ error: 'Invalid cancel signature' });
                return;
            }
            engine.submitCancel(id, maker);
            res.json({ id, status: 'CANCEL_PENDING' });
        }
        catch (err) {
            console.error('[Orders] DELETE error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    return router;
}
//# sourceMappingURL=orders.js.map