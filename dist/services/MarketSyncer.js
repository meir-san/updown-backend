"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketSyncer = void 0;
const ethers_1 = require("ethers");
const config_1 = require("../config");
const Market_1 = require("../models/Market");
const AutoCycler_json_1 = __importDefault(require("../abis/AutoCycler.json"));
const TradePool_json_1 = __importDefault(require("../abis/TradePool.json"));
const RESOLVER_MARKETS_IFACE = new ethers_1.ethers.Interface([
    'function markets(address pool) view returns (bytes32 pairId, int256 strikePrice, bool resolved)',
]);
/**
 * Polls the UpDownAutoCycler contract for active markets.
 * Syncs market metadata to MongoDB.
 * Detects resolved markets and triggers ClaimService.
 */
class MarketSyncer {
    provider;
    books;
    claimService;
    ws;
    intervalHandle = null;
    constructor(provider, books, claimService, ws = null) {
        this.provider = provider;
        this.books = books;
        this.claimService = claimService;
        this.ws = ws;
    }
    start() {
        if (this.intervalHandle)
            return;
        this.sync().catch((err) => console.error('[MarketSyncer] initial sync error:', err));
        this.intervalHandle = setInterval(() => {
            this.sync().catch((err) => console.error('[MarketSyncer] sync error:', err));
        }, config_1.config.marketSyncIntervalMs);
        console.log(`[MarketSyncer] Started (interval=${config_1.config.marketSyncIntervalMs}ms)`);
    }
    stop() {
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = null;
        }
    }
    async sync() {
        if (!config_1.config.autocyclerAddress)
            return;
        const cycler = new ethers_1.ethers.Contract(config_1.config.autocyclerAddress, AutoCycler_json_1.default, this.provider);
        const count = await cycler.activeMarketCount();
        const marketCount = Number(count);
        for (let i = 0; i < marketCount; i++) {
            try {
                const [poolAddr, endTime, pairId] = await cycler.activeMarkets(i);
                await this.syncMarket(poolAddr, Number(endTime), pairId);
            }
            catch (err) {
                console.error(`[MarketSyncer] Error syncing market at index ${i}:`, err);
            }
        }
        // Check for resolved markets
        const activeMarkets = await Market_1.MarketModel.find({
            status: { $in: ['ACTIVE', 'TRADING_ENDED'] },
        });
        for (const market of activeMarkets) {
            await this.checkResolution(market.address);
        }
    }
    async syncMarket(poolAddress, endTime, pairId) {
        const normalized = poolAddress.toLowerCase();
        const pool = new ethers_1.ethers.Contract(poolAddress, TradePool_json_1.default, this.provider);
        let startTime;
        let upPrice = '0';
        let downPrice = '0';
        try {
            startTime = Number(await pool.startTime());
        }
        catch {
            startTime = Math.floor(Date.now() / 1000);
        }
        try {
            const upPriceRaw = await pool.getCurrentPrice(1);
            const downPriceRaw = await pool.getCurrentPrice(2);
            upPrice = upPriceRaw.toString();
            downPrice = downPriceRaw.toString();
        }
        catch {
            // Pool may not have prices yet
        }
        let strikePrice = '';
        try {
            const resolverAddr = await pool.resolver();
            if (resolverAddr && resolverAddr !== ethers_1.ethers.ZeroAddress) {
                const resolver = new ethers_1.ethers.Contract(resolverAddr, RESOLVER_MARKETS_IFACE, this.provider);
                const row = await resolver.markets(poolAddress);
                strikePrice = row.strikePrice.toString();
            }
        }
        catch {
            // Resolver missing or markets() not available
        }
        const now = Math.floor(Date.now() / 1000);
        let status = 'ACTIVE';
        if (now > endTime) {
            status = 'TRADING_ENDED';
        }
        const prior = await Market_1.MarketModel.findOne({ address: normalized }).select('address').lean();
        await Market_1.MarketModel.findOneAndUpdate({ address: normalized }, {
            address: normalized,
            pairId: ethers_1.ethers.decodeBytes32String(pairId).replace(/\0/g, '') || pairId,
            startTime,
            endTime,
            duration: endTime - startTime,
            status,
            upPrice,
            downPrice,
            strikePrice,
        }, { upsert: true, new: true });
        if (!prior) {
            this.ws?.broadcastMarketEvent('market_created', {
                address: normalized,
                pairId: ethers_1.ethers.decodeBytes32String(pairId).replace(/\0/g, '') || pairId,
                endTime,
                duration: endTime - startTime,
                strikePrice,
            });
        }
        // Initialize order books
        this.books.getOrCreate(normalized, 1);
        this.books.getOrCreate(normalized, 2);
    }
    async checkResolution(marketAddress) {
        try {
            const pool = new ethers_1.ethers.Contract(marketAddress, TradePool_json_1.default, this.provider);
            const finalized = await pool.poolFinalized();
            if (finalized) {
                const winner = Number(await pool.winner());
                await Market_1.MarketModel.updateOne({ address: marketAddress.toLowerCase() }, { status: 'RESOLVED', winner });
                this.ws?.broadcastMarketEvent('market_resolved', {
                    address: marketAddress.toLowerCase(),
                    winner,
                });
                await this.claimService.processResolvedMarket(marketAddress);
            }
        }
        catch (err) {
            // Pool may not be in a state to check yet
        }
    }
}
exports.MarketSyncer = MarketSyncer;
//# sourceMappingURL=MarketSyncer.js.map