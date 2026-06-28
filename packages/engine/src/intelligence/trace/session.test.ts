import { describe, it, expect } from "vitest";
import { parseLine } from "./events";
import { parseTraceJsonl, groupBySession } from "./ingest";
import { buildSession, buildSessions } from "./session";
import { loadFixture } from "../__fixtures__/load";

describe("parseLine — tolerant parsing", () => {
  it("parses a real search envelope", () => {
    const ev = parseLine(
      '{"v":1,"ts":100,"session_id":"s1","type":"search","query":"q","origin":"agent","top_k":3,"hits":[{"tool_id":"a","score":1.2}],"took_ms":3}',
    );
    expect(ev?.type).toBe("search");
    expect(ev?.session_id).toBe("s1");
  });

  it("drops blank, invalid JSON, unknown type, and missing core fields", () => {
    expect(parseLine("")).toBeNull();
    expect(parseLine("   ")).toBeNull();
    expect(parseLine("{not json")).toBeNull();
    expect(parseLine('{"v":1,"ts":1,"session_id":"s","type":"future_event_v2"}')).toBeNull();
    expect(parseLine('{"v":1,"type":"search","session_id":"s"}')).toBeNull(); // no ts
    expect(parseLine('{"v":1,"ts":1,"type":"search"}')).toBeNull(); // no session_id
  });
});

describe("parseTraceJsonl + groupBySession", () => {
  it("parses a real fixture, keeps v===1, drops nothing valid", () => {
    const evs = parseTraceJsonl(loadFixture("error-chain.jsonl"));
    expect(evs.length).toBeGreaterThan(0);
    expect(evs.every((e) => e.v === 1)).toBe(true);
  });

  it("groups by session and sorts each group ascending by ts", () => {
    // Concatenate two different sessions; expect two groups.
    const blob = loadFixture("error-chain.jsonl") + "\n" + loadFixture("abandoned-no-capability.jsonl");
    const groups = groupBySession(parseTraceJsonl(blob));
    expect(groups.size).toBe(2);
    for (const evs of groups.values()) {
      for (let i = 1; i < evs.length; i++) expect(evs[i].ts).toBeGreaterThanOrEqual(evs[i - 1].ts);
    }
  });
});

describe("buildSession — error-chain fixture (67g1lh)", () => {
  const s = buildSession("67g1lh", parseTraceJsonl(loadFixture("error-chain.jsonl")));

  it("extracts exactly one detailed search with its real top score", () => {
    expect(s.searches).toHaveLength(1);
    expect(s.searches[0].query).toBe("context7 fetch library documentation");
    expect(s.searches[0].hits).toHaveLength(3);
    expect(s.searches[0].topScore).toBe(9.698053359985352);
  });

  it("dedups the co-emitted gateway_search (count-only mirror)", () => {
    // Only the detailed `search` survives; the gateway_search at the same ts+query is dropped.
    expect(s.searches.filter((x) => x.hitCount !== undefined)).toHaveLength(0);
  });

  it("folds the invoke lifecycle into 3 tool calls with the right outcomes", () => {
    expect(s.toolCalls).toHaveLength(3);
    const [a, b, c] = s.toolCalls;
    expect(a.toolId).toBe("context7__resolve-library-id");
    expect(a.status).toBe("ok");
    expect(b.toolId).toBe("context7__resolve-library-id");
    expect(b.status).toBe("ok");
    expect(c.toolId).toBe("context7__query-docs");
    expect(c.status).toBe("error");
  });

  it("classifies the connection-closed error as timeout", () => {
    const err = s.toolCalls.find((c) => c.status === "error")!;
    expect(err.error).toBe("MCP error -32000: Connection closed");
    expect(err.errorCategory).toBe("timeout");
  });

  it("joins retrieval rank from the preceding search (query-docs rank 1, resolve rank 2)", () => {
    const qd = s.toolCalls.find((c) => c.toolId === "context7__query-docs")!;
    expect(qd.retrievalRank).toBe(1);
    expect(qd.retrievalScore).toBe(9.698053359985352);
    const rl = s.toolCalls.find((c) => c.toolId === "context7__resolve-library-id")!;
    expect(rl.retrievalRank).toBe(2);
  });

  it("attributes the upstream server", () => {
    expect(s.toolCalls.every((c) => c.server === "context7")).toBe(true);
  });

  it("computes found-but-not-invoked (linear-server__extract_images was never used)", () => {
    expect(s.searches[0].foundNotInvoked).toEqual(["linear-server__extract_images"]);
    expect(s.searches[0].invokedToolIds).toContain("context7__query-docs");
    expect(s.searches[0].invokedToolIds).toContain("context7__resolve-library-id");
  });

  it("records the auth_refresh event (auth events ARE emitted in real data)", () => {
    expect(s.authEvents).toEqual([{ kind: "refresh", upstream: "linear-server", ok: true, ts: expect.any(Number) }]);
  });

  it("excludes index_churn / lifecycle noise from tool calls", () => {
    // 67g1lh has many index_churn lines; none may become a ToolCall.
    expect(s.toolCalls.every((c) => c.toolId.includes("__"))).toBe(true);
  });
});

