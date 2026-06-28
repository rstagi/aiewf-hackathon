import { describe, it, expect } from "vitest";
import { wilcoxonSignedRank, signTest, didEstimate } from "./nonparametric";

describe("wilcoxonSignedRank (scipy-cross-checked)", () => {
  it("matches scipy exact p for [1..5]", () => {
    const r = wilcoxonSignedRank([1, 2, 3, 4, 5]);
    expect(r.W).toBe(15); // all ranks positive
    expect(r.p).toBeCloseTo(0.0625, 6);
    expect(r.method).toBe("exact");
  });

  it("is non-significant for a symmetric-around-zero sample", () => {
    expect(wilcoxonSignedRank([-2, -1, 1, 2]).p).toBe(1);
  });

  it("drops zeros", () => {
    expect(wilcoxonSignedRank([0, 0, 0]).p).toBe(1);
  });
});

describe("signTest", () => {
  it("two-sided exact binomial p", () => {
    expect(signTest([1, 1, 1, 1, 1]).p).toBeCloseTo(0.0625, 6); // 5/5 positive: 2*(1/32)
    expect(signTest([1, -1, 1, -1]).p).toBe(1);
  });
});

describe("didEstimate — RTM control (§4.4a)", () => {
  it("≈0 when treated and control move together (pure regression to the mean)", () => {
    expect(didEstimate([0.2], [0.5], [0.2], [0.5])).toBeCloseTo(0, 10);
  });

  it("is positive when treated improves beyond the control trend", () => {
    expect(didEstimate([0.2], [0.6], [0.2], [0.3])).toBeCloseTo(0.3, 10);
  });
});
