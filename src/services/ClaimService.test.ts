jest.mock('../config', () => ({
  config: {
    relayerPrivateKey:
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
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

import { ethers } from 'ethers';
import { ClaimService } from './ClaimService';
import { MarketModel } from '../models/Market';
import { TradeModel } from '../models/Trade';
import { creditBalance } from '../models/Balance';

describe('ClaimService', () => {
  const poolFinalized = jest.fn();
  const winner = jest.fn();
  const claimWait = jest.fn();
  const claimTx = { wait: claimWait };
  let contractSpy: jest.SpyInstance;
  let walletSpy: jest.SpyInstance;

  let service: ClaimService;

  beforeEach(() => {
    jest.clearAllMocks();
    poolFinalized.mockResolvedValue(true);
    winner.mockResolvedValue(1n);
    claimWait.mockResolvedValue({ hash: '0xclaim' });

    walletSpy = jest.spyOn(ethers, 'Wallet').mockImplementation(
      () =>
        ({
          address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        }) as unknown as ethers.Wallet
    );

    contractSpy = jest.spyOn(ethers, 'Contract').mockImplementation(
      () =>
        ({
          poolFinalized,
          winner,
          claim: jest.fn(() => Promise.resolve(claimTx)),
        }) as unknown as ethers.Contract
    );

    service = new ClaimService(new ethers.JsonRpcProvider('http://127.0.0.1:8545'));
  });

  afterEach(() => {
    contractSpy.mockRestore();
    walletSpy.mockRestore();
  });

  it('sets claimedByRelayer after successful claim before distribution', async () => {
    const marketDoc = {
      _id: 'm1',
      address: '0xpool',
      claimedByRelayer: false,
      claimDistributionComplete: false,
    };
    (MarketModel.findOne as jest.Mock).mockResolvedValue(marketDoc);
    (TradeModel.find as jest.Mock).mockResolvedValueOnce([
      { buyer: '0xb1', amount: '100' },
    ]).mockResolvedValueOnce([]);

    await service.processResolvedMarket('0xpool');

    const updateCalls = (MarketModel.updateOne as jest.Mock).mock.calls;
    const claimFlagUpdate = updateCalls.find(
      (c) => c[1]?.$set?.claimedByRelayer === true
    );
    expect(claimFlagUpdate).toBeDefined();

    expect(creditBalance).toHaveBeenCalled();
  });

  it('skips claim when claimDistributionComplete', async () => {
    (MarketModel.findOne as jest.Mock).mockResolvedValue({
      claimDistributionComplete: true,
    });
    await service.processResolvedMarket('0xpool');
    expect(poolFinalized).not.toHaveBeenCalled();
  });

  it('credits relayer dust when payouts do not exhaust totalPool', async () => {
    (MarketModel.findOne as jest.Mock).mockResolvedValue({
      _id: 'm1',
      address: '0xpool',
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

    await service.processResolvedMarket('0xpool');

    const relayer = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'.toLowerCase();
    const dustCredit = (creditBalance as jest.Mock).mock.calls.find(
      (c) => c[0] === relayer
    );
    expect(dustCredit).toBeDefined();
    expect(dustCredit[1] > 0n).toBe(true);
  });
});
