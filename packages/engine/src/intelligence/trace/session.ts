/**
 * buildSession — the event→typed-join deep module.
 *
 * Folds the raw envelope stream of one session into a typed `Session`:
 *  - search / gateway_search / skill_search → SearchEvent[] (hits polymorphism reconciled)
 *  - invoke_start → invoke_end|invoke_error lifecycle → ToolCall[], enriched with the
 *    upstream `server` and the retrieval rank of the most recent search that surfaced the tool
 *  - per-search invoked vs found-not-invoked, computed over the search's window
 *  - auth_* and skill_invoke collected as-is
 *
 * Transcript turns are supplied separately (real traces carry no turn text) and joined here.
 */

import { NOISE_TYPES, type TraceEnvelope } from "./events";
import { classifyError } from "../signals/errors";
import type { Session, SearchEvent, ToolCall, SkillInvoke, Turn } from "../types";

function originOf(raw: string | undefined): "agent" | "direct" {
  return raw === "direct" ? "direct" : "agent";
}

/** Build all sessions from a flat envelope list. */
export function buildSessions(
  envelopes: TraceEnvelope[],
  transcripts?: Map<string, Turn[]>,
  project?: string,
): Session[] {
  const groups = new Map<string, TraceEnvelope[]>();
  for (const ev of envelopes) {
    const g = groups.get(ev.session_id);
    if (g) g.push(ev);
    else groups.set(ev.session_id, [ev]);
  }
  const out: Session[] = [];
  for (const [sessionId, evs] of groups) {
    evs.sort((a, b) => a.ts - b.ts);
    out.push(buildSession(sessionId, evs, transcripts?.get(sessionId), project));
  }
  return out;
}

/** Build one session from its time-ordered envelopes. */
export function buildSession(
  sessionId: string,
  envelopes: TraceEnvelope[],
  turns: Turn[] = [],
  project?: string,
): Session {
  const evs = envelopes.filter((e) => !NOISE_TYPES.has(e.type));

  const searches: SearchEvent[] = [];
  const skillSearches: SearchEvent[] = [];
  const toolCalls: ToolCall[] = [];
  const skillInvokes: SkillInvoke[] = [];
  const authEvents: Session["authEvents"] = [];

  // Track detailed searches we've seen, so a co-emitted gateway_search (count-only mirror)
  // isn't double-counted. The gateway_search ts can lag its `search` by ~1ms, so match by
  // query within a small time window rather than exact ts.
  const detailedSearches: { ts: number; query: string }[] = [];
  const GATEWAY_MIRROR_WINDOW_MS = 200;
  // Open tool-call lifecycle queues, keyed by toolId (FIFO).
  const openByTool = new Map<string, ToolCall[]>();
  const toolIdsWithStart = new Set<string>();
  // gateway_invoke/gateway_error that may need fallback ToolCalls if no invoke_start exists.
  const gatewayOnly: { type: "ok" | "error"; toolId: string; ts: number; tookMs?: number; error?: string }[] = [];

  let startedAt: number | undefined;
  let endedAt: number | undefined;

  for (const ev of evs) {
    startedAt = startedAt === undefined ? ev.ts : Math.min(startedAt, ev.ts);
    endedAt = endedAt === undefined ? ev.ts : Math.max(endedAt, ev.ts);

    switch (ev.type) {
      case "search": {
        detailedSearches.push({ ts: ev.ts, query: ev.query });
        searches.push({
          query: ev.query,
          origin: originOf(ev.origin),
          topK: ev.top_k,
          hits: ev.hits.map((h) => ({ toolId: h.tool_id, score: h.score })),
          topScore: ev.stages?.[0]?.top_score ?? ev.hits[0]?.score ?? null,
          tookMs: ev.took_ms,
          ts: ev.ts,
          invokedToolIds: [],
          foundNotInvoked: [],
        });
        break;
      }
      case "gateway_search": {
        // Skip if a detailed `search` for the same query was recorded within the window.
        const mirrored = detailedSearches.some(
          (d) => d.query === ev.query && Math.abs(d.ts - ev.ts) <= GATEWAY_MIRROR_WINDOW_MS,
        );
        if (mirrored) break;
        searches.push({
          query: ev.query,
          origin: originOf(ev.origin),
          topK: ev.top_k,
          hits: [],
          hitCount: ev.hits,
          topScore: undefined,
          tookMs: ev.took_ms,
          ts: ev.ts,
          invokedToolIds: [],
          foundNotInvoked: [],
        });
        break;
      }
      case "skill_search": {
        skillSearches.push({
          query: ev.query,
          origin: originOf(ev.origin),
          topK: ev.top_k,
          hits: ev.hits.map((h) => ({ toolId: h.skill_id, score: h.score })),
          topScore: ev.stages?.[0]?.top_score ?? ev.hits[0]?.score ?? null,
          tookMs: ev.took_ms,
          ts: ev.ts,
          invokedToolIds: [],
          foundNotInvoked: [],
        });
        break;
      }
      case "invoke_start": {
        const call: ToolCall = {
          toolId: ev.tool_id,
          source: "tool",
          startTs: ev.ts,
          argsSizeBytes: ev.args_size_bytes,
          status: "pending",
        };
        toolCalls.push(call);
        const q = openByTool.get(ev.tool_id);
        if (q) q.push(call);
        else openByTool.set(ev.tool_id, [call]);
        toolIdsWithStart.add(ev.tool_id);
        break;
      }
      case "invoke_end": {
        const call = openByTool.get(ev.tool_id)?.shift();
        if (call) {
          call.endTs = ev.ts;
          call.tookMs = ev.took_ms;
          call.status = "ok";
        }
        break;
      }
      case "invoke_error": {
        const call = openByTool.get(ev.tool_id)?.shift();
        if (call) {
          call.endTs = ev.ts;
          call.tookMs = ev.took_ms;
          call.status = "error";
          call.error = ev.error;
          call.errorCategory = classifyError(ev.error);
        }
        break;
      }
      case "upstream_invoke":
      case "upstream_error": {
        // Attribute the upstream server to the most recent matching ToolCall lacking one.
        const target = lastMatch(toolCalls, (c) => c.toolId === ev.tool_id && c.server === undefined);
        if (target) target.server = ev.server;
        break;
      }
      case "gateway_invoke":
        gatewayOnly.push({ type: "ok", toolId: ev.tool_id, ts: ev.ts, tookMs: ev.took_ms });
        break;
      case "gateway_error":
        gatewayOnly.push({ type: "error", toolId: ev.tool_id, ts: ev.ts, error: ev.error });
        break;
      case "skill_invoke":
        skillInvokes.push({ skillId: ev.skill_id, tookMs: ev.took_ms, ts: ev.ts });
        break;
      case "auth_needs":
        authEvents.push({ kind: "needs", upstream: ev.upstream, ts: ev.ts });
        break;
      case "auth_refresh":
        authEvents.push({ kind: "refresh", upstream: ev.upstream, ok: ev.ok, ts: ev.ts });
        break;
      case "auth_flow_start":
        authEvents.push({ kind: "flow_start", upstream: ev.upstream, ts: ev.ts });
        break;
      case "auth_flow_end":
        authEvents.push({ kind: "flow_end", upstream: ev.upstream, ok: ev.ok, ts: ev.ts });
        break;
    }
  }

  // Fallback: gateway events for tools that never had an invoke_start become standalone calls.
  for (const g of gatewayOnly) {
    if (toolIdsWithStart.has(g.toolId)) continue;
    toolCalls.push({
      toolId: g.toolId,
      source: "gateway",
      startTs: g.ts,
      endTs: g.ts,
      tookMs: g.tookMs,
      status: g.type === "ok" ? "ok" : "error",
      error: g.error,
      errorCategory: g.type === "error" ? classifyError(g.error) : undefined,
    });
  }

  joinRetrieval(searches, toolCalls);

  return {
    sessionId,
    project,
    startedAt,
    endedAt,
    searches,
    skillSearches,
    toolCalls,
    skillInvokes,
    authEvents,
    turns,
  };
}

