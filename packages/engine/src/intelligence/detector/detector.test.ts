import { describe, it, expect } from "vitest";
import { parseTraceJsonl } from "../trace/ingest";
import { buildSessions } from "../trace/session";
import { loadFixture } from "../__fixtures__/load";
import { DeterministicIntentClusterer } from "../dimensions/intent/cluster";
import { runDetector } from "./detector";
import type { Session } from "../types";

const clusterer = new DeterministicIntentClusterer(0.3);

function realSessions(): Session[] {
  const blob = [
    loadFixture("error-chain.jsonl"),
    loadFixture("abandoned-no-capability.jsonl"),
    loadFixture("skill-and-success.jsonl"),
    loadFixture("auth-flow-chain.jsonl"),
  ].join("\n");
  return buildSessions(parseTraceJsonl(blob));
}

describe("runDetector — on the real vendored fixtures", () => {
  it("produces a coherent report without crashing", async () => {
    const r = await runDetector({ sessions: realSessions() }, { clusterer });
    expect(r.sessionsAnalyzed).toBe(4);
    expect(r.searchesAnalyzed).toBeGreaterThan(0);
    expect(r.clusters.length).toBeGreaterThan(0);
    expect(r.grid.length).toBeGreaterThan(0);
  });

  it("counts the abandoned session as censored, not dropped (§4.1)", async () => {
    const r = await runDetector({ sessions: realSessions() }, { clusterer });
    expect(r.censored.abandonedSessions).toBeGreaterThanOrEqual(1);
  });

  it("Phase-0 contract: no model-dependent flags or grid resolved column without deps", async () => {
    const r = await runDetector({ sessions: realSessions() }, { clusterer });
    expect(r.flags.some((f) => f.kind === "tool_neg_sentiment" || f.kind === "tool_unresolved")).toBe(false);
    expect(r.grid.every((c) => c.resolvedRate === undefined)).toBe(true);
  });

  it("grid records invocation success per (intent, tool) cell", async () => {
    const r = await runDetector({ sessions: realSessions() }, { clusterer });
    const errored = r.grid.find((c) => c.toolId === "context7__query-docs");
    expect(errored).toBeDefined();
    expect(errored!.successRate).toBe(0); // its only invocation errored
  });
});

describe("runDetector — claim/intent dimension (DI via ClaimIntentExtractor)", () => {
  it("omits claimIntel entirely when no extractor is injected (Phase-0 contract)", async () => {
    const r = await runDetector({ sessions: realSessions() }, { clusterer });
    expect(r.claimIntel).toBeUndefined();
  });

  it("runs the extractor only over sessions with transcript turns and aggregates", async () => {
    const seen: string[][] = [];
    const fakeExtractor = {
      async extract(turns: { content: string }[]) {
        seen.push(turns.map((t) => t.content));
        return {
          intents: [{ content: "do the thing" }],
          claims: [{ subtype: "capability" as const, content: "I can do it" }],
        };
      },
    };
    const sessions = realSessions();
    // Give exactly one session transcript turns; the rest are trace-only (empty turns).
    sessions[0].turns = [
      { role: "user", content: "please do the thing", index: 0 },
      { role: "assistant", content: "on it", index: 1 },
    ];

    const r = await runDetector({ sessions }, { clusterer, claimIntent: fakeExtractor });

    expect(seen).toHaveLength(1); // only the one session with turns
    expect(seen[0]).toEqual(["please do the thing", "on it"]);
    expect(r.claimIntel).toBeDefined();
    expect(r.claimIntel!.sessionsWithTranscript).toBe(1);
    expect(r.claimIntel!.totalClaims).toBe(1);
    expect(r.claimIntel!.claimsBySubtype.capability).toBe(1);
    expect(r.claimIntel!.intents[0].content).toBe("do the thing");
  });

  it("a single extractor failure does not sink the report", async () => {
    const flaky = {
      async extract() {
        throw new Error("orbitals 500");
      },
    };
    const sessions = realSessions();
    sessions[0].turns = [{ role: "user", content: "hi", index: 0 }];
    const r = await runDetector({ sessions }, { clusterer, claimIntent: flaky });
    expect(r.claimIntel).toBeUndefined(); // no successful extraction → section omitted
    expect(r.sessionsAnalyzed).toBe(4); // report still produced
  });
});

