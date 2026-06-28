// ─────────────────────────────────────────────────────────────────────────────
// Vendored intent-extractor wire types + SDK ↔ Cloud HTTP DTOs.
// ─────────────────────────────────────────────────────────────────────────────

import type { ExtendedTraceEnvelope, Arm } from "./trace";
import type { AgentConfig } from "./config";

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

/**
 * Standard Cloud response envelope — mirrors the reference app: `ok`-discriminated,
 * success spreads payload fields at the TOP level (not nested `{ ok, data }`).
 */
export type ApiOk<T> = { ok: true } & T;
export type ApiErr = { ok: false; error: string; status?: number };
export type ApiResponse<T> = ApiOk<T> | ApiErr;