/** Last element satisfying pred (search from the end). */
function lastMatch<T>(arr: T[], pred: (x: T) => boolean): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return arr[i];
  return undefined;
}

/**
 * Join tool calls to the searches that surfaced them:
 *  - retrievalRank/score = position in the most recent preceding search whose hits contain the tool.
 *  - per-search invokedToolIds / foundNotInvoked over the [search, nextSearch) window.
 */
function joinRetrieval(searches: SearchEvent[], toolCalls: ToolCall[]): void {
  if (searches.length === 0) return;
  const ordered = [...searches].sort((a, b) => a.ts - b.ts);

  for (const call of toolCalls) {
    if (call.startTs === undefined) continue;
    // Most recent preceding search that actually retrieved this tool.
    for (let i = ordered.length - 1; i >= 0; i--) {
      const s = ordered[i];
      if (s.ts > call.startTs) continue;
      const idx = s.hits.findIndex((h) => h.toolId === call.toolId);
      if (idx >= 0) {
        call.retrievalRank = idx + 1;
        call.retrievalScore = s.hits[idx].score;
        call.fromSearchTs = s.ts;
        break;
      }
    }
  }

  // Window-based invoked / found-not-invoked.
  for (let i = 0; i < ordered.length; i++) {
    const s = ordered[i];
    const windowEnd = i + 1 < ordered.length ? ordered[i + 1].ts : Infinity;
    const invokedInWindow = new Set(
      toolCalls
        .filter((c) => c.startTs !== undefined && c.startTs >= s.ts && c.startTs < windowEnd)
        .map((c) => c.toolId),
    );
    const hitIds = s.hits.map((h) => h.toolId);
    s.invokedToolIds = hitIds.filter((id) => invokedInWindow.has(id));
    s.foundNotInvoked = hitIds.filter((id) => !invokedInWindow.has(id));
  }
}
