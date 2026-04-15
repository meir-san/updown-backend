import { tryConsumeOrderRate, tryConsumeBulkOrderRate } from './orderRateLimit';
import type { DMMService } from '../services/DMMService';

function mockDmm(isDmm: boolean): DMMService {
  return { resolveIsDmm: jest.fn().mockResolvedValue(isDmm) } as unknown as DMMService;
}

describe('orderRateLimit', () => {
  it('allows 10 orders/sec for standard makers', async () => {
    const dmm = mockDmm(false);
    const wallet = `0x${'b'.repeat(40)}`;
    for (let i = 0; i < 10; i++) {
      expect(await tryConsumeOrderRate(wallet, 1, dmm)).toBe(true);
    }
    expect(await tryConsumeOrderRate(wallet, 1, dmm)).toBe(false);
  });

  it('allows 100 orders/sec for DMM makers', async () => {
    const dmm = mockDmm(true);
    const wallet = `0x${'c'.repeat(40)}`;
    for (let i = 0; i < 100; i++) {
      expect(await tryConsumeOrderRate(wallet, 1, dmm)).toBe(true);
    }
    expect(await tryConsumeOrderRate(wallet, 1, dmm)).toBe(false);
  });

  it('bulk charges each maker independently', async () => {
    const dmm = mockDmm(false);
    const a = `0x${'d'.repeat(40)}`;
    const b = `0x${'e'.repeat(40)}`;
    expect(
      await tryConsumeBulkOrderRate(
        [
          { maker: a },
          { maker: a },
          { maker: b },
        ],
        dmm
      )
    ).toBe(true);
  });
});