describe("runDetector — unified cross-source intent clustering (DI via UnifiedIntentClusterer)", () => {
  it("omits unifiedIntel entirely when no clusterer is injected (Phase-0 contract)", async () => {
    const r = await runDetector({ sessions: realSessions() }, { clusterer });
    expect(r.unifiedIntel).toBeUndefined();
  });

  it("feeds intents from BOTH substrates (trace searches + transcript) to the clusterer", async () => {
    const seenTexts: string[][] = [];
    const unifiedClusterer = {
      async cluster(texts: string[]) {
        seenTexts.push(texts);
        return [{ label: "All", members: texts }];
      },
    };
    const fakeExtractor = {
      async extract() {
        return { intents: [{ content: "transcript-only intent" }], claims: [] };
      },
    };
    const sessions = realSessions();
    sessions[0].turns = [{ role: "user", content: "hi", index: 0 }];

    const r = await runDetector(
      { sessions },
      { clusterer, unifiedClusterer, claimIntent: fakeExtractor },
    );

    expect(r.unifiedIntel).toBeDefined();
    const texts = seenTexts[0];
    // includes the transcript intent AND at least one trace Search.query
    expect(texts).toContain("transcript-only intent");
    expect(texts.length).toBeGreaterThan(1);
    expect(r.unifiedIntel!.transcriptSessions).toBe(1);
    expect(r.unifiedIntel!.searchSessions).toBeGreaterThan(0);
  });

  it("works from trace searches alone when no transcript extractor is present", async () => {
    const unifiedClusterer = {
      async cluster(texts: string[]) {
        return [{ label: "All", members: texts }];
      },
    };
    const r = await runDetector({ sessions: realSessions() }, { clusterer, unifiedClusterer });
    expect(r.unifiedIntel).toBeDefined();
    expect(r.unifiedIntel!.searchSessions).toBeGreaterThan(0);
    expect(r.unifiedIntel!.transcriptSessions).toBe(0);
  });

  it("a unified-clusterer failure does not sink the report", async () => {
    const unifiedClusterer = {
      async cluster(): Promise<never> {
        throw new Error("claude 529");
      },
    };
    const r = await runDetector({ sessions: realSessions() }, { clusterer, unifiedClusterer });
    expect(r.unifiedIntel).toBeUndefined();
    expect(r.sessionsAnalyzed).toBe(4);
  });
});

