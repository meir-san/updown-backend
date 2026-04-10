import type { PairSymbol } from './pairs';
import { chartSymbolForPair, pairSymbolFromPairHash } from './pairs';

type LeanMarket = {
  pairId: string;
  pairSymbol?: string;
  pairIdHex?: string;
  [key: string]: unknown;
};

/** Attach `pairSymbol` and `chartSymbol` for API consumers. */
export function enrichMarketLean(m: LeanMarket): Record<string, unknown> {
  let pairSymbol: string = m.pairSymbol ?? '';
  if (!pairSymbol && m.pairIdHex) {
    const r = pairSymbolFromPairHash(m.pairIdHex);
    pairSymbol = r === 'BTC-USD' || r === 'ETH-USD' ? r : '';
  }
  if (!pairSymbol && (m.pairId === 'BTC-USD' || m.pairId === 'ETH-USD')) {
    pairSymbol = m.pairId;
  }
  if (!pairSymbol) {
    pairSymbol = m.pairId || 'UNKNOWN';
  }

  const chartSymbol =
    pairSymbol === 'BTC-USD' || pairSymbol === 'ETH-USD'
      ? chartSymbolForPair(pairSymbol as PairSymbol)
      : 'BTC';

  const { pairIdHex: _h, ...rest } = m;
  return {
    ...rest,
    pairSymbol: pairSymbol === 'UNKNOWN' ? m.pairId : pairSymbol,
    chartSymbol,
  };
}
