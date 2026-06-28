import { describe, it, expect } from "vitest";
import { logisticFit, adjustedCoefficient } from "./logistic";

/**
 * Confound reversal (sklearn-cross-checked): a tool whose CRUDE association with
 * resolution is negative (because it's used mostly on hard intents) flips POSITIVE
 * once intent difficulty is adjusted for. Predictors: [tool, hardIntent].
 */
function buildData(): { X: number[][]; y: number[] } {
  const X: number[][] = [];
  const y: number[] = [];
  const add = (tool: number, hard: number, resolved: number, n: number) => {
    for (let i = 0; i < n; i++) {
      X.push([tool, hard]);
      y.push(resolved);
    }
  };
  add(0, 0, 1, 90); add(0, 0, 0, 10); // easy, no tool: 0.90
  add(1, 0, 1, 9); add(1, 0, 0, 1); // easy, tool:    0.90
  add(0, 1, 1, 1); add(0, 1, 0, 9); // hard, no tool: 0.10
  add(1, 1, 1, 30); add(1, 1, 0, 70); // hard, tool:    0.30
  return { X, y };
}

describe("logisticFit — confound adjustment (sklearn-cross-checked)", () => {
  const { X, y } = buildData();

  it("crude tool effect is negative", () => {
    const crude = logisticFit(
      X.map((r) => [r[0]]),
      y,
    );
    expect(crude.coef[1]).toBeLessThan(0);
    // Unregularized MLE == ln(crude OR) = ln((39·19)/(71·91)) = ln(0.11469) = -2.166.
    // (sklearn's -1.967 is its L2-regularized estimate; our fit is essentially unregularized.)
    expect(crude.coef[1]).toBeCloseTo(-2.166, 2);
  });

  it("adjusted tool effect flips positive after controlling for intent difficulty", () => {
    const toolCoef = adjustedCoefficient(X, y, 0);
    expect(toolCoef).toBeGreaterThan(0); // ≈ +0.85
    expect(toolCoef).toBeCloseTo(0.846, 1);
    // The hard-intent confounder is strongly negative.
    expect(adjustedCoefficient(X, y, 1)).toBeLessThan(-2);
  });
});
