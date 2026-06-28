/**
 * Detector domain types — the cross-reference engine's output (§4).
 */

import type { InventoryEntry } from "../types";
import type {
  ClaimIntentExtractor,
  IntentCluster,
  IntentClusterer,
  SentimentScorer,
  ResolutionJudge,
  UnifiedIntentClusterer,
} from "../dimensions/types";
import type { ClaimIntelReport } from "../dimensions/claims/aggregate";
import type { UnifiedIntentReport } from "../dimensions/intent/unified";
import type { ResolutionReport } from "../dimensions/resolution/aggregate";

export type FunnelStage = "searched" | "found" | "invoked" | "succeeded" | "resolved";

export type FlagKind =
  | "funnel_leak"
  | "intent_no_capability" // question (c-i): build a tool
  | "intent_tune_description" // question (c-ii): tune description / ranking
  | "tool_high_error"
  | "tool_retrieved_never_invoked"
  | "oscillation"
  | "tool_neg_sentiment" // (a) — Phase 1, needs SentimentScorer
  | "tool_unresolved"; // (b) — Phase 2, needs ResolutionJudge

export interface Flag {
  kind: FlagKind;
  intentCluster?: string;
  intentLabel?: string;
  toolId?: string;
  funnelStage?: FunnelStage;
  /** Signed effect size (e.g. adjusted risk difference). */
  effectSize: number;
  effectKind: string;
  direction: "+" | "-" | "0";
  ci?: [number, number];
  pValue?: number;
  qValue?: number;
  /** Cell size the flag rests on. */
  n: number;
  reason: string;
  recommendation: string;
}

export interface IntentFunnel {
  clusterId: string;
  label: string;
  searched: number;
  found: number;
  invoked: number;
  succeeded: number;
  /** Conditional conversions. */
  foundRate: number;
  invokeRate: number;
  successRate: number;
  /** Median per-query normalized top score across the cluster's searches. */
  medianTopScoreNorm: number;
}

export interface GridCell {
  clusterId: string;
  label: string;
  toolId: string;
  /** Invocations in this (intent, tool) cell. */
  n: number;
  invokeSuccess: number;
  successRate: number;
  successCI: [number, number];
  /** P(resolved | intent, tool) — filled in Phase 2 when a ResolutionJudge is supplied. */
  resolvedRate?: number;
}

export interface DetectionConfig {
  /** Cell event gate: min(n·p, n·(1−p)) ≥ minCellEvents. */
  minCellEvents: number;
  /** Minimum absolute effect size to flag. */
  minEffect: number;
  /** FDR target for the Benjamini–Yekutieli scan. */
  fdrQ: number;
  /** Normalized top-score below which a cluster's retrieval is "low confidence". */
  lowConfidenceTopScore: number;
  successK: number;
  clusterThreshold: number;
  /** Minimum searches in a cluster before intent flags are considered. */
  minClusterSearches: number;
  highErrorRate: number;
  /** Minimum invocations of a tool before tool-health flags are considered. */
  minToolInvocations: number;
}

export const DEFAULT_CONFIG: DetectionConfig = {
  minCellEvents: 5,
  minEffect: 0.15,
  fdrQ: 0.1,
  lowConfidenceTopScore: 0.5,
  successK: 5,
  clusterThreshold: 0.3,
  minClusterSearches: 5,
  highErrorRate: 0.5,
  minToolInvocations: 5,
};

export interface DetectorDeps {
  clusterer: IntentClusterer;
  sentiment?: SentimentScorer; // Phase 1
  resolution?: ResolutionJudge; // Phase 2
  /** Orbitals claim-extractor over the transcript channel (~/.ratel/chat). */
  claimIntent?: ClaimIntentExtractor;
  /**
   * LLM clusterer that unifies intents from BOTH substrates (trace `Search.query` +
   * transcript) into one semantic list. Descriptive only — does NOT assert the
   * per-session join the disjoint populations can't support.
   */
  unifiedClusterer?: UnifiedIntentClusterer;
}

export interface DetectionReport {
  sessionsAnalyzed: number;
  searchesAnalyzed: number;
  clusters: IntentCluster[];
  funnel: IntentFunnel[];
  grid: GridCell[];
  inventory: InventoryEntry[];
  flags: Flag[];
  /** Transcript-channel claim/intent dimension; present only when a ClaimIntentExtractor is injected. */
  claimIntel?: ClaimIntelReport;
  /** Unified cross-source intent clusters; present only when a UnifiedIntentClusterer is injected. */
  unifiedIntel?: UnifiedIntentReport;
  /**
   * Transcript-channel resolution dimension (per-session resolved rate + Wilson CI); present
   * only when a ResolutionJudge is injected. Descriptive — NOT joined onto the trace grid, whose
   * `resolvedRate` stays dormant until a paired trace↔transcript source exists.
   */
  resolutionIntel?: ResolutionReport;
  censored: { abandonedSessions: number; note: string };
  config: DetectionConfig;
}
