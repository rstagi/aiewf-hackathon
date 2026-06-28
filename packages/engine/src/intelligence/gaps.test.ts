import { describe, expect, it } from "vitest";
import type { ExtendedTraceEnvelope } from "@sia/contract";
import { detectGaps } from "./gaps";

// ── tiny envelope builders (the wire shape buildSessions ingests) ────────────
let clock = 1000;
const search = (
  sessionId: string,
  query: string,
  hits: { tool_id: string; score: number }[],
): ExtendedTraceEnvelope =>
  ({
    v: 1,
    ts: clock++,
    session_id: sessionId,
    type: "search",
    query,
    origin: "agent",
    top_k: 5,
    hits,
    took_ms: 1,
    configId: "cfg_test",
    arm: "champion",
  }) as ExtendedTraceEnvelope;

const invoke = (sessionId: string, toolId: string): ExtendedTraceEnvelope[] =>
  [
    { v: 1, ts: clock++, session_id: sessionId, type: "invoke_start", tool_id: toolId },
    { v: 1, ts: clock++, session_id: sessionId, type: "invoke_end", tool_id: toolId, took_ms: 1 },
  ] as ExtendedTraceEnvelope[];

/** The calibrated corpus, hand-built: leak (near-miss), gap (no hits), healthy (invoked), fluke (1 query). */
function corpus(): ExtendedTraceEnvelope[] {
  const env: ExtendedTraceEnvelope[] = [];
  // Leak: account-recovery is the consistent near-miss at 2.48 → improve-existing.
  env.push(search("leak-1", "reset my account password", [{ tool_id: "account-recovery", score: 2.48 }]));
  env.push(search("leak-2", "recover my account password", [{ tool_id: "account-recovery", score: 2.48 }]));
  env.push(search("leak-3", "reset password account login", [{ tool_id: "account-recovery", score: 2.5 }]));
  // Gap: nothing retrieved → create-new.
  env.push(search("gap-1", "i want to talk to a human", []));
  env.push(search("gap-2", "let me talk to a human", []));
  env.push(search("gap-3", "i need to talk to a human", []));
  // Healthy: retrieved AND invoked → not a gap.
  env.push(search("ok-1", "summarize this document", [{ tool_id: "doc-summary", score: 4.86 }]), ...invoke("ok-1", "doc-summary"));
  env.push(search("ok-2", "summarize the document please", [{ tool_id: "doc-summary", score: 4.86 }]), ...invoke("ok-2", "doc-summary"));
  // Fluke: a single missed query → below minQueries → not a gap.
  env.push(search("fluke-1", "export my data backup csv", []));
  return env;
}

describe("detectGaps", () => {
  it("routes the leak to improve-existing and the true gap to create-new; ignores healthy + flukes", () => {
    const gaps = detectGaps(corpus());
    expect(gaps).toHaveLength(2);

    const improve = gaps.find((g) => g.route === "improve-existing");
    const create = gaps.find((g) => g.route === "create-new");

    expect(improve).toBeDefined();
    expect(improve!.candidate?.skillId).toBe("account-recovery");
    expect(improve!.candidate?.meanScore).toBeGreaterThan(2.4);
    expect(improve!.candidate?.meanScore).toBeLessThan(2.6);
    expect(improve!.queries).toHaveLength(3);

    expect(create).toBeDefined();
    expect(create!.candidate).toBeUndefined();
    expect(create!.queries).toHaveLength(3);
    expect(create!.queries).toContain("i want to talk to a human");
  });

  it("a higher nearMissMin reclassifies the near-miss leak as create-new", () => {
    const gaps = detectGaps(corpus(), { nearMissMin: 3.0 });
    // account-recovery's 2.48 now fails the near-miss band → both gaps route to create-new.
    expect(gaps).toHaveLength(2);
    expect(gaps.every((g) => g.route === "create-new")).toBe(true);
  });

  it("minQueries gates fluke clusters", () => {
    const gaps = detectGaps(corpus(), { minQueries: 4 });
    // No cluster has 4 distinct queries → no gaps surface.
    expect(gaps).toHaveLength(0);
  });

  it("returns nothing for an empty usage log", () => {
    expect(detectGaps([])).toEqual([]);
  });
});
