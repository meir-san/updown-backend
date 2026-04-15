// Mock config before anything else imports it
jest.mock('../config', () => ({
  config: {
    port: 3001,
    mongoUri: 'mongodb://localhost:27017/updown-test',
    arbitrumRpcUrl: 'https://arb1.arbitrum.io/rpc',
    relayerPrivateKey: '0x' + 'ab'.repeat(32),
    chainId: 42161,
    autocyclerAddress: '',
    settlementAddress: '0x1111111111111111111111111111111111111111',
    usdtAddress: '0xCa4f77A38d8552Dd1D5E44e890173921B67725F4',
    platformFeeBps: 70,
    makerFeeBps: 80,
    dmmRebateBps: 30,
    matchingIntervalMs: 100,
    settlementBatchIntervalMs: 30000,
    marketSyncIntervalMs: 15000,
    alchemyApiKey: '',
  },
  USDT_DECIMALS: 6,
  PRICE_DECIMALS: 18,
  OPTION_UP: 1,
  OPTION_DOWN: 2,
  MAX_UINT256: BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
  EIP712_DOMAIN: { name: 'UpDown Exchange', version: '1', chainId: 42161, verifyingContract: '0x0000000000000000000000000000000000000000' },
  EIP712_ORDER_TYPES: {},
  EIP712_CANCEL_TYPES: {},
  EIP712_WITHDRAW_TYPES: {},
}));

import { OrderBookManager } from './OrderBook';
import { MatchingEngine } from './MatchingEngine';
import { OrderSide, OrderType, OrderStatus, OrderParams } from './types';
import { OrderModel } from '../models/Order';

