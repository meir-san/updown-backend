import { OrderBook, OrderBookManager } from './OrderBook';
import { InternalOrder, OrderSide, OrderType, OrderStatus } from './types';

function makeOrder(overrides: Partial<InternalOrder> = {}): InternalOrder {
  return {
    id: `order-${Math.random().toString(36).slice(2, 8)}`,
    maker: '0xabc',
    market: '0xpool1',
    option: 1,
    side: OrderSide.BUY,
    type: OrderType.LIMIT,
    price: 5000,
    amount: 1000000n,
    filledAmount: 0n,
    nonce: 0,
    expiry: 0,
    signature: '0x',
    status: OrderStatus.OPEN,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('OrderBook', () => {
  let book: OrderBook;

  beforeEach(() => {
    book = new OrderBook('0xpool1', 1);
  });

  it('adds buy orders and returns best bid', () => {
    book.addOrder(makeOrder({ id: 'b1', price: 5000 }));
    book.addOrder(makeOrder({ id: 'b2', price: 6000 }));
    book.addOrder(makeOrder({ id: 'b3', price: 4000 }));

    expect(book.getBestBid()).toBe(6000);
    expect(book.getOrderCount()).toBe(3);
  });

  it('adds sell orders and returns best ask', () => {
    book.addOrder(makeOrder({ id: 's1', price: 5000, side: OrderSide.SELL }));
    book.addOrder(makeOrder({ id: 's2', price: 3000, side: OrderSide.SELL }));
    book.addOrder(makeOrder({ id: 's3', price: 7000, side: OrderSide.SELL }));

    expect(book.getBestAsk()).toBe(3000);
  });

  it('maintains FIFO within same price level', () => {
    const o1 = makeOrder({ id: 'first', price: 5000, createdAt: 100 });
    const o2 = makeOrder({ id: 'second', price: 5000, createdAt: 200 });
    book.addOrder(o1);
    book.addOrder(o2);

    const popped = book.popBest(OrderSide.BUY);
    expect(popped?.id).toBe('first');
  });

  it('removes an order by ID', () => {
    book.addOrder(makeOrder({ id: 'rm1', price: 5000 }));
    book.addOrder(makeOrder({ id: 'rm2', price: 5000 }));

    const removed = book.removeOrder('rm1');
    expect(removed?.id).toBe('rm1');
    expect(book.getOrderCount()).toBe(1);
  });

  it('returns null for nonexistent order removal', () => {
    const removed = book.removeOrder('nonexistent');
    expect(removed).toBeNull();
  });

  it('generates a snapshot with aggregated depth', () => {
    book.addOrder(makeOrder({ id: 'b1', price: 5000, amount: 1000000n }));
    book.addOrder(makeOrder({ id: 'b2', price: 5000, amount: 2000000n }));
    book.addOrder(makeOrder({ id: 'b3', price: 4000, amount: 500000n }));

    const snapshot = book.getSnapshot();
    expect(snapshot.bids).toHaveLength(2);
    expect(snapshot.bids[0].price).toBe(5000);
    expect(snapshot.bids[0].depth).toBe('3000000');
    expect(snapshot.bids[0].count).toBe(2);
    expect(snapshot.bids[1].price).toBe(4000);
  });

  it('popBest removes from the top of the book', () => {
    book.addOrder(makeOrder({ id: 's1', price: 3000, side: OrderSide.SELL }));
    book.addOrder(makeOrder({ id: 's2', price: 4000, side: OrderSide.SELL }));

    const best = book.popBest(OrderSide.SELL);
    expect(best?.id).toBe('s1');
    expect(book.getBestAsk()).toBe(4000);
  });

  it('handles empty book gracefully', () => {
    expect(book.getBestBid()).toBeNull();
    expect(book.getBestAsk()).toBeNull();
    expect(book.popBest(OrderSide.BUY)).toBeNull();
    expect(book.getSnapshot().bids).toHaveLength(0);
    expect(book.getSnapshot().asks).toHaveLength(0);
  });

  it('cleans up price level when all orders removed', () => {
    book.addOrder(makeOrder({ id: 'only', price: 5000 }));
    book.removeOrder('only');
    expect(book.getBestBid()).toBeNull();
    expect(book.getOrderCount()).toBe(0);
  });
});

describe('OrderBookManager', () => {
  let mgr: OrderBookManager;

  beforeEach(() => {
    mgr = new OrderBookManager();
  });

  it('creates books on demand', () => {
    const book = mgr.getOrCreate('0xpool1', 1);
    expect(book).toBeDefined();
    expect(book.market).toBe('0xpool1');
    expect(book.option).toBe(1);
  });

  it('returns same book for same market+option', () => {
    const a = mgr.getOrCreate('0xpool1', 1);
    const b = mgr.getOrCreate('0xpool1', 1);
    expect(a).toBe(b);
  });

  it('returns different books for different options', () => {
    const up = mgr.getOrCreate('0xpool1', 1);
    const down = mgr.getOrCreate('0xpool1', 2);
    expect(up).not.toBe(down);
  });

  it('provides market snapshot with both options', () => {
    const upBook = mgr.getOrCreate('0xpool1', 1);
    upBook.addOrder(makeOrder({ id: 'u1', price: 6000 }));

    const snapshot = mgr.getMarketSnapshot('0xpool1');
    expect(snapshot.up.bids).toHaveLength(1);
    expect(snapshot.down.bids).toHaveLength(0);
  });

  it('lists all markets', () => {
    mgr.getOrCreate('0xaaa', 1);
    mgr.getOrCreate('0xbbb', 2);
    const markets = mgr.allMarkets();
    expect(markets).toContain('0xaaa');
    expect(markets).toContain('0xbbb');
  });

  it('removes market books', () => {
    mgr.getOrCreate('0xpool1', 1);
    mgr.getOrCreate('0xpool1', 2);
    mgr.removeMarket('0xpool1');
    expect(mgr.get('0xpool1', 1)).toBeUndefined();
    expect(mgr.get('0xpool1', 2)).toBeUndefined();
  });
});
