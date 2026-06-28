import { describe, expect, it } from "vitest";
import { aggregateResolution, type SessionVerdict } from "./aggregate";
import type { ResolutionVerdict } from "../types";

const v = (
  resolved: 0 | 1,
  confidence: number,
  reasoning = "because",
  evidence_span = "turn 3",
): ResolutionVerdict => ({ resolved, confidence, reasoning, evidence_span });

const sv = (sessionId: string, verdict: ResolutionVerdict): SessionVerdict => ({ sessionId, verdict });

describe("aggregateResolution", () => {
  it("computes resolved rate, Wilson CI, and mean confidence over per-session verdicts", () => {
    const report = aggregateResolution([
      sv("s1", v(1, 0.9)),
      sv("s2", v(1, 0.8)),
      sv("s3", v(0, 0.7)),
      sv("s4", v(0, 0.6)),
    ]);

    expect(report.sessionsJudged).toBe(4);
    expect(report.resolvedSessions).toBe(2);
    expect(report.unresolvedSessions).toBe(2);
    expect(report.resolvedRate).toBeCloseTo(0.5);
    // Wilson 95% CI for 2/4 is roughly [0.15, 0.85] — strictly inside (0,1).
    expect(report.resolvedRateCI[0]).toBeGreaterThan(0);
    expect(report.resolvedRateCI[1]).toBeLessThan(1);
    expect(report.resolvedRateCI[0]).toBeLessThan(0.5);
    expect(report.resolvedRateCI[1]).toBeGreaterThan(0.5);
    expect(report.meanConfidence).toBeCloseTo((0.9 + 0.8 + 0.7 + 0.6) / 4);
  });

  it("carries each verdict's reasoning + evidence for display, unresolved-first then by confidence", () => {
    const report = aggregateResolution([
      sv("s1", v(1, 0.95, "fully done", "final turn")),
      sv("s2", v(0, 0.9, "user gave up", "turn 5")),
      sv("s3", v(0, 0.4, "ambiguous", "turn 2")),
    ]);

    // Unresolved sessions surface first; within a group, most-confident first.
    expect(report.verdicts.map((x) => x.sessionId)).toEqual(["s2", "s3", "s1"]);
    const s2 = report.verdicts.find((x) => x.sessionId === "s2")!;
    expect(s2.resolved).toBe(0);
    expect(s2.reasoning).toBe("user gave up");
    expect(s2.evidence_span).toBe("turn 5");
  });

  it("counts one observation per session (dedupes a repeated session id, first-seen wins)", () => {
    const report = aggregateResolution([
      sv("s1", v(1, 0.9)),
      sv("s1", v(0, 0.1)), // duplicate id — must not double-count
      sv("s2", v(0, 0.5)),
    ]);
    expect(report.sessionsJudged).toBe(2);
    expect(report.resolvedSessions).toBe(1); // first-seen s1 verdict (resolved) wins
  });

  it("returns a zeroed report on empty input without dividing by zero", () => {
    const report = aggregateResolution([]);
    expect(report.sessionsJudged).toBe(0);
    expect(report.resolvedSessions).toBe(0);
    expect(report.unresolvedSessions).toBe(0);
    expect(report.resolvedRate).toBe(0);
    expect(report.meanConfidence).toBe(0);
    expect(report.resolvedRateCI).toEqual([0, 1]); // Wilson n=0 → full interval
    expect(report.verdicts).toEqual([]);
  });

  it("treats a non-1 resolved value as unresolved (defensive coercion)", () => {
    // @ts-expect-error — exercising tolerance to a drifted value the adapter would normally coerce
    const report = aggregateResolution([sv("s1", v(2, 0.5)), sv("s2", v(1, 0.5))]);
    expect(report.resolvedSessions).toBe(1);
    expect(report.unresolvedSessions).toBe(1);
  });
});
