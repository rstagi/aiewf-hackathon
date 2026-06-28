// ─────────────────────────────────────────────────────────────────────────────
// Ratel trace wire contract.
//
// The @ratel-ai/sdk exports NO trace types — its sink is `recordEvent(event: any)`
// and `drainTraceEvents(): unknown[]`. The real envelope shape is owned by the Rust
// core. This is a hand-maintained mirror of that on-the-wire schema, and it is the
// SINGLE shared definition imported by the SDK (emit) and the engine (ingest) so the
// two can never silently drift (PLAN risk #1). The golden test pins it to the
// recorded fixtures.
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchHit {
  tool_id: string;
  score: number;
}
export interface SkillHit {
  skill_id: string;
  score: number;
}
export interface SearchStage {
  name: string;
  took_ms: number;
  top_score: number | null;
}

interface Base {
  v: number;
  ts: number;
  session_id: string;
}

export type TraceEvent =
  | { type: "search"; query: string; origin: string; top_k: number; hits: SearchHit[]; stages?: SearchStage[]; took_ms: number }
  | { type: "gateway_search"; query: string; origin: string; top_k: number; hits: number; took_ms: number }
  | { type: "skill_search"; query: string; origin: string; top_k: number; hits: SkillHit[]; stages?: SearchStage[]; took_ms: number }
  | { type: "invoke_start"; tool_id: string; args_size_bytes?: number }
  | { type: "invoke_end"; tool_id: string; took_ms: number }
  | { type: "invoke_error"; tool_id: string; took_ms?: number; error: string }
  | { type: "gateway_invoke"; tool_id: string; took_ms: number }
  | { type: "gateway_error"; tool_id: string; error: string }
  | { type: "upstream_invoke"; server: string; tool_id: string; took_ms: number }
  | { type: "upstream_error"; server: string; tool_id: string; error: string }
  | { type: "upstream_register"; server: string; transport: string; tool_count: number }
  | { type: "skill_invoke"; skill_id: string; took_ms?: number }
  | { type: "index_churn"; kind: string; tool_id: string }
  | { type: "skill_churn"; kind: string; skill_id: string }
  | { type: "auth_needs"; upstream: string }
  | { type: "auth_refresh"; upstream: string; ok?: boolean }
  | { type: "auth_flow_start"; upstream: string }
  | { type: "auth_flow_end"; upstream: string; ok?: boolean };

/** A TraceEvent flattened onto the envelope base. v/ts/session_id are stamped by the native sink. */
export type TraceEnvelope = Base & TraceEvent;

// ─────────────────────────────────────────────────────────────────────────────
// ADDITIVE EXTENSION (PLAN Phase 1, risk #1).
//
// configId / arm / experimentId CANNOT be injected through recordEvent() — the Rust
// core deserializes into its tagged enum and re-wraps with its own v/ts/session_id,
// dropping unknown keys. The ONLY safe place to attach them is AFTER
// drainTraceEvents(): map over the plain-JSON envelopes and spread these in. They are
// camelCase, so they never collide with the snake_case wire fields. Without this,
// paired-A/B attribution breaks SILENTLY (dashboards still render; numbers wrong).
// ─────────────────────────────────────────────────────────────────────────────
export type Arm = "champion" | "challenger";

export interface TraceAttribution {
  configId?: string;
  arm?: Arm;
  experimentId?: string;
}

export type ExtendedTraceEnvelope = TraceEnvelope & TraceAttribution;

/** Lifecycle-noise event types excluded from tool-call analysis. */
export const NOISE_TYPES = new Set<string>(["index_churn", "skill_churn", "upstream_register"]);

const KNOWN_TYPES = new Set<string>([
  "search", "gateway_search", "skill_search",
  "invoke_start", "invoke_end", "invoke_error",
  "gateway_invoke", "gateway_error",
  "upstream_invoke", "upstream_error", "upstream_register",
  "skill_invoke", "index_churn", "skill_churn",
  "auth_needs", "auth_refresh", "auth_flow_start", "auth_flow_end",
]);

/**
 * Parse ONE JSONL line into an envelope, or null. Tolerant by design (additive-only
 * schema; never throws). Validates only type/session_id/ts — extra keys (incl. the
 * camelCase configId/arm/experimentId additions) pass through untouched.
 */
export function parseLine(line: string): TraceEnvelope | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  if (typeof rec.type !== "string" || !KNOWN_TYPES.has(rec.type)) return null;
  if (typeof rec.session_id !== "string" || typeof rec.ts !== "number") return null;
  return rec as unknown as TraceEnvelope;
}

/** Full-blob parse: split on newline, parseLine each, drop nulls. Canonical ingest entrypoint. */
export function parseTraceJsonl(jsonl: string): TraceEnvelope[] {
  const out: TraceEnvelope[] = [];
  for (const line of jsonl.split("\n")) {
    const ev = parseLine(line);
    if (ev) out.push(ev);
  }
  return out;
}

/** True for the lifecycle-noise types (registration churn, upstream registration). */
export function isNoise(type: string): boolean {
  return NOISE_TYPES.has(type);
}
