import { describe, it, expect } from "vitest";
import { oddsRatio2x2, cmhCommonOR, breslowDay, simpsonCheck, collapse } from "./contingency";

// Kidney-stone Simpson's-paradox data (scipy-cross-checked).
const KIDNEY = [
  { a: 81, b: 6, c: 234, d: 36 }, // small stones
  { a: 192, b: 71, c: 55, d: 25 }, // large stones
];

describe("oddsRatio2x2", () => {
  it("computes OR and applies Haldane on zero cells", () => {
    expect(oddsRatio2x2(81, 6, 234, 36)).toBeCloseTo(2.076923, 5);
    expect(Number.isFinite(oddsRatio2x2(0, 5, 5, 5))).toBe(true); // no divide-by-zero
  });
});

describe("CMH + Simpson (scipy-cross-checked)", () => {
  it("pooled CMH OR is on the opposite side of 1 from the crude OR", () => {
    const m = collapse(KIDNEY);
    expect(oddsRatio2x2(m.a, m.b, m.c, m.d)).toBeCloseTo(0.748349, 5); // crude < 1
    expect(cmhCommonOR(KIDNEY)).toBeCloseTo(1.446847, 5); // adjusted > 1
  });

  it("flags the direction disagreement and suppresses the marginal flag", () => {
    const s = simpsonCheck(KIDNEY);
    expect(s.directionDisagree).toBe(true);
    expect(s.suppressMarginalFlag).toBe(true);
  });
});

describe("breslowDay — OR homogeneity (scipy-cross-checked)", () => {
  it("does NOT reject for the homogeneous kidney strata", () => {
    const r = breslowDay(KIDNEY);
    expect(r.df).toBe(1);
    expect(r.stat).toBeCloseTo(0.968446, 4);
    expect(r.p).toBeCloseTo(0.325068, 4);
    expect(r.p).toBeGreaterThan(0.05); // → a single pooled OR is fine
  });

  it("rejects when ORs differ sharply across strata", () => {
    const het = [
      { a: 10, b: 90, c: 90, d: 10 }, // OR ≈ 0.012
      { a: 90, b: 10, c: 10, d: 90 }, // OR = 81
    ];
    const r = breslowDay(het);
    expect(r.p).toBeLessThan(0.001); // → report per-stratum ORs
  });
});