describe("buildSession — abandonment / no-capability fixture (0bhvg9)", () => {
  const s = buildSession("0bhvg9", parseTraceJsonl(loadFixture("abandoned-no-capability.jsonl")));

  it("has searches but zero tool calls (the agent searched and gave up)", () => {
    expect(s.searches.length).toBe(2);
    expect(s.toolCalls).toHaveLength(0);
  });

  it("surfaces the intent that never found a fitting tool (Notion search → langfuse hits)", () => {
    const notionSearch = s.searches.find((x) => x.query.includes("Notion"))!;
    expect(notionSearch.hits.some((h) => h.toolId.startsWith("notion__"))).toBe(false);
    expect(notionSearch.foundNotInvoked.length).toBe(notionSearch.hits.length); // nothing invoked
  });
});

describe("buildSession — skill + success fixture (62b4ez)", () => {
  const s = buildSession("62b4ez", parseTraceJsonl(loadFixture("skill-and-success.jsonl")));

  it("captures a rank-1 success (notion-fetch was top hit and was invoked, ok)", () => {
    const first = s.searches[0];
    expect(first.topScore).toBe(20.22087287902832);
    const fetch = s.toolCalls.find((c) => c.toolId === "notion__notion-fetch")!;
    expect(fetch.retrievalRank).toBe(1);
    expect(fetch.status).toBe("ok");
    expect(fetch.server).toBe("notion");
  });

  it("captures skill searches including an empty-hit one (top_score null)", () => {
    expect(s.skillSearches.length).toBe(2);
    expect(s.skillSearches.some((x) => x.hits.length === 0)).toBe(true);
  });

  it("folds the 4 invoke lifecycles into 4 tool calls, all ok", () => {
    expect(s.toolCalls).toHaveLength(4);
    expect(s.toolCalls.every((c) => c.status === "ok")).toBe(true);
  });
});

describe("buildSession — auth-flow + found-not-invoked fixture (sqtwez)", () => {
  const s = buildSession("sqtwez", parseTraceJsonl(loadFixture("auth-flow-chain.jsonl")));

  it("captures all four auth event kinds", () => {
    const kinds = new Set(s.authEvents.map((a) => a.kind));
    expect(kinds).toEqual(new Set(["needs", "refresh", "flow_start", "flow_end"]));
    expect(s.authEvents.find((a) => a.kind === "flow_end")?.ok).toBe(true);
  });

  it("separates retrieved-and-invoked from retrieved-but-not-invoked", () => {
    const transcriptSearch = s.searches.find((x) => x.hits.some((h) => h.toolId === "granola__get_meeting_transcript"))!;
    // The agent invoked list_meetings, get_meetings, and (rank-1) get_meeting_transcript...
    expect(transcriptSearch.invokedToolIds).toContain("granola__get_meeting_transcript");
    // ...but never touched these two retrieved candidates.
    expect(transcriptSearch.foundNotInvoked).toContain("granola__query_granola_meetings");
    expect(transcriptSearch.foundNotInvoked).toContain("granola__list_meeting_folders");
  });
});

describe("buildSessions — multi-session + degenerate input", () => {
  it("builds one Session per session_id from a mixed blob", () => {
    const blob = loadFixture("error-chain.jsonl") + "\n" + loadFixture("skill-and-success.jsonl");
    const sessions = buildSessions(parseTraceJsonl(blob));
    expect(sessions).toHaveLength(2);
  });

  it("returns an empty-but-valid session for infra-only input (no crash)", () => {
    const infraOnly = [
      '{"v":1,"ts":1,"session_id":"x","type":"upstream_register","server":"s","transport":"t","tool_count":2}',
      '{"v":1,"ts":2,"session_id":"x","type":"index_churn","kind":"Add","tool_id":"s__t"}',
      '{"v":1,"ts":3,"session_id":"x","type":"auth_needs","upstream":"s"}',
    ].join("\n");
    const [s] = buildSessions(parseTraceJsonl(infraOnly));
    expect(s.searches).toHaveLength(0);
    expect(s.toolCalls).toHaveLength(0);
    expect(s.authEvents).toHaveLength(1);
  });
});
