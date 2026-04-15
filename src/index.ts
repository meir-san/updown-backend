import http from 'http';
import express from 'express';
import cors from 'cors';
import { ethers } from 'ethers';

import { config } from './config';
import { connectDb } from './db';
import { OrderBookManager } from './engine/OrderBook';
import { MatchingEngine } from './engine/MatchingEngine';
import { SettlementService } from './services/SettlementService';
import { ClaimService } from './services/ClaimService';
import { MarketSyncer } from './services/MarketSyncer';
import { SmartAccountExecutor } from './services/SmartAccountExecutor';
import { SmartAccountBalanceSync } from './services/SmartAccountBalanceSync';
import { WsServer } from './ws/WebSocketServer';
import { createOrdersRouter } from './routes/orders';
import { createDmmRouter } from './routes/dmm';
import { DMMService } from './services/DMMService';
import { createMarketsRouter } from './routes/markets';
import { createOrderBookRouter } from './routes/orderbook';
import { createPositionsRouter } from './routes/positions';
import { createBalanceRouter } from './routes/balance';
import { createSmartAccountRouter } from './routes/smartAccount';
import { createPricesRouter } from './routes/prices';
import { createTradesRouter } from './routes/trades';
import { createStatsRouter } from './routes/stats';
import { createConfigRouter } from './routes/config';
import { apiLimiter } from './middleware/rateLimit';
import { SmartAccountModel } from './models/SmartAccount';

async function main(): Promise<void> {
  await connectDb();

  const provider = new ethers.JsonRpcProvider(config.arbitrumRpcUrl);
  const relayer = new ethers.Wallet(config.relayerPrivateKey, provider);
  console.log(`[Server] Relayer address: ${relayer.address}`);

  const books = new OrderBookManager();
  const feeTreasury = config.feeTreasuryAddress || relayer.address.toLowerCase();
  const dmmService = new DMMService(provider);

  const balanceSync = new SmartAccountBalanceSync();
  const executor =
    config.alchemyApiKey.trim() !== ''
      ? new SmartAccountExecutor(config.alchemyApiKey, config.alchemyGasPolicyId || undefined)
      : null;

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', relayer: relayer.address, uptime: process.uptime() });
  });

  app.use(apiLimiter);

  app.use('/config', createConfigRouter(relayer.address));

  const server = http.createServer(app);

  const wsHolder: { ws: WsServer | null } = { ws: null };

  const engine = new MatchingEngine(books, {
    platformFeeTreasury: feeTreasury,
    onDmmRebate: (maker, makerFee) => dmmService.scheduleRebateFromFill(maker, makerFee),
    onCollateralChange: (owner) => {
      void (async () => {
        try {
          const doc = await SmartAccountModel.findOne({ ownerAddress: owner }).lean();
          if (!doc) return;
          const available = (BigInt(doc.cachedBalance || '0') - BigInt(doc.inOrders || '0')).toString();
          wsHolder.ws?.broadcastBalanceUpdate(owner, {
            wallet: owner,
            available,
            inOrders: doc.inOrders,
            cachedBalance: doc.cachedBalance,
            balanceLastSyncedAt: doc.balanceLastSyncedAt ?? null,
          });
        } catch (e) {
          console.warn('[Server] collateral broadcast failed', e);
        }
      })();
    },
  });

  wsHolder.ws = new WsServer(server, engine);

  const settlementService = new SettlementService(provider, executor, (buyer) => balanceSync.refreshOwner(buyer));
  const claimService = new ClaimService(provider, (owner) => balanceSync.refreshOwner(owner));

  app.use('/orders', createOrdersRouter(engine, dmmService));
  app.use('/dmm', createDmmRouter(dmmService));
  app.use('/markets', createMarketsRouter(books, claimService, relayer.address));
  app.use('/orderbook', createOrderBookRouter(books));
  app.use('/positions', createPositionsRouter());
  app.use('/balance', createBalanceRouter({ executor, balanceSync }));
  app.use('/prices', createPricesRouter());
  app.use('/trades', createTradesRouter());
  app.use('/stats', createStatsRouter());

  if (executor) {
    app.use('/api/smart-account', createSmartAccountRouter({ executor }));
  }

  const marketSyncer = new MarketSyncer(provider, books, claimService, wsHolder.ws, engine);

  engine.start();
  settlementService.start();
  balanceSync.start();
  marketSyncer.start();

  server.listen(config.port, () => {
    console.log(`[Server] Listening on port ${config.port}`);
    console.log(`[Server] REST API: http://localhost:${config.port}`);
    console.log(`[Server] WebSocket: ws://localhost:${config.port}/stream`);
  });

  const shutdown = () => {
    console.log('[Server] Shutting down...');
    engine.stop();
    settlementService.stop();
    balanceSync.stop();
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
