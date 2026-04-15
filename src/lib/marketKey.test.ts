import { compositeMarketAddress, parseCompositeMarketKey } from './marketKey';

describe('marketKey', () => {
  it('parses composite settlement-marketId', () => {
    const p = parseCompositeMarketKey('0x1234567890123456789012345678901234567890-42');
    expect(p).toEqual({
      settlementAddress: '0x1234567890123456789012345678901234567890',
      marketId: '42',
    });
  });

  it('rejects invalid composite', () => {
    expect(parseCompositeMarketKey('0xpool')).toBeNull();
    expect(parseCompositeMarketKey('nope')).toBeNull();
  });

  it('builds composite address', () => {
    expect(compositeMarketAddress('0xAbCdef0123456789abcdef0123456789abcdef0', 7n)).toBe(
      '0xabcdef0123456789abcdef0123456789abcdef0-7'
    );
  });
});
