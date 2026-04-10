// Mock config before anything else imports it
jest.mock('../config', () => ({
  config: {
    port: 3001,
    mongoUri: 'mongodb://localhost:27017/updown-test',
    arbitrumRpcUrl: 'https://arb1.arbitrum.io/rpc',
    relayerPrivateKey: '0x' + 'ab'.repeat(32),
    chainId: 42161,
    autocyclerAddress: '',
    factoryAddress: '0x05b1fd504583B81bd14c368d59E8c3e354b6C1dc',
    usdtAddress: '0xCa4f77A38d8552Dd1D5E44e890173921B67725F4',
    platformFeeBps: 70,
    makerFeeBps: 80,
    matchingIntervalMs: 100,
    settlementBatchIntervalMs: 30000,
    marketSyncIntervalMs: 15000,
    depositConfirmations: 3,
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

// Mock MongoDB models to avoid needing a real database
jest.mock('../models/Order', () => ({
  OrderModel: {
    create: jest.fn().mockResolvedValue({}),
    updateOne: jest.fn().mockResolvedValue({}),
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
      lean: jest.fn().mockResolvedValue({ address: '0xpool1', status: 'ACTIVE' }),
    }),
  },
}));

jest.mock('../models/Balance', () => {
  const balances = new Map<string, { available: bigint; inOrders: bigint }>();

  function getBalance(wallet: string) {
    if (!balances.has(wallet)) {
      balances.set(wallet, { available: 100000000n, inOrders: 0n });
    }
    return balances.get(wallet)!;
  }

  return {
    debitAvailable: jest.fn().mockImplementation(async (wallet: string, amount: bigint) => {
      const bal = getBalance(wallet);
      if (bal.available < amount) return false;
      bal.available -= amount;
      bal.inOrders += amount;
      return true;
    }),
    releaseFromOrders: jest.fn().mockImplementation(async (wallet: string, amount: bigint) => {
      const bal = getBalance(wallet);
      if (bal.inOrders < amount) return false;
      bal.inOrders -= amount;
      bal.available += amount;
      return true;
    }),
    settleFillBalances: jest
      .fn()
      .mockImplementation(
        async (
          buyer: string,
          seller: string,
          treasury: string,
          fillAmount: bigint,
          platformFee: bigint,
          sellerReceives: bigint,
          makerFee: bigint
        ) => {
          const buyerBal = getBalance(buyer);
          if (buyerBal.inOrders < fillAmount) return false;
          buyerBal.inOrders -= fillAmount;
          const sellerBal = getBalance(seller);
          sellerBal.available += sellerReceives + makerFee;
          const treasBal = getBalance(treasury);
          treasBal.available += platformFee;
          return true;
        }
      ),
    _reset: () => balances.clear(),
    _getBalance: getBalance,
  };
});

const { _reset, _getBalance } = require('../models/Balance');

function makeParams(overrides: Partial<OrderParams> = {}): OrderParams {
  return {
    maker: '0xmaker1',
    market: '0xpool1',
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
    _reset();
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

    const book = books.getOrCreate('0xpool1', 1);
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

    const book = books.getOrCreate('0xpool1', 1);
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
    const book = books.getOrCreate('0xpool1', 1);
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

    const book = books.getOrCreate('0xpool1', 1);
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

    const book = books.getOrCreate('0xpool1', 1);
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
});
