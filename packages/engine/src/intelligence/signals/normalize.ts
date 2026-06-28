/**
 * Per-query BM25 normalization (§4.4c).
 *
 * Raw BM25 scores are unbounded and depend on the query's term statistics, so a
 * "top score" of 9.7 on one query is not comparable to 9.7 on another. Before any
 * cross-query thresholding we re-express each query's hit scores on an intrinsic,
 * query-local scale. Pure leaf — no deps.
 */

/**
 * Softmax over a query's scores: exp(x_i - max) / Σ exp(x_j - max).
 * Output is a probability distribution in [0,1] that sums to 1; the `- max`
 * shift makes it numerically stable and shift-invariant. Empty in → empty out.
 */
export function perQuerySoftmax(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const max = Math.max(...scores);
  const exps = scores.map((s) => Math.exp(s - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

/**
 * Z-score standardization: (x_i - mean) / std, using the population std (ddof=0,
 * matching scipy.stats.zscore's default). When there is no spread (std == 0) every
 * value maps to 0 (undefined direction, zero magnitude). Empty in → empty out.
 */
export function perQueryZScore(scores: number[]): number[] {
  const n = scores.length;
  if (n === 0) return [];
  const mean = scores.reduce((a, b) => a + b, 0) / n;
  const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  if (std === 0) return scores.map(() => 0);
  return scores.map((s) => (s - mean) / std);
}

/**
 * Per-query top-score + confidence margin.
 *
 * Normalizes the query's hits with softmax (→ [0,1]) and returns the top
 * normalized score plus the rank1−rank2 margin (a near-tie at the top means the
 * retriever is not confident which tool wins). Hits need not be pre-sorted; the
 * top two by normalized score are used.
 *
 *  - empty hits     → {} (nothing to report)
 *  - single hit     → { topScoreNorm: 1 } (certain; no second rank to compare)
 */
export function topAndMargin(
  hits: { toolId: string; score: number }[],
): { topScoreNorm?: number; rank1MinusRank2?: number } {
  if (hits.length === 0) return {};
  const norm = perQuerySoftmax(hits.map((h) => h.score)).sort((a, b) => b - a);
  if (norm.length === 1) return { topScoreNorm: norm[0] };
  return { topScoreNorm: norm[0], rank1MinusRank2: norm[0] - norm[1] };
}
