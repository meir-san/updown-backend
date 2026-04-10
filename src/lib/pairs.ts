import { keccak256, toUtf8Bytes } from 'ethers';

/** On-chain `bytes32` pair ids (same as `keccak256(utf8("…"))` in Solidity). */
export const PAIR_BTC_USD_HASH = keccak256(toUtf8Bytes('BTC/USD')).toLowerCase();
export const PAIR_ETH_USD_HASH = keccak256(toUtf8Bytes('ETH/USD')).toLowerCase();

/** API / UI labels */
export type PairSymbol = 'BTC-USD' | 'ETH-USD';

const HASH_TO_SYMBOL: Record<string, PairSymbol> = {
  [PAIR_BTC_USD_HASH]: 'BTC-USD',
  [PAIR_ETH_USD_HASH]: 'ETH-USD',
};

const SYMBOL_TO_HASH: Record<PairSymbol, string> = {
  'BTC-USD': PAIR_BTC_USD_HASH,
  'ETH-USD': PAIR_ETH_USD_HASH,
};

/** Price chart / upstream history symbol (speed-markets proxy). */
export function chartSymbolForPair(pairSymbol: PairSymbol): 'BTC' | 'ETH' {
  return pairSymbol.startsWith('ETH') ? 'ETH' : 'BTC';
}

/** Resolve `bytes32` from chain (hex string) to stable API symbol. */
export function pairSymbolFromPairHash(pairHash: string): PairSymbol | string {
  const h = pairHash.toLowerCase();
  return HASH_TO_SYMBOL[h] ?? pairHash;
}

/** Parse `GET ?pair=btc-usd` (case-insensitive). */
export function parsePairQueryParam(raw: string | undefined): PairSymbol | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = raw.trim().toUpperCase().replace(/\//g, '-');
  if (n === 'BTC-USD') return 'BTC-USD';
  if (n === 'ETH-USD') return 'ETH-USD';
  return undefined;
}

export function pairHashForSymbol(sym: PairSymbol): string {
  return SYMBOL_TO_HASH[sym];
}
