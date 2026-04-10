"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBalanceRouter = createBalanceRouter;
const express_1 = require("express");
const ethers_1 = require("ethers");
const config_1 = require("../config");
const Balance_1 = require("../models/Balance");
const SignatureService_1 = require("../services/SignatureService");
const ERC20_json_1 = __importDefault(require("../abis/ERC20.json"));
function createBalanceRouter(provider, relayerWallet) {
    const router = (0, express_1.Router)();
    router.get('/:wallet', async (req, res) => {
        try {
            const bal = await (0, Balance_1.getOrCreateBalance)(req.params.wallet);
            res.json({
                wallet: bal.wallet,
                available: bal.available,
                inOrders: bal.inOrders,
                totalDeposited: bal.totalDeposited,
                totalWithdrawn: bal.totalWithdrawn,
                withdrawNonce: bal.withdrawNonce,
            });
        }
        catch (err) {
            console.error('[Balance] GET error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    router.post('/withdraw', async (req, res) => {
        try {
            const { wallet, amount, signature } = req.body;
            if (!wallet || !amount || !signature) {
                res.status(400).json({ error: 'Missing wallet, amount, or signature' });
                return;
            }
            const bal = await (0, Balance_1.getOrCreateBalance)(wallet);
            const valid = (0, SignatureService_1.verifyWithdrawSignature)(wallet, amount, bal.withdrawNonce, signature);
            if (!valid) {
                res.status(401).json({ error: 'Invalid withdrawal signature' });
                return;
            }
            const withdrawAmount = BigInt(amount);
            const available = BigInt(bal.available);
            if (available < withdrawAmount) {
                res.status(400).json({ error: 'Insufficient available balance' });
                return;
            }
            const usdt = new ethers_1.ethers.Contract(config_1.config.usdtAddress, ERC20_json_1.default, relayerWallet);
            const tx = await usdt.transfer(wallet, withdrawAmount);
            const receipt = await tx.wait();
            if (!receipt || receipt.status !== 1) {
                res.status(502).json({ error: 'On-chain transfer failed' });
                return;
            }
            const ok = await (0, Balance_1.applyWithdrawalAccounting)(wallet, withdrawAmount);
            if (!ok) {
                console.error('[Balance] Withdraw transfer succeeded but accounting update failed', {
                    wallet,
                    amount: withdrawAmount.toString(),
                    txHash: receipt.hash,
                });
                res.status(500).json({ error: 'Transfer confirmed but balance update failed; contact support' });
                return;
            }
            const after = await (0, Balance_1.getOrCreateBalance)(wallet);
            res.json({
                txHash: receipt.hash,
                amount: withdrawAmount.toString(),
                newAvailable: after.available,
            });
        }
        catch (err) {
            console.error('[Balance] POST /withdraw error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });
    return router;
}
//# sourceMappingURL=balance.js.map