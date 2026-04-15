jest.mock('../config', () => ({
  config: {
    relayerPrivateKey:
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    arbitrumRpcUrl: 'http://127.0.0.1:8545',
    chainId: 42161,
    autocyclerAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    settlementAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    marketSyncIntervalMs: 600000,
  },
}));

jest.mock('../models/Market', () => ({
  MarketModel: {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    }),
    findOneAndUpdate: jest.fn().mockResolvedValue({}),
  },
}));

import { ethers } from 'ethers';
import { MarketSyncer } from './MarketSyncer';
import type { ClaimService } from './ClaimService';
import { OrderBookManager } from '../engine/OrderBook';
import { MatchingEngine } from '../engine/MatchingEngine';
import { MarketModel } from '../models/Market';

describe('MarketSyncer', () => {
  it('upserts composite address and marketId from activeMarkets', async () => {
    const pairId =
      '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`;

    const cyclerMock = {
      activeMarketCount: jest.fn().mockResolvedValue(1n),
      activeMarkets: jest.fn().mockResolvedValue([5n, 1_700_000_000n, pairId]),
    };

    const settlementMock = {
      markets: jest.fn().mockResolvedValue({
        pairId,
        startTime: 1_699_999_900n,
        endTime: 1_700_000_000n,
        duration: 100n,
        strikePrice: 12345n,
        lastPrice: 0n,
        winner: 0,
        resolved: false,
        claimed: false,
        upTotal: 10n,
        downTotal: 20n,
      }),
    };

    const contractSpy = jest.spyOn(ethers, 'Contract').mockImplementation(
      ((addr: string) => {
        if (addr === '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') return cyclerMock as any;
        if (addr === '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb') return settlementMock as any;
        throw new Error(`unexpected contract ${addr}`);
      }) as never
    );

    const books = new OrderBookManager();
    const claim = { processResolvedMarket: jest.fn() } as unknown as ClaimService;
    const engine = new MatchingEngine(books, { platformFeeTreasury: '0xt' });
    const syncer = new MarketSyncer(
      new ethers.JsonRpcProvider('http://127.0.0.1:8545'),
      books,
      claim,
      null,
      engine
    );

    await (syncer as any).sync();

    expect(MarketModel.findOneAndUpdate).toHaveBeenCalledWith(
      { address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-5' },
      expect.objectContaining({
        address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-5',
        marketId: '5',
        settlementAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        endTime: 1_700_000_000,
      }),
      { upsert: true, new: true }
    );

    contractSpy.mockRestore();
  });
});
