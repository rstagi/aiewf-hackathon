import { describe, it, expect } from "vitest";
import { benjaminiHochberg, benjaminiYekutieli } from "./multiplicity";

describe("Benjamini-Yekutieli vs Benjamini-Hochberg", () => {
  const pvals = [0.001, 0.01, 0.02, 0.03, 0.04];
  const q = 0.05;

  it("BH rejects all five at q=0.05", () => {
    expect(benjaminiHochberg(pvals, q).rejected).toEqual([true, true, true, true, true]);
  });

  it("BY (dependence-robust) rejects only the smallest", () => {
    expect(benjaminiYekutieli(pvals, q).rejected).toEqual([true, false, false, false, false]);
  });

  it("BY rejection set is a subset of BH's (BY never more permissive)", () => {
    const bh = benjaminiHochberg(pvals, q).rejected;
    const by = benjaminiYekutieli(pvals, q).rejected;
    by.forEach((r, i) => {
      if (r) expect(bh[i]).toBe(true);
    });
  });

  it("rejects nothing when all p-values are large", () => {
    expect(benjaminiYekutieli([0.4, 0.5, 0.9], 0.05).rejected).toEqual([false, false, false]);
  });
});
