/**
 * Unified cross-source intent clustering — share/tbc math (pure, model-free).
 *
 * The two intent substrates are DISJOINT, non-joinable populations at the session-id level
 * (memory: `ratel-trace-no-turn-text`): trace `Search.query` intents and Orbitals transcript
 * intents never share a session id. This module is the HONEST bridge between them: it feeds
 * the distinct intent texts from BOTH substrates to a semantic clusterer (an LLM, behind the
 * `UnifiedIntentClusterer` port) and then computes, per unified cluster, its source mix and a
 * session share = distinct sessions containing it / distinct sessions with ANY intent.
 *
 * Clusters present in fewer than `threshold` (default 20%) of the intent-bearing sessions are
 * marked `tbc` — long-tail, a minority of conversations, surfaced but not asserted.
 *
 * All of the share/tbc/source-mix arithmetic lives here so it is golden-testable with a fake
 * clusterer; only the semantic grouping crosses the (async) model boundary.
 */

import type { UnifiedIntentClusterer } from "../types";

/** One intent occurrence tagged with which substrate it came from and its session. */
export interface SourcedIntent {
  text: string;
  source: "search" | "transcript";
  sessionId: string;
}

export interface UnifiedIntentCluster {
  label: string;
  /** Distinct member intent texts assigned to this cluster (canonical, first-seen). */
  members: string[];
  /** Occurrences (with session multiplicity) sourced from trace `Search.query`. */
  searchCount: number;
  /** Occurrences sourced from Orbitals transcript intents. */
  transcriptCount: number;
  /** Distinct sessions (either substrate) containing this cluster, sorted. */
  sessionIds: string[];
  /** sessionIds.length / totalSessionsWithAnyIntent. */
  sessionShare: number;
  /** True when sessionShare is strictly below the threshold (long-tail / minority). */
  tbc: boolean;
}

export interface UnifiedIntentReport {
  /** Distinct sessions (across BOTH substrates) that carried any intent. */
  totalSessionsWithAnyIntent: number;
  /** Distinct sessions whose intents came from the trace substrate. */
  searchSessions: number;
  /** Distinct sessions whose intents came from the transcript substrate. */
  transcriptSessions: number;
  tbcThreshold: number;
  /** Unified clusters, most prevalent (by session share) first. */
  clusters: UnifiedIntentCluster[];
}

/** Case/whitespace-insensitive key for de-duplicating intent texts. */
function key(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

const EMPTY_REPORT = (threshold: number): UnifiedIntentReport => ({
  totalSessionsWithAnyIntent: 0,
  searchSessions: 0,
  transcriptSessions: 0,
  tbcThreshold: threshold,
  clusters: [],
});

/**
 * Cluster intents from both substrates into one semantic list with source-mix + session-share.
 * `threshold` is the session-share floor below which a cluster is flagged `tbc` (default 0.2).
 */
export async function clusterUnifiedIntents(
  intents: SourcedIntent[],
  clusterer: UnifiedIntentClusterer,
  threshold = 0.2,
): Promise<UnifiedIntentReport> {
  // Index sourced intents by normalized text; keep first-seen canonical form.
  const byKey = new Map<string, { canonical: string; occurrences: SourcedIntent[] }>();
  const allSessions = new Set<string>();
  const searchSessionSet = new Set<string>();
  const transcriptSessionSet = new Set<string>();

  for (const it of intents) {
    const text = it.text?.trim();
    if (!text) continue;
    allSessions.add(it.sessionId);
    if (it.source === "search") searchSessionSet.add(it.sessionId);
    else transcriptSessionSet.add(it.sessionId);
    const k = key(text);
    const existing = byKey.get(k);
    if (existing) existing.occurrences.push(it);
    else byKey.set(k, { canonical: text, occurrences: [it] });
  }

  if (byKey.size === 0) return EMPTY_REPORT(threshold);

  const totalSessions = allSessions.size;
  const distinctTexts = [...byKey.values()].map((v) => v.canonical);
  const groups = await clusterer.cluster(distinctTexts);

  const clusters: UnifiedIntentCluster[] = groups.map((g) => {
    const members: string[] = [];
    const sessionIds = new Set<string>();
    let searchCount = 0;
    let transcriptCount = 0;
    for (const m of g.members) {
      const entry = byKey.get(key(m));
      if (!entry) continue; // tolerate a clusterer that returns texts not in the input
      members.push(entry.canonical);
      for (const occ of entry.occurrences) {
        sessionIds.add(occ.sessionId);
        if (occ.source === "search") searchCount++;
        else transcriptCount++;
      }
    }
    const sessionShare = totalSessions > 0 ? sessionIds.size / totalSessions : 0;
    return {
      label: g.label,
      members,
      searchCount,
      transcriptCount,
      sessionIds: [...sessionIds].sort(),
      sessionShare,
      tbc: sessionShare < threshold,
    };
  });

  clusters.sort((a, b) => b.sessionShare - a.sessionShare || a.label.localeCompare(b.label));

  return {
    totalSessionsWithAnyIntent: totalSessions,
    searchSessions: searchSessionSet.size,
    transcriptSessions: transcriptSessionSet.size,
    tbcThreshold: threshold,
    clusters,
  };
}