describe("runDetector — resolution dimension (DI via ResolutionJudge)", () => {
  it("omits resolutionIntel entirely when no judge is injected (Phase-0 contract)", async () => {
    const r = await runDetector({ sessions: realSessions() }, { clusterer });
    expect(r.resolutionIntel).toBeUndefined();
  });

  it("judges only sessions with transcript turns and aggregates per-session verdicts", async () => {
    const seen: { role: string; content: string }[][] = [];
    const fakeJudge = {
      async judge(turns: { role: string; content: string }[]) {
        seen.push(turns.map((t) => ({ role: t.role, content: t.content })));
        return { resolved: 1 as const, confidence: 0.8, reasoning: "done", evidence_span: "turn 1" };
      },
    };
    const sessions = realSessions();
    // Give exactly one session transcript turns; the rest are trace-only (empty turns).
    sessions[0].turns = [
      { role: "user", content: "please do the thing", index: 0 },
      { role: "assistant", content: "done", index: 1 },
    ];

    const r = await runDetector({ sessions }, { clusterer, resolution: fakeJudge });

    expect(seen).toHaveLength(1); // only the one session with turns
    expect(seen[0]).toEqual([
      { role: "user", content: "please do the thing" },
      { role: "assistant", content: "done" },
    ]);
    expect(r.resolutionIntel).toBeDefined();
    expect(r.resolutionIntel!.sessionsJudged).toBe(1);
    expect(r.resolutionIntel!.resolvedSessions).toBe(1);
    expect(r.resolutionIntel!.resolvedRate).toBe(1);
    expect(r.resolutionIntel!.verdicts[0].reasoning).toBe("done");
    // Happy-path telemetry: one attempt, zero failures, no failure sample.
    expect(r.resolutionIntel!.sessionsAttempted).toBe(1);
    expect(r.resolutionIntel!.sessionsFailed).toBe(0);
    expect(r.resolutionIntel!.failureSample).toBeUndefined();

    // Contract: resolution stays a descriptive section even with a judge active — the trace
    // grid/flags are untouched (no per-session trace↔transcript join). grid.resolvedRate stays
    // dormant and no tool_unresolved (question b) flag is emitted until a paired source exists.
    expect(r.grid.every((c) => c.resolvedRate === undefined)).toBe(true);
    expect(r.flags.some((f) => f.kind === "tool_unresolved")).toBe(false);
  });

  it("runs independently of the claim extractor (judge alone still produces the section)", async () => {
    const fakeJudge = {
      async judge() {
        return { resolved: 0 as const, confidence: 0.6, reasoning: "gave up", evidence_span: "turn 2" };
      },
    };
    const sessions = realSessions();
    sessions[0].turns = [{ role: "user" as const, content: "help", index: 0 }];
    const r = await runDetector({ sessions }, { clusterer, resolution: fakeJudge });
    expect(r.resolutionIntel).toBeDefined();
    expect(r.resolutionIntel!.unresolvedSessions).toBe(1);
    expect(r.claimIntel).toBeUndefined(); // no claim extractor injected
  });

  it("surfaces the section (not silently dropped) when the judge fails on every session", async () => {
    // Previously an all-fail run left resolutionIntel undefined — indistinguishable from
    // "no transcripts to judge", so a broken judge (e.g. Flow-Judge's 4k-cap 400) silently hid
    // the card. Now the section is surfaced with sessionsJudged === 0 plus failure telemetry, so
    // the UI can render a failure banner instead of vanishing.
    const flaky = {
      async judge(): Promise<never> {
        throw new Error("haiku 529");
      },
    };
    const sessions = realSessions();
    sessions[0].turns = [{ role: "user" as const, content: "hi", index: 0 }];
    const r = await runDetector({ sessions }, { clusterer, resolution: flaky });
    expect(r.resolutionIntel).toBeDefined();
    expect(r.resolutionIntel!.sessionsJudged).toBe(0); // nothing scored
    expect(r.resolutionIntel!.sessionsAttempted).toBe(1); // but one was attempted
    expect(r.resolutionIntel!.sessionsFailed).toBe(1);
    expect(r.resolutionIntel!.failureSample).toBe("haiku 529");
    expect(r.sessionsAnalyzed).toBe(4); // report still produced
  });

  it("leaves the section undefined when a judge is present but no session carries turns", async () => {
    // The discriminating case for the visibility fix: judge injected, but zero transcript-bearing
    // sessions → genuinely nothing to judge → no card (NOT a failure banner). The vendored
    // fixtures are all trace-only, so withTurns is empty here.
    const judge = {
      async judge() {
        return { resolved: 1 as const, confidence: 0.9, reasoning: "ok", evidence_span: "" };
      },
    };
    const r = await runDetector({ sessions: realSessions() }, { clusterer, resolution: judge });
    expect(r.resolutionIntel).toBeUndefined();
  });

  it("isolates per-session failures: a sibling session is still judged when one throws", async () => {
    // The try/catch lives INSIDE the per-session loop, so one bad session must not discard the
    // verdicts of the others. Two transcript-bearing sessions: one throws, one succeeds.
    const judge = {
      async judge(turns: { content: string }[]) {
        if (turns.some((t) => t.content.includes("boom"))) throw new Error("haiku 529");
        return { resolved: 1 as const, confidence: 0.7, reasoning: "ok", evidence_span: "turn 1" };
      },
    };
    const sessions = realSessions();
    sessions[0].turns = [{ role: "user" as const, content: "boom", index: 0 }]; // judge throws
    sessions[1].turns = [{ role: "user" as const, content: "all good", index: 0 }]; // survives

    const r = await runDetector({ sessions }, { clusterer, resolution: judge });

    expect(r.resolutionIntel).toBeDefined();
    expect(r.resolutionIntel!.sessionsJudged).toBe(1); // only the survivor counts
    expect(r.resolutionIntel!.resolvedSessions).toBe(1);
    expect(r.resolutionIntel!.verdicts[0].sessionId).toBe(sessions[1].sessionId);
    // Partial-failure telemetry: two attempted, one failed, the survivor still scored.
    expect(r.resolutionIntel!.sessionsAttempted).toBe(2);
    expect(r.resolutionIntel!.sessionsFailed).toBe(1);
    expect(r.resolutionIntel!.failureSample).toBe("haiku 529");
  });

  it("records the judge's label as report provenance (and omits it when the judge has none)", async () => {
    const verdict = { resolved: 1 as const, confidence: 0.8, reasoning: "ok", evidence_span: "turn 1" };
    const labelled = { label: "Flow-Judge v0.1", async judge() { return verdict; } };
    const unlabelled = { async judge() { return verdict; } };
    const withTurns = () => {
      const s = realSessions();
      s[0].turns = [{ role: "user" as const, content: "do it", index: 0 }];
      return s;
    };

    const r1 = await runDetector({ sessions: withTurns() }, { clusterer, resolution: labelled });
    expect(r1.resolutionIntel!.judge).toBe("Flow-Judge v0.1");

    const r2 = await runDetector({ sessions: withTurns() }, { clusterer, resolution: unlabelled });
    expect(r2.resolutionIntel!.judge).toBeUndefined();
  });
});

