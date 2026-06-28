// ─────────────────────────────────────────────────────────────────────────────
// The v4 gap gate — deterministic, framework-free, LLM-free.
//
// Reconstruct sessions from usage envelopes, cluster the queries (Jaccard), and surface
// the clusters that are GAPS: every search in the cluster missed (the agent retrieved
// nothing it would invoke) and there are enough distinct queries to rule out a fluke.
//
// Each gap is then ROUTED deterministically from the retrieval evidence:
//   • improve-existing — one real catalog skill is the consistent near-miss (top hit in
//     ≥ half the searches, mean score ≥ nearMissMin but below the invoke floor). Its
//     description is too weak; rewriting it closes the gap. (Seed leak: account-recovery ≈ 2.48.)
//   • create-new — no such candidate (often zero hits at all). The catalog is genuinely
//     missing the capability; the Cloud must author a brand-new skill. (Seed gap: "talk to a human".)
//
// The LLM never routes — it only AUTHORS the change for the route chosen here. That keeps
// the gate cheap, legible, and reproducible.
// ─────────────────────────────────────────────────────────────────────────────

import type { ExtendedTraceEnvelope } from "@sia/contract";
import { buildSessions } from "./trace/session";
import { DeterministicIntentClusterer } from "./dimensions/intent/cluster";
import type { SearchEvent } from "./types";

export type GapRoute = "create-new" | "improve-existing";

/** The consistent near-miss skill behind an improve-existing gap. */
export interface GapCandidate {
  skillId: string;
  /** How many of the cluster's searches had this skill as the top hit. */
  topHitCount: number;
  /** Mean BM25 score of this skill as top hit across the cluster (below the invoke floor). */
  meanScore: number;
}

/** One routed gap: a cluster of missed queries plus the route the evidence implies. */
export interface GapCluster {
  clusterId: string;
  /** The clusterer's label (top content tokens) — also a decent human intent name. */
  label: string;
  /** Distinct queries assigned to the cluster (the evidence). */
  queries: string[];
  /** Total searches in the cluster (queries may repeat). */
  searchCount: number;
  route: GapRoute;
  /** The near-miss skill to improve — present iff route === "improve-existing". */
  candidate?: GapCandidate;
}

export interface DetectGapsOptions {
  /** Minimum distinct queries for a cluster to count as a gap (not a fluke). Default 2. */
  minQueries?: number;
  /** Mean top-hit score at/above which a consistent candidate routes to improve-existing. Default 1.5. */
  nearMissMin?: number;
}

export function detectGaps(
  envelopes: ExtendedTraceEnvelope[],
  options: DetectGapsOptions = {},
): GapCluster[] {
  const minQueries = options.minQueries ?? 2;
  const nearMissMin = options.nearMissMin ?? 1.5;

  const searches = buildSessions(envelopes).flatMap((s) => s.searches);
  const clustering = new DeterministicIntentClusterer().cluster(searches);

  // Join each SearchEvent back to its cluster id via the clusterer's assignments.
  const clusterOf = new Map<SearchEvent, string>();
  for (const s of searches) {
    const a = clustering.assignments.find((x) => x.query === s.query && x.ts === s.ts);
    if (a) clusterOf.set(s, a.clusterId);
  }

  const gaps: GapCluster[] = [];
  for (const cluster of clustering.clusters) {
    const members = searches.filter((s) => clusterOf.get(s) === cluster.id);
    if (members.length === 0) continue;

    // Gap gate: EVERY search missed (no invoke) AND enough distinct queries.
    const allMissed = members.every((s) => s.invokedToolIds.length === 0);
    const distinctQueries = [...new Set(members.map((s) => s.query))];
    if (!allMissed || distinctQueries.length < minQueries) continue;

    // Aggregate the top-hit candidate across the cluster's searches.
    const agg = new Map<string, { count: number; sum: number }>();
    for (const s of members) {
      const top = s.hits[0];
      if (!top) continue;
      const cur = agg.get(top.toolId) ?? { count: 0, sum: 0 };
      cur.count += 1;
      cur.sum += top.score;
      agg.set(top.toolId, cur);
    }
    // Best candidate = most frequently top hit; tie-break by higher mean score.
    let candidate: GapCandidate | undefined;
    for (const [skillId, { count, sum }] of agg) {
      const meanScore = sum / count;
      if (
        !candidate ||
        count > candidate.topHitCount ||
        (count === candidate.topHitCount && meanScore > candidate.meanScore)
      ) {
        candidate = { skillId, topHitCount: count, meanScore };
      }
    }

    const isImprove =
      candidate !== undefined &&
      candidate.topHitCount >= Math.ceil(members.length / 2) &&
      candidate.meanScore >= nearMissMin;

    gaps.push({
      clusterId: cluster.id,
      label: cluster.label,
      queries: distinctQueries,
      searchCount: members.length,
      route: isImprove ? "improve-existing" : "create-new",
      candidate: isImprove ? candidate : undefined,
    });
  }
  return gaps;
}
