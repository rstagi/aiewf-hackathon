import { describe, it, expect } from "vitest";
import { brier, ece, reliabilityCurve, agreement } from "./calibration";

describe("brier / ece", () => {
  it("brier is 0 for perfect predictions", () => {
    expect(brier([1, 0, 1, 0], [1, 0, 1, 0])).toBe(0);
  });
  it("brier penalizes confident-and-wrong", () => {
    expect(brier([1, 1], [0, 0])).toBe(1);
  });
  it("ece is ~0 for a well-calibrated set", () => {
    // 10 items at p=0.5, exactly half positive → bin matches.
    const probs = Array(10).fill(0.5);
    const outcomes = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0];
    expect(ece(probs, outcomes)).toBeCloseTo(0, 6);
  });
  it("reliabilityCurve buckets predictions", () => {
    const c = reliabilityCurve([0.05, 0.95], [0, 1], 10);
    expect(c[0].count).toBe(1);
    expect(c[9].count).toBe(1);
  });
});

describe("agreement — κ misleads on imbalance, PABAK/balanced-acc don't (§6.3)", () => {
  it("reports low κ but high PABAK on an imbalanced confusion", () => {
    const m = agreement({ tp: 85, fp: 5, fn: 5, tn: 5 });
    expect(m.accuracy).toBeCloseTo(0.9, 6);
    expect(m.cohenKappa).toBeCloseTo(0.444, 3); // low despite 90% accuracy
    expect(m.pabak).toBeCloseTo(0.8, 6); // high
    expect(m.cohenKappa).toBeLessThan(m.pabak);
    expect(m.sensitivity).toBeCloseTo(0.9444, 3);
    expect(m.specificity).toBeCloseTo(0.5, 6);
  });
});
