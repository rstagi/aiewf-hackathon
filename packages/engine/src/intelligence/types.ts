/**
 * Conversation Intelligence — core domain model.
 *
 * Framework-free TS: nothing in `lib/intelligence/**` may import `next`, `react`,
 * or `next/server` (enforced by `import-boundary.test.ts`) so this core lifts
 * cleanly into the Ratel TS SDK. Route handlers are the only framework-aware layer.
 *
 * See `docs/impl-plan-conversation-intelligence.md` and `docs/rfc-conversation-intelligence.md`.
 */

import type { ChatTurn } from "@sia/contract";

/** A conversation turn with ordering metadata for trajectory analysis (§5.2). */
export type Turn = ChatTurn & { index: number; ts?: number };

/** Normalized invocation-error taxonomy (§3.2 signal 5). */
export type ErrorCategory =
  | "unknown_tool" // registry miss: "unknown_tool_id"
  | "unknown_skill" // skill-fetch miss: "unknown_skill_id"
  | "auth" // "needs_auth" and friends
  | "timeout" // upstream timeout / connection closed
  | "schema_reject" // argument schema validation failure
  | "upstream" // generic upstream/MCP failure
  | "empty" // empty/no result
  | "malformed" // malformed response
  | "other"; // unclassified

/**
 * One retrieval event. Reconciles the on-disk `hits` polymorphism:
 *  - `Search` emits `hits: [{tool_id, score}]` (detailed) → `hits` here.
 *  - `gateway_search` emits `hits: <int>` (count only) → `hitCount` here.
 * The two are never co-populated for the same logical search.
 */
export interface SearchEvent {
  query: string;
  origin: "agent" | "direct";
  topK?: number;
  /** Ranked candidates (rank = index + 1). Empty for gateway-only or zero-hit searches. */
  hits: { toolId: string; score: number }[];
  /** Count-only fallback from `gateway_search`. */
  hitCount?: number;
  /** Top BM25 score from `stages[].top_score` (raw, unbounded — normalize per-query before thresholding). */
  topScore?: number | null;
  tookMs?: number;
  ts: number;
  /** Filled by the join: which retrieved tools the agent actually invoked after this search. */
  invokedToolIds: string[];
  /** Retrieved-but-never-invoked candidates (§3.2 signal 2). */
  foundNotInvoked: string[];
}

/** One logical tool invocation, folded from the invoke_start → invoke_end|invoke_error lifecycle. */
export interface ToolCall {
  toolId: string;
  /** Which emitter layer the call surfaced through. */
  source: "tool" | "gateway" | "upstream" | "skill";
  startTs?: number;
  endTs?: number;
  tookMs?: number;
  argsSizeBytes?: number;
  status: "ok" | "error" | "pending";
  error?: string;
  errorCategory?: ErrorCategory;
  /** 1-based rank of this tool in the most recent preceding search that retrieved it. */
  retrievalRank?: number;
  retrievalScore?: number;
  /** ts of the search this call was joined to. */
  fromSearchTs?: number;
  /** Upstream MCP server, from upstream_invoke/upstream_error. */
  server?: string;
}

/** Skill body fetch (get_skill_content analogue). */
export interface SkillInvoke {
  skillId: string;
  tookMs?: number;
  ts: number;
}

/** A reconstructed session: the typed output of the event join. */
export interface Session {
  sessionId: string;
  project?: string;
  startedAt?: number;
  endedAt?: number;
  searches: SearchEvent[];
  skillSearches: SearchEvent[];
  toolCalls: ToolCall[];
  skillInvokes: SkillInvoke[];
  /** Auth lifecycle, by upstream. Real data DOES emit these (contradicts the schema's "test-only"). */
  authEvents: { kind: "needs" | "refresh" | "flow_start" | "flow_end"; upstream: string; ok?: boolean; ts: number }[];
  /** Transcript turns. EMPTY for trace-only sessions — supplied by a separate TranscriptSource. */
  turns: Turn[];
  /** Set by the resolution judge OR by the abandonment→UNRESOLVED censoring map (§4.1). */
  outcome?: "resolved" | "unresolved" | "abandoned";
}

// ─── Deterministic gateway-native signals (§3.2) — contract between signals/ and detector/ ───

export interface PerCallSignal {
  toolId: string;
  status: "ok" | "error" | "pending";
  errorCategory?: ErrorCategory;
  /** 1-based rank in the search that surfaced the tool, if any. */
  retrievalRank?: number;
  /** This call re-invoked a tool after a prior error on it, with mutated args (§3.2 signal 6). */
  isArgRepair: boolean;
  server?: string;
}

export interface PerSearchSignal {
  query: string;
  ts: number;
  /** Per-query-normalized top score in [0,1] (raw BM25 isn't comparable across queries; §4.4c). */
  topScoreNorm?: number;
  /** Confidence margin: normalized score(rank1) − score(rank2). */
  rank1MinusRank2?: number;
  zeroHit: boolean;
  hitCount: number;
  /** Retrieved-but-not-invoked tool ids in this search's window (§3.2 signal 2). */
  foundNotInvoked: string[];
}

export interface SessionSignal {
  sessionId: string;
  /** Identical (toolId, argsSizeBytes) repeated, or A→B→A cycle (§3.2 signal 7). */
  oscillation: boolean;
  oscillationDetail?: string;
  /** Number of skill bodies fetched (get_skill_content analogue; §3.2 signal 8). */
  skillFetched: number;
  /** auth_needs with no later successful auth_refresh/flow_end for that upstream. */
  authNeededUnresolved: boolean;
  /** Retrieval success@k for invoked tools (fraction invoked from within top-k). */
  successAtK?: number;
  /** Mean reciprocal rank of invoked tools. */
  mrr?: number;
}

export interface GatewaySignals {
  sessionId: string;
  perCall: PerCallSignal[];
  perSearch: PerSearchSignal[];
  perSession: SessionSignal;
}

/** Fleet inventory health quadrant, aggregated per tool across sessions (§3.2 signal 11). */
export interface InventoryEntry {
  toolId: string;
  retrievedCount: number;
  invokedCount: number;
  errorCount: number;
  /** never_retrieved is not observable from traces alone; quadrant covers the observable cases. */
  quadrant: "retrieved_never_invoked" | "high_error" | "healthy";
}
