jest.mock('../models/Balance', () => ({
  reverseSettledFill: jest.fn().mockResolvedValue(true),
}));

jest.mock('../models/SmartAccount', () => ({
  SmartAccountModel: {
    findOne: jest.fn(),
  },
}));

jest.mock('../config', () => ({
  config: {
    relayerPrivateKey:
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    usdtAddress: '0x0000000000000000000000000000000000000001',
    settlementAddress: '0x2222222222222222222222222222222222222222',
    feeTreasuryAddress: '',
    chainId: 42161,
  },
  MAX_UINT256: BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
  OPTION_UP: 1,
  OPTION_DOWN: 2,
}));

jest.mock('../models/Trade', () => ({
  TradeModel: {
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({}),
  },
}));

import { ethers } from 'ethers';
import { SettlementService } from './SettlementService';
import { TradeModel } from '../models/Trade';
import { SmartAccountModel } from '../models/SmartAccount';

const COMPOSITE = '0x2222222222222222222222222222222222222222-99' as const;

describe('SettlementService', () => {
  let walletSpy: jest.SpyInstance;
  const executor = {
    ensureUsdtApproval: jest.fn().mockResolvedValue(undefined),
    enterPosition: jest.fn().mockResolvedValue('0xconfirmeduserop'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    executor.ensureUsdtApproval.mockResolvedValue(undefined);
    executor.enterPosition.mockResolvedValue('0xconfirmeduserop');
    walletSpy = jest.spyOn(ethers, 'Wallet').mockImplementation(
      () =>
        ({
          address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        }) as unknown as ethers.Wallet
    );
    (SmartAccountModel.findOne as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        ownerAddress: '0xbuyer',
        sessionKey: '0x' + '11'.repeat(32),
        smartAccountAddress: '0x' + 'aa'.repeat(20),
      }),
    });
  });

  afterEach(() => {
    walletSpy.mockRestore();
  });

  it('locks trades with PENDING→SUBMITTED before calling enterPosition per buyer', async () => {
    const trade = {
      tradeId: 't1',
      market: COMPOSITE,
      buyer: '0xbuyer',
      option: 1,
      amount: '100',
      settlementRetryCount: 0,
      settlementNextRetryAt: null,
    };
    (TradeModel.find as jest.Mock).mockReturnValue({
      limit: jest.fn().mockResolvedValue([trade]),
    });
    (TradeModel.findOneAndUpdate as jest.Mock).mockImplementation((filter: { tradeId: string }) => {
      if (filter.tradeId === 't1') {
        return Promise.resolve({ ...trade, settlementStatus: 'SUBMITTED' });
      }
      return Promise.resolve(null);
    });

    const svc = new SettlementService(
      new ethers.JsonRpcProvider('http://127.0.0.1:8545'),
      executor as never,
      jest.fn()
    );
    await (svc as any).settleBatch();

    expect(TradeModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ tradeId: 't1', settlementStatus: 'PENDING' }),
      { $set: { settlementStatus: 'SUBMITTED' } },
      { new: true }
    );
    expect(executor.enterPosition).toHaveBeenCalledWith(
      expect.any(String),
      99n,
      1,
      100n
    );
  });

  it('on failure increments retryCount and keeps PENDING until max retries', async () => {
    const trade = {
      tradeId: 't2',
      market: COMPOSITE,
      buyer: '0xbuyer',
      option: 2,
      amount: '50',
      settlementRetryCount: 0,
      settlementNextRetryAt: null,
    };
    (TradeModel.find as jest.Mock).mockReturnValue({
      limit: jest.fn().mockResolvedValue([trade]),
    });
    (TradeModel.findOneAndUpdate as jest.Mock).mockResolvedValue({ ...trade, settlementStatus: 'SUBMITTED' });
    executor.enterPosition.mockRejectedValue(new Error('rpc fail'));

    const svc = new SettlementService(
      new ethers.JsonRpcProvider('http://127.0.0.1:8545'),
      executor as never,
      jest.fn()
    );
    await (svc as any).settleBatch();

    expect(TradeModel.updateOne).toHaveBeenCalledWith(
      { tradeId: 't2' },
      expect.objectContaining({
        $set: expect.objectContaining({
          settlementStatus: 'PENDING',
          settlementRetryCount: 1,
        }),
      })
    );
  });
});
