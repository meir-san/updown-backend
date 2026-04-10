"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const ethers_1 = require("ethers");
const config_1 = require("./config");
const db_1 = require("./db");
const OrderBook_1 = require("./engine/OrderBook");
const MatchingEngine_1 = require("./engine/MatchingEngine");
const SettlementService_1 = require("./services/SettlementService");
const DepositService_1 = require("./services/DepositService");
const ClaimService_1 = require("./services/ClaimService");
const MarketSyncer_1 = require("./services/MarketSyncer");
const WebSocketServer_1 = require("./ws/WebSocketServer");
const orders_1 = require("./routes/orders");
const markets_1 = require("./routes/markets");
const orderbook_1 = require("./routes/orderbook");
const positions_1 = require("./routes/positions");
const balance_1 = require("./routes/balance");
const prices_1 = require("./routes/prices");
const trades_1 = require("./routes/trades");
const stats_1 = require("./routes/stats");
const config_2 = require("./routes/config");
async function main() {
    // Connect to MongoDB
    await (0, db_1.connectDb)();
    // Blockchain provider + relayer wallet
    const provider = new ethers_1.ethers.JsonRpcProvider(config_1.config.arbitrumRpcUrl);
    const relayer = new ethers_1.ethers.Wallet(config_1.config.relayerPrivateKey, provider);
    console.log(`[Server] Relayer address: ${relayer.address}`);
    // Core components
    const books = new OrderBook_1.OrderBookManager();
    const engine = new MatchingEngine_1.MatchingEngine(books);
    const settlementService = new SettlementService_1.SettlementService(provider);
    const claimService = new ClaimService_1.ClaimService(provider);
    // Express app
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)());
    app.use(express_1.default.json());
    // Health check
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok', relayer: relayer.address, uptime: process.uptime() });
    });
    app.use('/config', (0, config_2.createConfigRouter)(relayer.address));
    // API routes
    app.use('/orders', (0, orders_1.createOrdersRouter)(engine));
    app.use('/markets', (0, markets_1.createMarketsRouter)(books, claimService));
    app.use('/orderbook', (0, orderbook_1.createOrderBookRouter)(books));
    app.use('/positions', (0, positions_1.createPositionsRouter)());
    app.use('/balance', (0, balance_1.createBalanceRouter)(provider, relayer));
    app.use('/prices', (0, prices_1.createPricesRouter)());
    app.use('/trades', (0, trades_1.createTradesRouter)());
    app.use('/stats', (0, stats_1.createStatsRouter)());
    // HTTP + WebSocket server (before services that broadcast)
    const server = http_1.default.createServer(app);
    const wsServer = new WebSocketServer_1.WsServer(server, engine);
    const depositService = new DepositService_1.DepositService(provider, relayer.address, wsServer);
    const marketSyncer = new MarketSyncer_1.MarketSyncer(provider, books, claimService, wsServer);
    // Start all services
    engine.start();
    settlementService.start();
    depositService.start();
    marketSyncer.start();
    server.listen(config_1.config.port, () => {
        console.log(`[Server] Listening on port ${config_1.config.port}`);
        console.log(`[Server] REST API: http://localhost:${config_1.config.port}`);
        console.log(`[Server] WebSocket: ws://localhost:${config_1.config.port}/stream`);
    });
    // Graceful shutdown
    const shutdown = () => {
        console.log('[Server] Shutting down...');
        engine.stop();
        settlementService.stop();
        depositService.stop();
        marketSyncer.stop();
        server.close(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
main().catch((err) => {
    console.error('[Server] Fatal error:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map