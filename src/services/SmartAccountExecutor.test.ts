jest.mock('../config', () => ({
  config: {
    arbitrumRpcUrl: 'http://127.0.0.1:8545',
    chainId: 42161,
    usdtAddress: '0x1111111111111111111111111111111111111111',
    settlementAddress: '0x2222222222222222222222222222222222222222',
  },
}));

import { SmartAccountExecutor } from './SmartAccountExecutor';

describe('SmartAccountExecutor', () => {
  it('constructs with api key', () => {
    const ex = new SmartAccountExecutor('demo-key');
    expect(ex).toBeDefined();
  });
});
