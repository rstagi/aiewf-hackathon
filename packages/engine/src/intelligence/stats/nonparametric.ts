/**
 * Nonparametric tests for sentiment deltas (§4.4a) and the RTM control.
 */

/** Average-rank the magnitudes (1-based), resolving ties by mean rank. */
function averageRanks(values: number[]): number[] {
  const idx = values.map((v, i) => [v, i] as [number, number]).sort((x, y) => x[0] - y[0]);
  const ranks = new Array(values.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1; // mean of ranks (i+1 .. j+1)
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = avg;
    i = j + 1;
  }
  return ranks;
}

export interface WilcoxonResult {
  /** Sum of positive ranks. */
  W: number;
  p: number;
  method: "exact" | "normal";
}

/**
 * Wilcoxon signed-rank test, H0: median delta = 0. Zeros dropped. Exact two-sided
 * p by enumeration for small n; normal approximation (continuity + tie correction)
 * otherwise.
 */
export function wilcoxonSignedRank(deltas: number[]): WilcoxonResult {
  const nz = deltas.filter((d) => d !== 0);
  const n = nz.length;
  if (n === 0) return { W: 0, p: 1, method: "exact" };
  const mags = nz.map(Math.abs);
  const ranks = averageRanks(mags);
  const totalRank = ranks.reduce((a, b) => a + b, 0);
  const wPlus = ranks.reduce((acc, r, i) => acc + (nz[i] > 0 ? r : 0), 0);
  const mean = totalRank / 2;
  const obsDev = Math.abs(wPlus - mean);

  if (n <= 18) {
    // Enumerate all 2^n sign assignments; each rank contributes to W+ or not.
    let count = 0;
    const total = 1 << n;
    for (let mask = 0; mask < total; mask++) {
      let s = 0;
      for (let i = 0; i < n; i++) if (mask & (1 << i)) s += ranks[i];
      if (Math.abs(s - mean) >= obsDev - 1e-9) count++;
    }
    return { W: wPlus, p: Math.min(1, count / total), method: "exact" };
  }

  // Normal approximation with tie correction.
  const tieTerm = tieCorrection(mags);
  const varW = (n * (n + 1) * (2 * n + 1)) / 24 - tieTerm / 48;
  const zc = (obsDev - 0.5) / Math.sqrt(varW);
  const p = 2 * (1 - normalCdf(zc));
  return { W: wPlus, p: Math.min(1, Math.max(0, p)), method: "normal" };
}

function tieCorrection(mags: number[]): number {
  const counts = new Map<number, number>();
  for (const m of mags) counts.set(m, (counts.get(m) ?? 0) + 1);
  let sum = 0;
  for (const t of counts.values()) if (t > 1) sum += t * t * t - t;
  return sum;
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26.
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

/** Sign test, H0: P(+) = 0.5. Zeros dropped. */
export function signTest(deltas: number[]): { p: number } {
  const nz = deltas.filter((d) => d !== 0);
  const n = nz.length;
  if (n === 0) return { p: 1 };
  const k = nz.filter((d) => d > 0).length;
  // Two-sided exact binomial p.
  let lo = 0;
  for (let i = 0; i <= Math.min(k, n - k); i++) lo += binomPmf(i, n);
  return { p: Math.min(1, 2 * lo) };
}

function binomPmf(k: number, n: number): number {
  // C(n,k) * 0.5^n
  let logC = 0;
  for (let i = 1; i <= k; i++) logC += Math.log((n - k + i) / i);
  return Math.exp(logC) * Math.pow(0.5, n);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Difference-in-differences for the RTM control (§4.4a): the treated group's pre→post
 * change minus the control group's pre→post change. ~0 means the apparent treated
 * delta is just regression to the mean, not a tool effect.
 */
export function didEstimate(
  treatedPre: number[],
  treatedPost: number[],
  controlPre: number[],
  controlPost: number[],
): number {
  return mean(treatedPost) - mean(treatedPre) - (mean(controlPost) - mean(controlPre));
}
