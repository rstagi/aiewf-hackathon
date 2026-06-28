/**
 * Proportion inference (§4.1, §4.2).
 *
 * Funnel/grid conversions sit near 0 or 1, so we use the Wilson score interval
 * (not normal-approx) for CIs and Fisher's exact test (not a z-test) for the
 * two-proportion comparison at each funnel stage.
 */

import { logChoose } from "./special";

/** Wilson score interval for a binomial proportion. n=0 → [0,1]. */
export function wilsonCI(successes: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 1];
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/** Hypergeometric pmf for cell `a` given fixed margins of a 2×2 table. */
function hyperPmf(a: number, r1: number, r2: number, c1: number): number {
  const N = r1 + r2;
  return Math.exp(logChoose(r1, a) + logChoose(r2, c1 - a) - logChoose(N, c1));
}

/**
 * Two-sided Fisher's exact test for a 2×2 table:
 *   [[a, b], [c, d]]
 * Sums the probability of every table (same margins) no more likely than observed.
 */
export function fisherExact2x2(a: number, b: number, c: number, d: number): number {
  const r1 = a + b;
  const r2 = c + d;
  const c1 = a + c;
  const lo = Math.max(0, c1 - r2);
  const hi = Math.min(r1, c1);
  const pObs = hyperPmf(a, r1, r2, c1);
  let p = 0;
  for (let x = lo; x <= hi; x++) {
    const px = hyperPmf(x, r1, r2, c1);
    if (px <= pObs * (1 + 1e-7)) p += px;
  }
  return Math.min(1, p);
}

export interface TwoPropResult {
  p: number;
  method: "fisher";
}

/**
 * Compare two proportions k1/n1 vs k2/n2. Uses Fisher's exact (two-sided) — correct
 * near the 0/1 boundaries where the normal approximation fails (§4.1).
 */
export function twoProportionTest(k1: number, n1: number, k2: number, n2: number): TwoPropResult {
  return { p: fisherExact2x2(k1, n1 - k1, k2, n2 - k2), method: "fisher" };
}
