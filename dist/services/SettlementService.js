"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettlementService = void 0;
const ethers_1 = require("ethers");
const config_1 = require("../config");
const Trade_1 = require("../models/Trade");
const TradePool_json_1 = __importDefault(require("../abis/TradePool.json"));
const ERC20_json_1 = __importDefault(require("../abis/ERC20.json"));
const MAX_SETTLEMENT_RETRIES = 5;
function settlementBackoffMs(nextRetryCount) {
    return Math.min(32_000, 1000 * Math.pow(2, Math.max(0, nextRetryCount - 1)));
}
/**
 * Batches matched trades and enters aggregate positions on-chain
 * via the relayer wallet calling enterOption().
 *
 * Phase 2: all on-chain positions belong to the relayer.
 * Phase 4: will use session keys to enter from users' smart accounts.
 */
class SettlementService {
    provider;
    relayer;
    intervalHandle = null;
    approvedPools = new Set();
    constructor(provider) {
        this.provider = provider;
        this.relayer = new ethers_1.ethers.Wallet(config_1.config.relayerPrivateKey, provider);
    }
    get relayerAddress() {
        return this.relayer.address;
    }
    start() {
        if (this.intervalHandle)
            return;
        this.intervalHandle = setInterval(() => {
            this.settleBatch().catch((err) => console.error('[Settlement] batch error:', err));
        }, config_1.config.settlementBatchIntervalMs);
        console.log(`[Settlement] Started (interval=${config_1.config.settlementBatchIntervalMs}ms, relayer=${this.relayer.address})`);
    }
    stop() {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }
    async settleBatch() {
        const now = new Date();
        const pendingTrades = await Trade_1.TradeModel.find({
            settlementStatus: 'PENDING',
            settlementRetryCount: { $lt: MAX_SETTLEMENT_RETRIES },
            $or: [{ settlementNextRetryAt: null }, { settlementNextRetryAt: { $lte: now } }],
        }).limit(50);
        if (pendingTrades.length === 0)
            return;
        const byMarket = new Map();
        for (const t of pendingTrades) {
            const list = byMarket.get(t.market) ?? [];
            list.push(t);
            byMarket.set(t.market, list);
        }
        for (const [market, trades] of byMarket) {
            const locked = [];
            let up = 0n;
            let down = 0n;
            for (const t of trades) {
                const doc = await Trade_1.TradeModel.findOneAndUpdate({
                    tradeId: t.tradeId,
                    settlementStatus: 'PENDING',
                    settlementRetryCount: { $lt: MAX_SETTLEMENT_RETRIES },
                    $or: [{ settlementNextRetryAt: null }, { settlementNextRetryAt: { $lte: now } }],
                }, { $set: { settlementStatus: 'SUBMITTED' } }, { new: true });
                if (doc) {
                    locked.push(doc);
                    const amount = BigInt(doc.amount);
                    if (doc.option === config_1.OPTION_UP) {
                        up += amount;
                    }
                    else {
                        down += amount;
                    }
                }
            }
            if (locked.length === 0)
                continue;
            try {
                await this.ensureApproval(market);
                if (up > 0n) {
                    const tx = await this.enterOption(market, config_1.OPTION_UP, up);
                    console.log(`[Settlement] enterOption(UP, ${up}) on ${market} tx=${tx.hash}`);
                    await tx.wait();
                }
                if (down > 0n) {
                    const tx = await this.enterOption(market, config_1.OPTION_DOWN, down);
                    console.log(`[Settlement] enterOption(DOWN, ${down}) on ${market} tx=${tx.hash}`);
                    await tx.wait();
                }
            }
            catch (err) {
                console.error(`[Settlement] Failed to settle for market ${market}:`, err);
                for (const t of locked) {
                    const prevRetries = t.settlementRetryCount ?? 0;
                    const nextRetries = prevRetries + 1;
                    const failed = nextRetries >= MAX_SETTLEMENT_RETRIES;
                    await Trade_1.TradeModel.updateOne({ tradeId: t.tradeId }, {
                        $set: {
                            settlementStatus: failed ? 'FAILED' : 'PENDING',
                            settlementRetryCount: nextRetries,
                            settlementNextRetryAt: failed ? null : new Date(Date.now() + settlementBackoffMs(nextRetries)),
                        },
                    });
                }
            }
        }
    }
    async enterOption(poolAddress, option, amount) {
        const pool = new ethers_1.ethers.Contract(poolAddress, TradePool_json_1.default, this.relayer);
        return pool.enterOption(option, amount);
    }
    async ensureApproval(poolAddress) {
        if (this.approvedPools.has(poolAddress))
            return;
        const usdt = new ethers_1.ethers.Contract(config_1.config.usdtAddress, ERC20_json_1.default, this.relayer);
        const allowance = await usdt.allowance(this.relayer.address, poolAddress);
        if (allowance < config_1.MAX_UINT256 / 2n) {
            const tx = await usdt.approve(poolAddress, config_1.MAX_UINT256);
            await tx.wait();
            console.log(`[Settlement] Approved USDT for pool ${poolAddress}`);
        }
        this.approvedPools.add(poolAddress);
    }
}
exports.SettlementService = SettlementService;
//# sourceMappingURL=SettlementService.js.map