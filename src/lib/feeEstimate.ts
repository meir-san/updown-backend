/**
 * Polymarket-style taker fee: scales with p(1−p), peaks at 50¢ (price 5000 bps), zero at extremes.
 * priceFraction = priceBps / 10_000; probabilityWeight = priceFraction * (1 − priceFraction) * 4 (max 1.0 at 50¢).
 */

export const FEE_BPS_DENOM = 10000n;
/** Internal scale for probabilityWeight (weight = weightScaled / FEE_WEIGHT_SCALE). */
export const FEE_WEIGHT_SCALE = 1_000_000n;

/**
 * Returns probabilityWeight * FEE_WEIGHT_SCALE as an integer (Polymarket taker fee formula).
 * Zero if price is outside (0, 10000) exclusive in practice; callers use 1–9999.
 */
export function probabilityWeightScaled(priceBps: bigint): bigint {
  if (priceBps <= 0n || priceBps >= FEE_BPS_DENOM) return 0n;
  return (priceBps * (FEE_BPS_DENOM - priceBps) * 4n * FEE_WEIGHT_SCALE) / (FEE_BPS_DENOM * FEE_BPS_DENOM);
}

/** Single fee leg at price: (fillAmount * feeBps * weightScaled) / (10000 * FEE_WEIGHT_SCALE). */
export function feeAtPriceBps(fillAmount: bigint, feeBps: number, priceBps: bigint): bigint {
  const w = probabilityWeightScaled(priceBps);
  if (w === 0n) return 0n;
  return (fillAmount * BigInt(feeBps) * w) / (FEE_BPS_DENOM * FEE_WEIGHT_SCALE);
}

export function calculateFeeBreakdown(
  fillAmount: bigint,
  priceBps: number,
  platformFeeBps: number,
  makerFeeBps: number
): { platformFee: bigint; makerFee: bigint } {
  const p = BigInt(priceBps);
  return {
    platformFee: feeAtPriceBps(fillAmount, platformFeeBps, p),
    makerFee: feeAtPriceBps(fillAmount, makerFeeBps, p),
  };
}

/** Sum of platform + maker fee for a hypothetical fill (for UI / config consumers). */
export function estimateTotalFee(
  fillAmount: bigint | string,
  priceBps: number,
  platformFeeBps: number,
  makerFeeBps: number
): bigint {
  const fa = typeof fillAmount === 'string' ? BigInt(fillAmount) : fillAmount;
  const { platformFee, makerFee } = calculateFeeBreakdown(fa, priceBps, platformFeeBps, makerFeeBps);
  return platformFee + makerFee;
}