/** Synthetic JSONL builders for flag-triggering scenarios the 4 small fixtures can't reach. */
function lines(...objs: object[]): string {
  return objs.map((o) => JSON.stringify(o)).join("\n");
}

describe("runDetector — intent three-way split fires on enough data", () => {
  it("flags a no-capability intent (searched a lot, flat hits, never invoked)", async () => {
    const blob: string[] = [];
    // Cluster A: 8 sessions that search a distinct intent, get 3 flat (equal-score) hits, invoke nothing.
    for (let i = 0; i < 8; i++) {
      blob.push(
        lines(
          { v: 1, ts: 1000 + i * 10, session_id: `a${i}`, type: "search", query: "frobnicate wizzbang gadget configuration", origin: "agent", top_k: 3, hits: [
            { tool_id: "foo__a", score: 2.0 }, { tool_id: "foo__b", score: 2.0 }, { tool_id: "foo__c", score: 2.0 },
          ], took_ms: 1 },
        ),
      );
    }
    // Cluster B: 8 sessions that search a different intent and successfully invoke the top hit.
    for (let i = 0; i < 8; i++) {
      blob.push(
        lines(
          { v: 1, ts: 5000 + i * 100, session_id: `b${i}`, type: "search", query: "deploy kubernetes cluster production", origin: "agent", top_k: 2, hits: [
            { tool_id: "k8s__deploy", score: 12.0 }, { tool_id: "k8s__status", score: 1.0 },
          ], stages: [{ name: "bm25", took_ms: 1, top_score: 12.0 }], took_ms: 1 },
          { v: 1, ts: 5000 + i * 100 + 5, session_id: `b${i}`, type: "invoke_start", tool_id: "k8s__deploy", args_size_bytes: 10 },
          { v: 1, ts: 5000 + i * 100 + 9, session_id: `b${i}`, type: "invoke_end", tool_id: "k8s__deploy", took_ms: 2 },
        ),
      );
    }
    const sessions = buildSessions(parseTraceJsonl(blob.join("\n")));
    const r = await runDetector({ sessions }, { clusterer });

    const intentFlag = r.flags.find((f) => f.kind === "intent_no_capability" || f.kind === "intent_tune_description");
    expect(intentFlag).toBeDefined();
    expect(intentFlag!.kind).toBe("intent_no_capability"); // flat hits → low confidence
    expect(intentFlag!.intentLabel).toContain("frobnicate");
    expect(intentFlag!.effectSize).toBeLessThan(0);
    expect(intentFlag!.pValue).toBeLessThan(0.01);
  });
});

describe("runDetector — tool-health flags", () => {
  it("flags a high-error tool invoked enough times", async () => {
    const blob: string[] = [];
    for (let i = 0; i < 6; i++) {
      blob.push(
        lines(
          { v: 1, ts: 100 + i * 50, session_id: `e${i}`, type: "search", query: "charge the flux capacitor", origin: "agent", top_k: 1, hits: [{ tool_id: "flux__charge", score: 9 }], took_ms: 1 },
          { v: 1, ts: 100 + i * 50 + 5, session_id: `e${i}`, type: "invoke_start", tool_id: "flux__charge", args_size_bytes: 10 },
          { v: 1, ts: 100 + i * 50 + 9, session_id: `e${i}`, type: "invoke_error", tool_id: "flux__charge", took_ms: 2, error: "MCP error -32000: Connection closed" },
        ),
      );
    }
    const sessions = buildSessions(parseTraceJsonl(blob.join("\n")));
    const r = await runDetector({ sessions }, { clusterer });
    const tf = r.flags.find((f) => f.kind === "tool_high_error" && f.toolId === "flux__charge");
    expect(tf).toBeDefined();
    expect(tf!.effectSize).toBe(1); // 6/6 errored
  });
});
