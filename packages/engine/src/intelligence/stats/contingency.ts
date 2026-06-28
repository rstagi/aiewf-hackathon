/**
 * Stratified 2×2 analysis (§4.3): odds ratios, Cochran–Mantel–Haenszel pooled OR,
 * Breslow–Day homogeneity, and the Simpson's-paradox / hard-intent confound check.
 *
 * Convention per stratum: { a, b, c, d } where
 *   a = exposed & success, b = exposed & failure,
 *   c = unexposed & success, d = unexposed & failure.
 */

import { chiSquareSurvival } from "./special";

export interface Stratum {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** Odds ratio with Haldane–Anscombe +0.5 correction when any cell is zero. */
export function oddsRatio2x2(a: number, b: number, c: number, d: number): number {
  if (a === 0 || b === 0 || c === 0 || d === 0) {
    a += 0.5;
    b += 0.5;
    c += 0.5;
    d += 0.5;
  }
  return (a * d) / (b * c);
}

/** Cochran–Mantel–Haenszel common odds ratio across strata. */
export function cmhCommonOR(strata: Stratum[]): number {
  let num = 0;
  let den = 0;
  for (const { a, b, c, d } of strata) {
    const n = a + b + c + d;
    if (n === 0) continue;
    num += (a * d) / n;
    den += (b * c) / n;
  }
  return den === 0 ? Infinity : num / den;
}

/** Pool strata into a single marginal 2×2 (collapsing the stratifier). */
export function collapse(strata: Stratum[]): Stratum {
  return strata.reduce(
    (acc, s) => ({ a: acc.a + s.a, b: acc.b + s.b, c: acc.c + s.c, d: acc.d + s.d }),
    { a: 0, b: 0, c: 0, d: 0 },
  );
}

export interface BreslowDayResult {
  stat: number;
  df: number;
  p: number;
}

/**
 * Breslow–Day test of odds-ratio homogeneity across strata. Tests whether ONE pooled
 * OR is valid; it is NOT a test of whether to adjust (always adjust when stratified).
 * If it rejects, report per-stratum ORs instead of a single CMH OR.
 */
export function breslowDay(strata: Stratum[], psi = cmhCommonOR(strata)): BreslowDayResult {
  let stat = 0;
  for (const { a, b, c, d } of strata) {
    const n1 = a + b; // exposed total
    const m1 = a + c; // success total
    const t = a + b + c + d;
    if (t === 0) continue;
    // Expected exposed-success cell A under common OR psi solves a quadratic.
    let aExp: number;
    if (Math.abs(psi - 1) < 1e-9) {
      aExp = (n1 * m1) / t;
    } else {
      const A = psi - 1;
      const B = (1 - psi) * (n1 + m1) - t;
      const C = psi * n1 * m1;
      const disc = Math.sqrt(Math.max(0, B * B - 4 * A * C));
      const root1 = (-B - disc) / (2 * A);
      const root2 = (-B + disc) / (2 * A);
      const lo = Math.max(0, n1 + m1 - t);
      const hi = Math.min(n1, m1);
      aExp = root1 >= lo - 1e-9 && root1 <= hi + 1e-9 ? root1 : root2;
    }
    const bExp = n1 - aExp;
    const cExp = m1 - aExp;
    const dExp = t - n1 - m1 + aExp;
    const variance = 1 / (1 / aExp + 1 / bExp + 1 / cExp + 1 / dExp);
    if (variance > 0) stat += ((a - aExp) * (a - aExp)) / variance;
  }
  const df = Math.max(1, strata.length - 1);
  return { stat, df, p: chiSquareSurvival(stat, df) };
}

export interface SimpsonResult {
  crudeOR: number;
  cmhOR: number;
  /** crude and adjusted ORs fall on opposite sides of 1 (a Simpson reversal). */
  directionDisagree: boolean;
  /** Material magnitude shift even without a reversal (confounding). */
  magnitudeShift: boolean;
  /** Do not raise a flag on the marginal association when confounding is present. */
  suppressMarginalFlag: boolean;
}

/**
 * Simpson's-paradox / hard-intent confound check (§4.3): compare the crude (marginal)
 * OR against the CMH-adjusted OR. A direction disagreement means the marginal
 * association is an artifact of the confounder — do NOT flag on it.
 */
export function simpsonCheck(strata: Stratum[], magnitudeRatio = 2): SimpsonResult {
  const m = collapse(strata);
  const crudeOR = oddsRatio2x2(m.a, m.b, m.c, m.d);
  const cmhOR = cmhCommonOR(strata);
  const crudeSide = Math.sign(crudeOR - 1);
  const cmhSide = Math.sign(cmhOR - 1);
  const directionDisagree = crudeSide !== 0 && cmhSide !== 0 && crudeSide !== cmhSide;
  const ratio = crudeOR / cmhOR;
  const magnitudeShift = !directionDisagree && (ratio > magnitudeRatio || ratio < 1 / magnitudeRatio);
  return {
    crudeOR,
    cmhOR,
    directionDisagree,
    magnitudeShift,
    suppressMarginalFlag: directionDisagree || magnitudeShift,
  };
}
