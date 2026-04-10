"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaimService = void 0;
const ethers_1 = require("ethers");
const config_1 = require("../config");
const Market_1 = require("../models/Market");
const Trade_1 = require("../models/Trade");
const Balance_1 = require("../models/Balance");
const ClaimPayoutLog_1 = require("../models/ClaimPayoutLog");
const TradePool_json_1 = __importDefault(require("../abis/TradePool.json"));
/**
 * After a market is resolved (ChainlinkResolver called chooseWinner),
 * the relayer claims its USDT payout and distributes winnings
 * to users based on their off-chain positions in MongoDB.
 */
class ClaimService {
    provider;
    relayer;
    constructor(provider) {
        this.provider = provider;
        this.relayer = new ethers_1.ethers.Wallet(config_1.config.relayerPrivateKey, provider);
    }
    async processResolvedMarket(marketAddress) {
        const normalizedAddr = marketAddress.toLowerCase();
        const market = await Market_1.MarketModel.findOne({ address: normalizedAddr });
        if (!market || market.claimDistributionComplete)
            return;
        const pool = new ethers_1.ethers.Contract(marketAddress, TradePool_json_1.default, this.relayer);
        const finalized = await pool.poolFinalized();
        if (!finalized)
            return;
        const winner = await pool.winner();
        const winningOption = Number(winner);
        if (winningOption === 0)
            return;
        if (!market.claimedByRelayer) {
            try {
                const tx = await pool.claim();
                await tx.wait();
                console.log(`[Claim] Claimed from pool ${marketAddress} (tx: ${tx.hash})`);
            }
            catch (err) {
                if (!err.message?.includes('AlreadyClaimed')) {
                    console.error(`[Claim] Failed to claim from ${marketAddress}:`, err);
                    return;
                }
                console.log(`[Claim] Already claimed from ${marketAddress}`);
            }
            await Market_1.MarketModel.updateOne({ _id: market._id, claimedByRelayer: false }, { $set: { claimedByRelayer: true } });
        }
        const relayerWallet = this.relayer.address.toLowerCase();
        await this.distributeWinnings(normalizedAddr, winningOption, relayerWallet);
        await Market_1.MarketModel.updateOne({ _id: market._id }, {
            $set: {
                claimDistributionComplete: true,
                status: 'CLAIMED',
                winner: winningOption,
            },
        });
    }
    async distributeWinnings(marketAddress, winningOption, relayerWallet) {
        const normalizedAddr = marketAddress.toLowerCase();
        const winningTrades = await Trade_1.TradeModel.find({
            market: normalizedAddr,
            option: winningOption,
        });
        const buyerPositions = new Map();
        for (const trade of winningTrades) {
            const buyer = trade.buyer.toLowerCase();
            const amount = BigInt(trade.amount);
            const current = buyerPositions.get(buyer) ?? 0n;
            buyerPositions.set(buyer, current + amount);
        }
        let totalWinningBought = 0n;
        for (const amount of buyerPositions.values()) {
            totalWinningBought += amount;
        }
        if (totalWinningBought === 0n) {
            console.log(`[Claim] No winning positions for market ${marketAddress}`);
            return;
        }
        const losingTrades = await Trade_1.TradeModel.find({
            market: normalizedAddr,
            option: winningOption === 1 ? 2 : 1,
        });
        let totalLosingBought = 0n;
        for (const trade of losingTrades) {
            totalLosingBought += BigInt(trade.amount);
        }
        const totalPool = totalWinningBought + totalLosingBought;
        let totalDistributed = 0n;
        const priorLogs = await ClaimPayoutLog_1.ClaimPayoutLogModel.find({ market: normalizedAddr });
        for (const l of priorLogs) {
            totalDistributed += BigInt(l.amount);
        }
        for (const [wallet, position] of buyerPositions) {
            const payout = (position * totalPool) / totalWinningBought;
            if (payout <= 0n)
                continue;
            const already = await ClaimPayoutLog_1.ClaimPayoutLogModel.findOne({ market: normalizedAddr, wallet });
            if (already)
                continue;
            try {
                await ClaimPayoutLog_1.ClaimPayoutLogModel.create({
                    market: normalizedAddr,
                    wallet,
                    amount: payout.toString(),
                });
            }
            catch (e) {
                if (e.code === 11000) {
                    continue;
                }
                throw e;
            }
            await (0, Balance_1.creditBalance)(wallet, payout);
            totalDistributed += payout;
            console.log(`[Claim] Credited ${payout.toString()} to ${wallet} for market ${marketAddress}`);
        }
        const dust = totalPool > totalDistributed ? totalPool - totalDistributed : 0n;
        if (dust > 0n) {
            const dustRes = await Market_1.MarketModel.findOneAndUpdate({ address: normalizedAddr, claimDustApplied: { $ne: true } }, { $set: { claimDustApplied: true } });
            if (dustRes) {
                await (0, Balance_1.creditBalance)(relayerWallet, dust);
                console.log(`[Claim] Credited dust ${dust.toString()} to relayer for market ${marketAddress}`);
            }
        }
    }
}
exports.ClaimService = ClaimService;
//# sourceMappingURL=ClaimService.js.map