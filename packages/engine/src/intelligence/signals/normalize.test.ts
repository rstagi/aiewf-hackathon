import { describe, expect, it } from "vitest";
import { perQuerySoftmax, perQueryZScore, topAndMargin } from "./normalize";

/**
 * Golden values cross-checked with scipy 1.17.0:
 *   from scipy.special import softmax; from scipy.stats import zscore
 * (see the inline comments per assertion).
 */
describe("perQuerySoftmax", () => {
  it("produces a probability distribution (sums to 1, monotone in input)", () => {
    // scipy.special.softmax([1,2,3]) -> [0.09003057, 0.24472847, 0.66524096]
    const out = perQuerySoftmax([1, 2, 3]);
    expect(out[0]).toBeCloseTo(0.09003057317038046, 12);
    expect(out[1]).toBeCloseTo(0.24472847105479764, 12);
    expect(out[2]).toBeCloseTo(0.6652409557748218, 12);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it("is numerically stable for large/shifted inputs (shift-invariant)", () => {
    const a = perQuerySoftmax([1000, 1001, 1002]);
    const b = perQuerySoftmax([1, 2, 3]);
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 12));
    expect(a.every((v) => Number.isFinite(v))).toBe(true);
  });

  it("spreads equal scores uniformly", () => {
    expect(perQuerySoftmax([0, 0, 0])).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it("maps a single score to certainty and an empty list to empty", () => {
    expect(perQuerySoftmax([5])).toEqual([1]);
    expect(perQuerySoftmax([])).toEqual([]);
  });
});

describe("perQueryZScore", () => {
  it("standardizes to mean 0 / unit population std", () => {
    // scipy.stats.zscore([1,2,3,4,5]) (ddof=0) -> [-1.41421356,-0.70710678,0,0.70710678,1.41421356]
    const out = perQueryZScore([1, 2, 3, 4, 5]);
    expect(out[0]).toBeCloseTo(-1.414213562373095, 12);
    expect(out[2]).toBeCloseTo(0, 12);
    expect(out[4]).toBeCloseTo(1.414213562373095, 12);
  });

  it("matches scipy on an asymmetric sample (mean 5, std 2)", () => {
    // scipy.stats.zscore([2,4,4,4,5,5,7,9]) (ddof=0) -> [-1.5,-0.5,-0.5,-0.5,0,0,1,2]
    expect(perQueryZScore([2, 4, 4, 4, 5, 5, 7, 9])).toEqual([
      -1.5, -0.5, -0.5, -0.5, 0, 0, 1, 2,
    ]);
  });

  it("returns all-zeros when there is no spread (std 0) and [] for empty", () => {
    expect(perQueryZScore([5, 5, 5])).toEqual([0, 0, 0]);
    expect(perQueryZScore([])).toEqual([]);
  });
});

describe("topAndMargin", () => {
  it("normalizes within the query then reports top score + rank1-rank2 margin", () => {
    // error-chain.jsonl search hits; scipy softmax([9.698053,9.571653,4.345959]) ->
    //   [0.53022256, 0.46726514, 0.00251231]  => topScoreNorm 0.53022, margin 0.06296
    const hits = [
      { toolId: "context7__query-docs", score: 9.698053359985352 },
      { toolId: "context7__resolve-library-id", score: 9.571653366088867 },
      { toolId: "linear-server__extract_images", score: 4.345958709716797 },
    ];
    const { topScoreNorm, rank1MinusRank2 } = topAndMargin(hits);
    expect(topScoreNorm).toBeCloseTo(0.5302225550897636, 12);
    expect(rank1MinusRank2).toBeCloseTo(0.06295741901071644, 12);
    // top two are near-tied: margin is small.
    expect(rank1MinusRank2).toBeLessThan(0.1);
  });

  it("handles a single hit (top is certain, no second rank to compare)", () => {
    const { topScoreNorm, rank1MinusRank2 } = topAndMargin([
      { toolId: "a", score: 7 },
    ]);
    expect(topScoreNorm).toBe(1);
    expect(rank1MinusRank2).toBeUndefined();
  });

  it("returns nothing for an empty hit list", () => {
    expect(topAndMargin([])).toEqual({});
  });
});