// Mock MongoDB models to avoid needing a real database
jest.mock('../models/Order', () => ({
  OrderModel: {
    create: jest.fn().mockResolvedValue({}),
    updateOne: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock('../models/Trade', () => ({
  TradeModel: {
    create: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock('../models/Market', () => ({
  MarketModel: {
    findOne: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        address: '0x1111111111111111111111111111111111111111-1',
        status: 'ACTIVE',
      }),
    }),
  },
}));

const smartAccountTest = {
  inOrders: new Map<string, bigint>(),
};

jest.mock('../models/SmartAccount', () => ({
  SmartAccountModel: {
    findOne: jest.fn().mockImplementation((q: { ownerAddress: string }) => {
      const o = q.ownerAddress.toLowerCase();
      return {
        lean: jest.fn().mockResolvedValue({
          ownerAddress: o,
          sessionKey: '0x' + '11'.repeat(32),
          smartAccountAddress: '0x' + '22'.repeat(20),
          cachedBalance: '100000000',
          inOrders: (smartAccountTest.inOrders.get(o) ?? 0n).toString(),
          withdrawNonce: 0,
        }),
      };
    }),
  },
  lockSmartAccountInOrders: jest.fn().mockImplementation(async (owner: string, amount: bigint) => {
    const o = owner.toLowerCase();
    const locked = smartAccountTest.inOrders.get(o) ?? 0n;
    const cached = 100000000n;
    if (cached - locked < amount) return false;
    smartAccountTest.inOrders.set(o, locked + amount);
    return true;
  }),
  releaseSmartAccountInOrders: jest.fn().mockImplementation(async (owner: string, amount: bigint) => {
    const o = owner.toLowerCase();
    const locked = smartAccountTest.inOrders.get(o) ?? 0n;
    if (locked < amount) return false;
    smartAccountTest.inOrders.set(o, locked - amount);
    return true;
  }),
}));

jest.mock('../models/Balance', () => ({
  settleFillBalances: jest.fn().mockResolvedValue(true),
}));

const TEST_MARKET = '0x1111111111111111111111111111111111111111-1';

function makeParams(overrides: Partial<OrderParams> = {}): OrderParams {
  return {
    maker: '0xmaker1',
    market: TEST_MARKET,
    option: 1,
    side: OrderSide.BUY,
    type: OrderType.LIMIT,
    price: 5000,
    amount: '1000000',
    nonce: Math.floor(Math.random() * 1000000),
    expiry: 0,
    signature: '0xsig',
    ...overrides,
  };
}

describe('MatchingEngine', () => {
  let books: OrderBookManager;
  let engine: MatchingEngine;

  beforeEach(() => {
    smartAccountTest.inOrders.clear();
    books = new OrderBookManager();
    engine = new MatchingEngine(books, { platformFeeTreasury: '0xtreasury' });
  });

  afterEach(() => {
    engine.stop();
  });

  it('submits a limit buy order that rests on the book', async () => {
    const order = await engine.submitOrder(
      makeParams({ maker: '0xbuyer', price: 5000, amount: '1000000' })
    );

    expect(order.id).toBeDefined();
    expect(order.status).toBe(OrderStatus.OPEN);

    // Trigger a cycle to process the order
    await (engine as any).runCycle();

    const book = books.getOrCreate(TEST_MARKET, 1);
    expect(book.getOrderCount()).toBe(1);
    expect(book.getBestBid()).toBe(5000);
  });

  it('matches crossing limit orders', async () => {
    const trades: any[] = [];
    engine.on('trade', (t: any) => trades.push(t));

    // Resting sell at 5000
    await engine.submitOrder(
      makeParams({
        maker: '0xseller',
        side: OrderSide.SELL,
        price: 5000,
        amount: '1000000',
      })
    );
    await (engine as any).runCycle();

    // Incoming buy at 5000 (crosses)
    await engine.submitOrder(
      makeParams({
        maker: '0xbuyer',
        side: OrderSide.BUY,
        price: 5000,
        amount: '1000000',
      })
    );
    await (engine as any).runCycle();

    expect(trades).toHaveLength(1);
    expect(trades[0].buyer).toBe('0xbuyer');
    expect(trades[0].seller).toBe('0xseller');
    expect(trades[0].price).toBe(5000);
  });

  it('does not match when prices do not cross', async () => {
    const trades: any[] = [];
    engine.on('trade', (t: any) => trades.push(t));

    // Sell at 6000
    await engine.submitOrder(
      makeParams({
        maker: '0xseller',
        side: OrderSide.SELL,
        price: 6000,
        amount: '1000000',
      })
    );
    await (engine as any).runCycle();

    // Buy at 4000 (does not cross)
    await engine.submitOrder(
      makeParams({
        maker: '0xbuyer',
        side: OrderSide.BUY,
        price: 4000,
        amount: '1000000',
      })
    );
    await (engine as any).runCycle();

    expect(trades).toHaveLength(0);

    const book = books.getOrCreate(TEST_MARKET, 1);
    expect(book.getOrderCount()).toBe(2);
  });

  it('handles partial fills', async () => {
    const trades: any[] = [];
    engine.on('trade', (t: any) => trades.push(t));

    // Sell 2M at 5000
    await engine.submitOrder(
      makeParams({
        maker: '0xseller',
        side: OrderSide.SELL,
        price: 5000,
        amount: '2000000',
      })
    );
    await (engine as any).runCycle();

    // Buy 1M at 5000 — partial fill of the sell
    await engine.submitOrder(
      makeParams({
        maker: '0xbuyer',
        side: OrderSide.BUY,
        price: 5000,
        amount: '1000000',
      })
    );
    await (engine as any).runCycle();

    expect(trades).toHaveLength(1);
    expect(trades[0].amount.toString()).toBe('1000000');

    // Sell order should still be on the book with 1M remaining
    const book = books.getOrCreate(TEST_MARKET, 1);
    expect(book.getOrderCount()).toBe(1);
    const snapshot = book.getSnapshot();
    expect(snapshot.asks[0].depth).toBe('1000000');
  });

  it('processes cancel before taker orders', async () => {
    const trades: any[] = [];
    engine.on('trade', (t: any) => trades.push(t));

    // Place a sell order
    const sell = await engine.submitOrder(
      makeParams({
        maker: '0xseller',
        side: OrderSide.SELL,
        price: 5000,
        amount: '1000000',
      })
    );
    await (engine as any).runCycle();

    // Submit cancel AND a matching buy in the same cycle
    engine.submitCancel(sell.id, '0xseller');
    await engine.submitOrder(
      makeParams({
        maker: '0xbuyer',
        side: OrderSide.BUY,
        price: 5000,
        amount: '1000000',
      })
    );

    await (engine as any).runCycle();

    // Cancel should be processed first — no match
    expect(trades).toHaveLength(0);
  });

  it('rejects order when balance is insufficient', async () => {
    // Drain the balance first
    await engine.submitOrder(
      makeParams({ maker: '0xlowbal', amount: '100000000' })
    );

    await expect(
      engine.submitOrder(makeParams({ maker: '0xlowbal', amount: '1' }))
    ).rejects.toThrow('Insufficient balance');
  });

  it('preserves resting maker createdAt after partial fill (time priority)', async () => {
    const sell = await engine.submitOrder(
      makeParams({
        maker: '0xseller',
        side: OrderSide.SELL,
        price: 5000,
        amount: '2000000',
      })
    );
    const createdAtBefore = sell.createdAt;
    await (engine as any).runCycle();

    await engine.submitOrder(
      makeParams({
        maker: '0xbuyer',
        side: OrderSide.BUY,
        price: 5000,
        amount: '1000000',
      })
    );
    await (engine as any).runCycle();

    const book = books.getOrCreate(TEST_MARKET, 1);
    const resting = book.getAllOrders().find((o) => o.id === sell.id);
    expect(resting?.createdAt).toBe(createdAtBefore);
  });

  it('does not match when taker and maker are the same wallet', async () => {
    const trades: any[] = [];
    engine.on('trade', (t: any) => trades.push(t));

    await engine.submitOrder(
      makeParams({
        maker: '0xsame',
        side: OrderSide.SELL,
        price: 5000,
        amount: '1000000',
      })
    );
    await (engine as any).runCycle();

    await engine.submitOrder(
      makeParams({
        maker: '0xsame',
        side: OrderSide.BUY,
        price: 5000,
        amount: '1000000',
      })
    );
    await (engine as any).runCycle();

    expect(trades).toHaveLength(0);
  });

  it('sweeps expired resting limit orders', async () => {
    const baseMs = 1_700_000_000_000;
    const spy = jest.spyOn(Date, 'now').mockReturnValue(baseMs);
    const expirySec = Math.floor(baseMs / 1000) + 30;

    await engine.submitOrder(
      makeParams({
        maker: '0xexpire',
        side: OrderSide.SELL,
        price: 5000,
        amount: '1000000',
        expiry: expirySec,
      })
    );
    await (engine as any).runCycle();

    const book = books.getOrCreate(TEST_MARKET, 1);
    expect(book.getOrderCount()).toBe(1);

    spy.mockReturnValue(baseMs + 120_000);
    await (engine as any).runCycle();
    spy.mockRestore();

    expect(book.getOrderCount()).toBe(0);
  });

  it('fills at resting order price (price improvement)', async () => {
    const trades: any[] = [];
    engine.on('trade', (t: any) => trades.push(t));

    // Sell at 4000 (cheaper ask)
    await engine.submitOrder(
      makeParams({
        maker: '0xseller',
        side: OrderSide.SELL,
        price: 4000,
        amount: '1000000',
      })
    );
    await (engine as any).runCycle();

    // Buy at 6000 — should fill at 4000 (resting price)
    await engine.submitOrder(
      makeParams({
        maker: '0xbuyer',
        side: OrderSide.BUY,
        price: 6000,
        amount: '1000000',
      })
    );
    await (engine as any).runCycle();

    expect(trades).toHaveLength(1);
    expect(trades[0].price).toBe(4000);
  });

  it('rejects POST_ONLY when it would match immediately', async () => {
    await engine.submitOrder(
      makeParams({
        maker: '0xseller',
        side: OrderSide.SELL,
        price: 5000,
        amount: '1000000',
      })
    );
    await (engine as any).runCycle();

    await expect(
      engine.submitOrder(
        makeParams({
          maker: '0xbuyer',
          type: OrderType.POST_ONLY,
          side: OrderSide.BUY,
          price: 5000,
          amount: '1000000',
        })
      )
    ).rejects.toThrow('POST_ONLY');
  });

  it('IOC does not rest unfilled remainder', async () => {
    await engine.submitOrder(
      makeParams({
        maker: '0xseller',
        side: OrderSide.SELL,
        price: 5000,
        amount: '2000000',
      })
    );
    await (engine as any).runCycle();

    await engine.submitOrder(
      makeParams({
        maker: '0xbuyer',
        type: OrderType.IOC,
        side: OrderSide.BUY,
        price: 5000,
        amount: '1000000',
      })
    );
    await (engine as any).runCycle();

    const book = books.getOrCreate(TEST_MARKET, 1);
    expect(book.getOrderCount()).toBe(1);
    expect(book.getBestAsk()).toBe(5000);
  });

  it('kill switch cancels pending and resting for one wallet quickly', async () => {
    await engine.submitOrder(
      makeParams({
        maker: '0xdmm',
        side: OrderSide.SELL,
        price: 5000,
        amount: '1000000',
      })
    );
    await (engine as any).runCycle();

    await engine.submitOrder(
      makeParams({
        maker: '0xdmm',
        side: OrderSide.BUY,
        price: 4000,
        amount: '500000',
      })
    );

    const t0 = performance.now();
    await engine.cancelAllRestingAndPendingForMarketAndWallet(TEST_MARKET, '0xdmm');
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(50);

    const book = books.getOrCreate(TEST_MARKET, 1);
    expect(book.getOrderCount()).toBe(0);
    expect(OrderModel.updateMany).toHaveBeenCalled();
  });
});
