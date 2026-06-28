/**
 * Intent clustering port — the seam where query→intent grouping plugs in.
 *
 * Phase-0/v4 keeps this deterministic (Jaccard over query tokens); an
 * embedding-backed clusterer could implement the same `IntentClusterer` port later
 * without touching the gap-detection logic that consumes the clustering.
 */

import type { SearchEvent } from "../types";

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
