jest.mock('../models/Balance', () => ({
  reverseSettledFill: jest.fn().mockResolvedValue(true),
}));

jest.mock('../config', () => ({
  config: {
    relayerPrivateKey:
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    usdtAddress: '0x0000000000000000000000000000000000000001',
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

describe('SettlementService', () => {
  const enterOptionMock = jest.fn();
  let contractSpy: jest.SpyInstance;
  let walletSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    enterOptionMock.mockResolvedValue({
      hash: '0xenter',
      wait: jest.fn().mockResolvedValue({ status: 1, hash: '0xconfirmed' }),
    });

    walletSpy = jest.spyOn(ethers, 'Wallet').mockImplementation(
      () =>
        ({
          address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        }) as unknown as ethers.Wallet
    );

    contractSpy = jest.spyOn(ethers, 'Contract').mockImplementation(
      () =>
        ({
          enterOption: (...args: unknown[]) => enterOptionMock(...args),
          allowance: jest.fn(() =>
            Promise.resolve(BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'))
          ),
          approve: jest.fn(() => Promise.resolve({ wait: jest.fn().mockResolvedValue({}) })),
        }) as unknown as ethers.Contract
    );
  });

  afterEach(() => {
    contractSpy.mockRestore();
    walletSpy.mockRestore();
  });

  it('locks trades with PENDING→SUBMITTED before calling enterOption', async () => {
    const trade = {
      tradeId: 't1',
      market: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
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

    const svc = new SettlementService(new ethers.JsonRpcProvider('http://127.0.0.1:8545'));
    await (svc as any).settleBatch();

    expect(TradeModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ tradeId: 't1', settlementStatus: 'PENDING' }),
      { $set: { settlementStatus: 'SUBMITTED' } },
      { new: true }
    );
    expect(enterOptionMock).toHaveBeenCalled();
  });

  it('on failure increments retryCount and keeps PENDING until max retries', async () => {
    const trade = {
      tradeId: 't2',
      market: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      option: 2,
      amount: '50',
      settlementRetryCount: 0,
      settlementNextRetryAt: null,
    };
    (TradeModel.find as jest.Mock).mockReturnValue({
      limit: jest.fn().mockResolvedValue([trade]),
    });
    (TradeModel.findOneAndUpdate as jest.Mock).mockResolvedValue({ ...trade, settlementStatus: 'SUBMITTED' });
    enterOptionMock.mockRejectedValue(new Error('rpc fail'));

    const svc = new SettlementService(new ethers.JsonRpcProvider('http://127.0.0.1:8545'));
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
