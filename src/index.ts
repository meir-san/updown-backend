import http from 'http';
import express from 'express';
import cors from 'cors';
import { ethers } from 'ethers';

import { config } from './config';
import { connectDb } from './db';
import { OrderBookManager } from './engine/OrderBook';
import { MatchingEngine } from './engine/MatchingEngine';
import { SettlementService } from './services/SettlementService';
import { DepositService } from './services/DepositService';
import { ClaimService } from './services/ClaimService';
import { MarketSyncer } from './services/MarketSyncer';
import { WsServer } from './ws/WebSocketServer';
import { createOrdersRouter } from './routes/orders';
import { createMarketsRouter } from './routes/markets';
import { createOrderBookRouter } from './routes/orderbook';
import { createPositionsRouter } from './routes/positions';
import { createBalanceRouter } from './routes/balance';
import { createPricesRouter } from './routes/prices';
import { createTradesRouter } from './routes/trades';
import { createStatsRouter } from './routes/stats';
import { createConfigRouter } from './routes/config';
import { apiLimiter } from './middleware/rateLimit';

async function main(): Promise<void> {
  // Connect to MongoDB
  await connectDb();

  // Blockchain provider + relayer wallet
  const provider = new ethers.JsonRpcProvider(config.arbitrumRpcUrl);
  const relayer = new ethers.Wallet(config.relayerPrivateKey, provider);
  console.log(`[Server] Relayer address: ${relayer.address}`);

  // Core components
  const books = new OrderBookManager();
  const feeTreasury =
    config.feeTreasuryAddress || relayer.address.toLowerCase();
  const engine = new MatchingEngine(books, { platformFeeTreasury: feeTreasury });

  const settlementService = new SettlementService(provider);
  const claimService = new ClaimService(provider);

  // Express app
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Health check (excluded from API rate limit for probes)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', relayer: relayer.address, uptime: process.uptime() });
  });

  app.use(apiLimiter);

  app.use('/config', createConfigRouter(relayer.address));

  // API routes
  app.use('/orders', createOrdersRouter(engine));
  app.use(
    '/markets',
    createMarketsRouter(books, claimService, relayer.address)
  );
  app.use('/orderbook', createOrderBookRouter(books));
  app.use('/positions', createPositionsRouter());
  app.use('/balance', createBalanceRouter(provider, relayer));
  app.use('/prices', createPricesRouter());
  app.use('/trades', createTradesRouter());
  app.use('/stats', createStatsRouter());

  // HTTP + WebSocket server (before services that broadcast)
  const server = http.createServer(app);
  const wsServer = new WsServer(server, engine);

  const depositService = new DepositService(provider, relayer.address, wsServer);
  const marketSyncer = new MarketSyncer(
    provider,
    books,
    claimService,
    wsServer,
    engine
  );

  // Start all services
  engine.start();
  settlementService.start();
  depositService.start();
  marketSyncer.start();

  server.listen(config.port, () => {
    console.log(`[Server] Listening on port ${config.port}`);
    console.log(`[Server] REST API: http://localhost:${config.port}`);
    console.log(`[Server] WebSocket: ws://localhost:${config.port}/stream`);
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
