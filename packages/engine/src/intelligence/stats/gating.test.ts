import { describe, it, expect } from "vitest";
import { eventGate, signedEffectGate, rankByEffect } from "./gating";

describe("eventGate — min(n·p, n·(1−p)) ≥ min, NOT n≥30", () => {
  it("gates out an extreme-rate cell even though n>30", () => {
    expect(eventGate(40, 0.05)).toBe(false); // min(2, 38) = 2 < 5
  });
  it("passes when both successes and non-events are sufficient", () => {
    expect(eventGate(200, 0.05)).toBe(true); // min(10, 190) = 10
  });
});

describe("signedEffectGate", () => {
  it("uses absolute magnitude but the caller keeps the sign", () => {
    expect(signedEffectGate(-0.12, 0.1)).toBe(true);
    expect(signedEffectGate(0.05, 0.1)).toBe(false);
  });
});

describe("rankByEffect — by effect size, never q×effect", () => {
  it("orders by effect size, which differs from a q×effect product", () => {
    // A: big effect, weak q. B: small effect, tiny q. q×effect would rank B first.
    const items = [
      { id: "A", effect: 0.4, q: 0.04 }, // q×effect = 0.016
      { id: "B", effect: 0.1, q: 0.001 }, // q×effect = 0.0001 (would top a q×effect sort)
    ];
    expect(rankByEffect(items, (x) => x.effect).map((x) => x.id)).toEqual(["A", "B"]);
  });

  it("can rank by a conservative lower-CI bound when provided", () => {
    const items = [
      { id: "A", effect: 0.5, lo: 0.05 },
      { id: "B", effect: 0.3, lo: 0.2 },
    ];
    expect(rankByEffect(items, (x) => x.effect, (x) => x.lo).map((x) => x.id)).toEqual(["B", "A"]);
  });
});
