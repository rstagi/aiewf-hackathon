import { describe, it, expect } from "vitest";
import { wilsonCI, fisherExact2x2, twoProportionTest } from "./proportions";

describe("wilsonCI — score interval (scipy-cross-checked)", () => {
  it("matches known values and stays in [0,1]", () => {
    const [lo1, hi1] = wilsonCI(5, 10);
    expect(lo1).toBeCloseTo(0.236589, 5);
    expect(hi1).toBeCloseTo(0.763410, 5);

    const [lo2, hi2] = wilsonCI(0, 100);
    expect(lo2).toBe(0); // never negative
    expect(hi2).toBeCloseTo(0.036995, 5);

    const [lo3, hi3] = wilsonCI(5, 5);
    expect(lo3).toBeCloseTo(0.565509, 5);
    expect(hi3).toBe(1); // clamped

    expect(wilsonCI(0, 0)).toEqual([0, 1]); // n=0 → uninformative
  });
});

describe("fisherExact2x2 — two-sided (scipy-cross-checked)", () => {
  it("matches scipy.stats.fisher_exact", () => {
    expect(fisherExact2x2(3, 1, 1, 3)).toBeCloseTo(0.485714, 5);
    expect(fisherExact2x2(1, 9, 11, 3)).toBeCloseTo(0.002759, 5);
  });

  it("twoProportionTest uses Fisher (correct near 0/1)", () => {
    const r = twoProportionTest(1, 10, 11, 14);
    expect(r.method).toBe("fisher");
    expect(r.p).toBeCloseTo(0.002759, 5);
  });
});
