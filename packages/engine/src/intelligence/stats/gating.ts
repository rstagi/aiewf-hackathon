/**
 * Flag gating and ranking (§4.3).
 *
 * Two gates before any flag is emitted, then ranking by effect size — never by a
 * q×effect product (which mixes two incompatible axes).
 */

/**
 * Cell event gate: require enough successes AND non-events, min(n·p, n·(1−p)) ≥ min.
 * NOT a flat n≥30 (the rule-of-30 is for means and breaks at extreme rates).
 */
export function eventGate(n: number, p: number, min = 5): boolean {
  return Math.min(n * p, n * (1 - p)) >= min;
}

/** Signed minimum-effect gate: |effect| ≥ minAbs. The caller keeps the sign. */
export function signedEffectGate(effect: number, minAbs: number): boolean {
  return Math.abs(effect) >= minAbs;
}

/**
 * Rank flags by effect size (descending |effect|), or by a conservative lower-CI bound
 * when provided. Returns a new array; never ranks by q×effect.
 */
export function rankByEffect<T>(items: T[], getEffect: (t: T) => number, getLowerCI?: (t: T) => number): T[] {
  const key = getLowerCI ?? ((t: T) => Math.abs(getEffect(t)));
  return [...items].sort((a, b) => key(b) - key(a));
}
