/**
 * Dimension extractor ports — the seams where the two real models (and intent
 * clustering) plug in. Implementations are injected into the Detector (DI), so the
 * detection/stats core stays model-agnostic and the models can be swapped/stubbed.
 */

import type { ExtractionResult } from "@sia/contract";
import type { SearchEvent, Turn } from "../types";

// ─── Intent (deterministic in Phase 0; embedding-backed later) ───

export interface IntentCluster {
  id: string;
  label: string;
  /** Distinct queries assigned to this cluster. */
  queries: string[];
  /** Number of searches assigned (queries may repeat across sessions). */
  size: number;
}

export interface IntentAssignment {
  ts: number;
  query: string;
  clusterId: string;
}

export interface IntentClustering {
  clusters: IntentCluster[];
  assignments: IntentAssignment[];
}

export interface IntentClusterer {
  cluster(searches: SearchEvent[]): IntentClustering;
}

// ─── Unified cross-source intent clustering (real LLM in this phase) ───

/**
 * One semantic group of intent texts, as returned by the (LLM) clusterer.
 * `members` are a subset of the distinct input texts assigned to this group.
 */
export interface UnifiedClusterGroup {
  label: string;
  members: string[];
}

/**
 * Groups distinct intent texts into semantic clusters, regardless of which substrate
 * they came from (trace `Search.query` vs Orbitals transcript intents). This is the
 * HONEST bridge between the two disjoint populations (memory: `ratel-trace-no-turn-text`):
 * it relates intents by meaning (descriptive), without asserting the per-session join the
 * data can't support. Async because the real implementation is an LLM call (Claude);
 * unit-tested with a deterministic fake. Lives behind this port so the share/tbc math
 * (see `intent/unified.ts`) stays pure and model-free.
 */
export interface UnifiedIntentClusterer {
  cluster(texts: string[]): Promise<UnifiedClusterGroup[]>;
}

// ─── Claim + intent extraction (real Orbitals claim-extractor, transcript channel) ───

/**
 * Extracts user intents + agent/conversation claims from a session's transcript turns.
 *
 * The real implementation is the Orbitals claim-extractor (`lib/extractor.ts`), wired in
 * the route from `ORBITALS_*` env. It runs on the transcript channel (`~/.ratel/chat`),
 * which is a DISJOINT population from the trace telemetry the funnel/grid run on
 * (memory: `ratel-trace-no-turn-text`) — so its output is surfaced as its own report
 * section, NOT joined onto the trace-derived intent rows.
 */
export interface ClaimIntentExtractor {
  extract(turns: Turn[]): Promise<ExtractionResult>;
}

// ─── Sentiment (real HF GoEmotions in Phase 1) ───

/** 28 GoEmotions head scores in [0,1], keyed by emotion label. */
export type GoEmotionScores = Record<string, number>;

export interface SentimentScorer {
  score(text: string): Promise<GoEmotionScores>;
}

// ─── Resolution (real Claude judge in Phase 2) ───

export interface ResolutionVerdict {
  resolved: 0 | 1;
  confidence: number;
  reasoning: string;
  evidence_span: string;
}

export interface ResolutionJudge {
  judge(turns: Turn[]): Promise<ResolutionVerdict>;
  /** Human-readable judge identity (e.g. "Claude Haiku 4.5", "Flow-Judge v0.1") for report provenance. */
  label?: string;
}
