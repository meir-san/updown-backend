import { ethers } from 'ethers';

const COMPOSITE_RE = /^(0x[a-fA-F0-9]{40})-(\d+)$/;

export type ParsedCompositeMarket = {
  settlementAddress: string;
  /** Decimal string (uint256-safe). */
  marketId: string;
};

export function parseCompositeMarketKey(market: string): ParsedCompositeMarket | null {
  const m = market.trim().match(COMPOSITE_RE);
  if (!m) return null;
  return { settlementAddress: m[1].toLowerCase(), marketId: m[2] };
}

export function compositeMarketAddress(settlement: string, marketId: bigint | number | string): string {
  const s = settlement.toLowerCase();
  const id = typeof marketId === 'bigint' ? marketId.toString() : String(marketId);
  return `${s}-${id}`;
}

/** True if composite matches configured settlement (when configured). */
export function compositeMatchesSettlement(
  parsed: ParsedCompositeMarket,
  settlementAddress: string
): boolean {
  const cfg = settlementAddress.toLowerCase();
  if (!cfg || cfg === ethers.ZeroAddress) return true;
  return parsed.settlementAddress === cfg;
}
