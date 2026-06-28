import { describe, it, expect } from "vitest";
import { logChoose, chiSquareSurvival } from "./special";

describe("special functions", () => {
  it("logChoose matches ln(C(n,k))", () => {
    expect(Math.exp(logChoose(5, 2))).toBeCloseTo(10, 9);
    expect(Math.exp(logChoose(10, 0))).toBeCloseTo(1, 9);
    expect(logChoose(3, 5)).toBe(-Infinity); // k>n
  });

  it("chiSquareSurvival matches known tail probabilities", () => {
    expect(chiSquareSurvival(3.841, 1)).toBeCloseTo(0.05, 3); // chi2(1) 95th pct
    expect(chiSquareSurvival(0, 1)).toBe(1);
    expect(chiSquareSurvival(5.991, 2)).toBeCloseTo(0.05, 3); // chi2(2) 95th pct
  });
});
