// ─────────────────────────────────────────────────────────────────────────────
// Vendored intent-extractor wire types + SDK ↔ Cloud HTTP DTOs.
// ─────────────────────────────────────────────────────────────────────────────

import type { ExtendedTraceEnvelope, Arm } from "./trace";
import type { AgentConfig, ConfigChange } from "./config";

export type ChatRole = "user" | "assistant";

/** One conversation turn captured from a host. */
export interface ChatTurn {
  role: ChatRole;
  content: string;
}

export type ClaimSubtype = "factoid" | "capability" | "user_assertion" | "unverifiable";

export interface Claim {
  subtype: ClaimSubtype;
  content: string;
  evidences?: string[];
}

/** A user goal/request extracted from a conversation. */
export interface Intent {
  content: string;
  evidences?: string[];
}

export interface ExtractionResult {
  claims: Claim[];
  intents: Intent[];
}

// ── SDK → Cloud: trace emit channel (POST /api/traces) ───────────────────────
/** Batched, fire-and-forget envelope upload from the SDK at end-of-run. */
export interface TraceBatch {
  envelopes: ExtendedTraceEnvelope[];
}

// ── Example app → Cloud: transcript channel for the resolution judge (Phase 3) ─
export interface TranscriptTurn {
  role: ChatRole;
  content: string;
}
export interface Transcript {
  sessionId: string;
  configId: string;
  experimentId?: string;
  arm?: Arm;
  turns: TranscriptTurn[];
}

// ── Cloud → SDK: active-config fetch (GET /api/config/active) ─────────────────
export interface ActiveConfigResponseData {
  config: AgentConfig;
}

// ── Optimizer/operator → Cloud: derive a child snapshot (POST /api/config) ────
/** Apply one optimization to a parent (default: active champion), minting a child. */
export interface ApplyChangeRequest {
  /** Snapshot to derive from. Omitted ⇒ the current active champion. */
  parentId?: string;
  change: ConfigChange;
}
export interface ApplyChangeResponseData {
  /** The freshly minted (or deduped) child snapshot. NOT yet champion — promote separately. */
  config: AgentConfig;
}

// ── Optimizer/operator → Cloud: promote a snapshot to champion (POST /api/promote) ─
/** Flip the active pointer to `id` — this is BOTH promote and rollback. */
export interface PromoteRequest {
  id: string;
}
export interface PromoteResponseData {
  config: AgentConfig;
}

/**
 * Standard Cloud response envelope — mirrors the reference app: `ok`-discriminated,
 * success spreads payload fields at the TOP level (not nested `{ ok, data }`).
 */
export type ApiOk<T> = { ok: true } & T;
export type ApiErr = { ok: false; error: string; status?: number };
export type ApiResponse<T> = ApiOk<T> | ApiErr;
