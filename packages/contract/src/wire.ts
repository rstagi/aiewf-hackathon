// ─────────────────────────────────────────────────────────────────────────────
// Vendored intent-extractor wire types + SDK ↔ Cloud HTTP DTOs.
// ─────────────────────────────────────────────────────────────────────────────

import type { ExtendedTraceEnvelope } from "./trace";
import type { AgentConfig, ConfigChange, ConfigDraft } from "./config";

export type ChatRole = "user" | "assistant";

/** One conversation turn captured from a host. */
export interface ChatTurn {
  role: ChatRole;
  content: string;
}

// ── SDK → Cloud: trace emit channel (POST /api/traces) ───────────────────────
/** Batched, fire-and-forget envelope upload from the SDK at end-of-run. */
export interface TraceBatch {
  envelopes: ExtendedTraceEnvelope[];
}

// ── Operator → Cloud: ingest/replace a catalog (POST /api/catalog) ───────────
/** Register a fresh catalog surface — mints v1 and sets it active in one step. */
export interface IngestCatalogRequest {
  draft: ConfigDraft;
}
export interface IngestCatalogResponseData {
  /** The freshly minted (or deduped) catalog version, now active. */
  config: AgentConfig;
}

// ── Cloud → SDK: active-config fetch (GET /api/config/active) ─────────────────
export interface ActiveConfigResponseData {
  config: AgentConfig;
}

// ── Cloud → operator: catalog version history (GET /api/config/versions) ──────
export interface VersionsResponseData {
  /** All known snapshots (immutable versions). */
  versions: AgentConfig[];
  /** The currently active (champion) snapshot id, if any. */
  activeId?: string;
}

// ── The self-healing proposal — the unit of the analyze → apply loop ─────────
export type ProposalRoute = "create-new" | "improve-existing" | "ignore";
export type ProposalStatus = "proposed" | "applied" | "dismissed";

/**
 * One routed gap: a Jaccard cluster of missed queries plus the change that closes it.
 * `change` is absent for route "ignore". Applying a proposal derives + promotes a child.
 */
export interface Proposal {
  id: string;
  /** The intent label from the clusterer (top content tokens). */
  intentLabel: string;
  /** Distinct queries in the gap cluster (the evidence). */
  queries: string[];
  route: ProposalRoute;
  /** Short human rationale for the route (LLM- or template-authored). */
  rationale: string;
  /** The change to apply — `rewrite_skill_desc` (improve) or `add_skill` (create). Absent for "ignore". */
  change?: ConfigChange;
  status: ProposalStatus;
  createdAt: number;
}

// ── Cloud → operator: run the analyzer (POST /api/analyze) ───────────────────
export interface AnalyzeResponseData {
  proposals: Proposal[];
}

// ── Cloud → operator: list proposals (GET /api/proposals) ────────────────────
export interface ProposalsResponseData {
  proposals: Proposal[];
}

// ── Operator → Cloud: apply a proposal (POST /api/apply) ─────────────────────
/** Mint the proposal's child version, flip the active pointer, mark the proposal applied. */
export interface ApplyProposalRequest {
  proposalId: string;
}
export interface ApplyProposalResponseData {
  /** The proposal with status now "applied". */
  proposal: Proposal;
  /** The newly active (promoted) child snapshot. */
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
