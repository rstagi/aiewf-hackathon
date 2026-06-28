import { describe, it, expect } from "vitest";
import { parseTraceJsonl } from "../trace/ingest";
import { buildSession } from "../trace/session";
import { loadFixture } from "../__fixtures__/load";
import { successAtK, mrr } from "./retrieval";
import { foundNotInvoked } from "./selection";
import { detectArgRepairs } from "./repair";
import { detectOscillation } from "./loops";
import { computeInventory } from "./inventory";
import { computeGatewaySignals } from "./index";

const errorChain = () => buildSession("ec", parseTraceJsonl(loadFixture("error-chain.jsonl")));
const abandoned = () => buildSession("ab", parseTraceJsonl(loadFixture("abandoned-no-capability.jsonl")));

/** Build a session from inline JSONL envelope lines (for synthetic signal cases). */
function sessionFromLines(lines: string[]) {
  return buildSession("syn", parseTraceJsonl(lines.join("\n")));
}

describe("retrieval — success@k / MRR", () => {
  it("error-chain: all invoked tools are top-ranked", () => {
    const s = errorChain();
    expect(successAtK(s, 5)).toBe(1); // ranks 1,2,2 all ≤ 5
    expect(mrr(s)).toBeCloseTo((1 / 2 + 1 / 2 + 1 / 1) / 3, 10); // 0.6667
  });
  it("abandoned: no invokes → undefined", () => {
    const s = abandoned();
    expect(successAtK(s)).toBeUndefined();
    expect(mrr(s)).toBeUndefined();
  });
});

describe("selection — found-but-not-invoked", () => {
  it("error-chain surfaces the retrieved-but-unused tool", () => {
    expect(foundNotInvoked(errorChain())).toContain("linear-server__extract_images");
  });
  it("abandoned: every retrieved tool is unused", () => {
    const s = abandoned();
    const total = new Set(s.searches.flatMap((x) => x.hits.map((h) => h.toolId)));
    expect(foundNotInvoked(s).length).toBe(total.size);
  });
});

describe("repair — post-error mutated-arg retry", () => {
  it("error-chain: the two resolve-library-id calls are NOT repairs (first succeeded)", () => {
    expect(detectArgRepairs(errorChain())).toEqual([false, false, false]);
  });
  it("flags a retry after an error with changed args", () => {
    const s = sessionFromLines([
      '{"v":1,"ts":1,"session_id":"syn","type":"invoke_start","tool_id":"x__t","args_size_bytes":10}',
      '{"v":1,"ts":2,"session_id":"syn","type":"invoke_error","tool_id":"x__t","took_ms":5,"error":"invalid_params: bad schema"}',
      '{"v":1,"ts":3,"session_id":"syn","type":"invoke_start","tool_id":"x__t","args_size_bytes":20}',
      '{"v":1,"ts":4,"session_id":"syn","type":"invoke_end","tool_id":"x__t","took_ms":5}',
    ]);
    expect(detectArgRepairs(s)).toEqual([false, true]);
    expect(s.toolCalls[0].errorCategory).toBe("schema_reject");
  });
});

describe("loops — oscillation", () => {
  it("error-chain does not oscillate (resolve calls have different args)", () => {
    expect(detectOscillation(errorChain()).oscillation).toBe(false);
  });
  it("detects an identical repeated call", () => {
    const s = sessionFromLines([
      '{"v":1,"ts":1,"session_id":"syn","type":"invoke_start","tool_id":"x__t","args_size_bytes":5}',
      '{"v":1,"ts":2,"session_id":"syn","type":"invoke_end","tool_id":"x__t","took_ms":1}',
      '{"v":1,"ts":3,"session_id":"syn","type":"invoke_start","tool_id":"x__t","args_size_bytes":5}',
      '{"v":1,"ts":4,"session_id":"syn","type":"invoke_end","tool_id":"x__t","took_ms":1}',
    ]);
    expect(detectOscillation(s).oscillation).toBe(true);
  });
  it("detects an A→B→A cycle", () => {
    const s = sessionFromLines([
      '{"v":1,"ts":1,"session_id":"syn","type":"invoke_start","tool_id":"a__t","args_size_bytes":1}',
      '{"v":1,"ts":2,"session_id":"syn","type":"invoke_end","tool_id":"a__t","took_ms":1}',
      '{"v":1,"ts":3,"session_id":"syn","type":"invoke_start","tool_id":"b__t","args_size_bytes":1}',
      '{"v":1,"ts":4,"session_id":"syn","type":"invoke_end","tool_id":"b__t","took_ms":1}',
      '{"v":1,"ts":5,"session_id":"syn","type":"invoke_start","tool_id":"a__t","args_size_bytes":2}',
      '{"v":1,"ts":6,"session_id":"syn","type":"invoke_end","tool_id":"a__t","took_ms":1}',
    ]);
    expect(detectOscillation(s).oscillation).toBe(true);
  });
});

describe("inventory — fleet health quadrant", () => {
  it("classifies retrieved-never-invoked, high-error, and healthy tools", () => {
    const sessions = [
      buildSession("ec", parseTraceJsonl(loadFixture("error-chain.jsonl"))),
      buildSession("ss", parseTraceJsonl(loadFixture("skill-and-success.jsonl"))),
    ];
    const inv = computeInventory(sessions);
    const byId = new Map(inv.map((e) => [e.toolId, e]));
    expect(byId.get("linear-server__extract_images")?.quadrant).toBe("retrieved_never_invoked");
    expect(byId.get("context7__query-docs")?.quadrant).toBe("high_error"); // 1/1 errored
    expect(byId.get("context7__resolve-library-id")?.quadrant).toBe("healthy"); // 2 ok
    expect(byId.get("notion__notion-fetch")?.quadrant).toBe("healthy");
  });
});

describe("computeGatewaySignals — assembled per session", () => {
  it("error-chain: errors classified, ranks joined, no oscillation, no auth issue", () => {
    const g = computeGatewaySignals(errorChain());
    expect(g.perCall).toHaveLength(3);
    const qd = g.perCall.find((c) => c.toolId === "context7__query-docs")!;
    expect(qd.status).toBe("error");
    expect(qd.errorCategory).toBe("timeout");
    expect(qd.retrievalRank).toBe(1);
    expect(g.perSearch[0].foundNotInvoked).toContain("linear-server__extract_images");
    expect(g.perSearch[0].zeroHit).toBe(false);
    expect(g.perSearch[0].hitCount).toBe(3);
    expect(g.perSession.oscillation).toBe(false);
    expect(g.perSession.authNeededUnresolved).toBe(false); // only a successful refresh
    expect(g.perSession.successAtK).toBe(1);
  });

  it("auth-flow-chain: an auth_needs without resolution is flagged", () => {
    const s = buildSession("af", parseTraceJsonl(loadFixture("auth-flow-chain.jsonl")));
    // linear-server needs auth but is never refreshed/flow-ended in this session.
    expect(computeGatewaySignals(s).perSession.authNeededUnresolved).toBe(true);
  });
});
