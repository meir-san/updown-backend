jest.mock('../config', () => ({
  config: {
    relayerPrivateKey:
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    settlementAddress: '0x1234567890123456789012345678901234567890',
    usdtAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  },
}));

jest.mock('../models/Market', () => ({
  MarketModel: {
    findOne: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    findOneAndUpdate: jest.fn().mockResolvedValue({ _id: 'm1' }),
  },
}));

jest.mock('../models/Trade', () => ({
  TradeModel: {
    find: jest.fn(),
  },
}));

jest.mock('../models/ClaimPayoutLog', () => ({
  ClaimPayoutLogModel: {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock('../models/Balance', () => ({
  creditBalance: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../models/SmartAccount', () => ({
  SmartAccountModel: {
    findOne: jest.fn(),
  },
}));

import { ethers } from 'ethers';
import { ClaimService } from './ClaimService';
import { MarketModel } from '../models/Market';
import { TradeModel } from '../models/Trade';
import { creditBalance } from '../models/Balance';
import { SmartAccountModel } from '../models/SmartAccount';

describe('ClaimService', () => {
  const getMarket = jest.fn();
  const withdrawSettlement = jest.fn();
  const withdrawWait = jest.fn();
  const withdrawTx = { wait: withdrawWait };
  const usdtTransfer = jest.fn();
  const usdtTransferWait = jest.fn();
  const usdtTx = { wait: usdtTransferWait };
  let contractSpy: jest.SpyInstance;
  let walletSpy: jest.SpyInstance;

  let service: ClaimService;

  beforeEach(() => {
    jest.clearAllMocks();
    getMarket.mockResolvedValue({
      resolved: true,
      winner: 1n,
    });
    withdrawWait.mockResolvedValue({ hash: '0xclaim' });
    usdtTransferWait.mockResolvedValue({ status: 1 });

    walletSpy = jest.spyOn(ethers, 'Wallet').mockImplementation(
      () =>
        ({
          address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        }) as unknown as ethers.Wallet
    );

    withdrawSettlement.mockImplementation(() => Promise.resolve(withdrawTx));
    usdtTransfer.mockImplementation(() => Promise.resolve(usdtTx));

    contractSpy = jest.spyOn(ethers, 'Contract').mockImplementation((addr: string | ethers.Addressable) => {
      const a = String(addr).toLowerCase();
      if (a === '0x1234567890123456789012345678901234567890') {
        return {
          getMarket,
          withdrawSettlement,
        } as unknown as ethers.Contract;
      }
      return {
        transfer: usdtTransfer,
      } as unknown as ethers.Contract;
    });

    (SmartAccountModel.findOne as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        ownerAddress: '0xb1',
        smartAccountAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    });

    service = new ClaimService(new ethers.JsonRpcProvider('http://127.0.0.1:8545'));
  });

  afterEach(() => {
    contractSpy.mockRestore();
    walletSpy.mockRestore();
  });

  it('sets claimedByRelayer after successful claim before distribution', async () => {
    const marketDoc = {
      _id: 'm1',
      address: '0x1234567890123456789012345678901234567890-7',
      marketId: '7',
      claimedByRelayer: false,
      claimDistributionComplete: false,
    };
    (MarketModel.findOne as jest.Mock).mockResolvedValue(marketDoc);
    (TradeModel.find as jest.Mock).mockResolvedValueOnce([
      { buyer: '0xb1', amount: '100' },
    ]).mockResolvedValueOnce([]);

    await service.processResolvedMarket('0x1234567890123456789012345678901234567890-7');

    const updateCalls = (MarketModel.updateOne as jest.Mock).mock.calls;
    const claimFlagUpdate = updateCalls.find(
      (c) => c[1]?.$set?.claimedByRelayer === true
    );
    expect(claimFlagUpdate).toBeDefined();

    expect(usdtTransfer).toHaveBeenCalled();
  });

  it('skips claim when claimDistributionComplete', async () => {
    (MarketModel.findOne as jest.Mock).mockResolvedValue({
      claimDistributionComplete: true,
    });
    await service.processResolvedMarket('0x1234567890123456789012345678901234567890-7');
    expect(getMarket).not.toHaveBeenCalled();
  });

  it('credits relayer dust when payouts do not exhaust totalPool', async () => {
    (MarketModel.findOne as jest.Mock).mockResolvedValue({
      _id: 'm1',
      address: '0x1234567890123456789012345678901234567890-7',
      marketId: '7',
      claimedByRelayer: true,
      claimDistributionComplete: false,
    });
    (TradeModel.find as jest.Mock)
      .mockResolvedValueOnce([
        { buyer: '0xb1', amount: '1' },
        { buyer: '0xb2', amount: '1' },
      ])
      .mockResolvedValueOnce([{ amount: '1' }]);
    (MarketModel.findOneAndUpdate as jest.Mock).mockResolvedValue({ _id: 'm1' });

    (SmartAccountModel.findOne as jest.Mock).mockImplementation((q: { ownerAddress?: string }) => ({
      lean: jest.fn().mockResolvedValue({
        smartAccountAddress:
          (q.ownerAddress ?? '') === '0xb2'
            ? '0xcccccccccccccccccccccccccccccccccccccccc'
            : '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
    }));

    await service.processResolvedMarket('0x1234567890123456789012345678901234567890-7');

    const relayer = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'.toLowerCase();
    const dustCredit = (creditBalance as jest.Mock).mock.calls.find(
      (c) => c[0] === relayer
    );
    expect(dustCredit).toBeDefined();
    expect(dustCredit[1] > 0n).toBe(true);
  });
});
