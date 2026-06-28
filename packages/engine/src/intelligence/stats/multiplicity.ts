/**
 * Multiple-comparison control for the intent×tool×stage scan (§4.3).
 *
 * The grid runs thousands of tests on the SAME nested sessions, so independence/PRDS
 * fails and plain Benjamini–Hochberg can be anticonservative. Default to the
 * dependence-robust Benjamini–Yekutieli, which divides by the harmonic factor c(m).
 */

export interface FdrResult {
  rejected: boolean[];
  /** Largest p-value declared significant (0 if none). */
  threshold: number;
}

function stepUp(pvals: number[], crit: (rank: number, m: number) => number): FdrResult {
  const m = pvals.length;
  const order = pvals.map((p, i) => [p, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  let maxRank = -1;
  for (let r = 0; r < m; r++) {
    if (order[r][0] <= crit(r + 1, m)) maxRank = r;
  }
  const rejected = new Array(m).fill(false);
  let threshold = 0;
  if (maxRank >= 0) {
    threshold = order[maxRank][0];
    for (let r = 0; r <= maxRank; r++) rejected[order[r][1]] = true;
  }
  return { rejected, threshold };
}

/** Benjamini–Hochberg FDR control at level q (assumes independence/PRDS). */
export function benjaminiHochberg(pvals: number[], q: number): FdrResult {
  return stepUp(pvals, (rank, m) => (rank / m) * q);
}

/** Benjamini–Yekutieli FDR control at level q — robust under arbitrary dependence. */
export function benjaminiYekutieli(pvals: number[], q: number): FdrResult {
  const m = pvals.length;
  let c = 0;
  for (let i = 1; i <= m; i++) c += 1 / i;
  return stepUp(pvals, (rank) => (rank / (m * c)) * q);
}
