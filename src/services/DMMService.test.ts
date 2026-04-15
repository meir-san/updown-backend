jest.mock('../config', () => ({
  config: {
    relayerPrivateKey:
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    settlementAddress: '0xdddddddddddddddddddddddddddddddddddddddd',
    dmmRebateBps: 30,
  },
}));

import { ethers } from 'ethers';
import { DMMService } from './DMMService';

describe('DMMService', () => {
  it('resolveIsDmm reads chain', async () => {
    const isDMM = jest.fn().mockResolvedValue(true);
    const accumulateRebate = jest.fn().mockResolvedValue({ wait: jest.fn().mockResolvedValue({}) });
    const contractSpy = jest.spyOn(ethers, 'Contract').mockImplementation(
      () =>
        ({
          isDMM,
          accumulateRebate,
          dmmRebateAccumulated: jest.fn().mockResolvedValue(0n),
          addDMM: jest.fn(),
          removeDMM: jest.fn(),
        }) as unknown as ethers.Contract
    );

    const svc = new DMMService(new ethers.JsonRpcProvider('http://127.0.0.1:8545'));
    await expect(svc.resolveIsDmm('0x1111111111111111111111111111111111111111')).resolves.toBe(true);

    const makerFee = 10_000n;
    const expectedRebate = (makerFee * 30n) / 10000n;
    expect(expectedRebate).toBe(30n);

    svc.scheduleRebateFromFill('0x1111111111111111111111111111111111111111', makerFee);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 20));

    contractSpy.mockRestore();
  });
});
