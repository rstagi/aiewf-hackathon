/**
 * Funnel stage-conversion per intent cluster (§4.1).
 *
 * Phase-0 observable stages: searched → found → invoked → succeeded. (resolved /
 * recovered need the Phase 1/2 models.) Unit = search instance (an intent occurrence),
 * grouped by cluster. Abandonment (searched, never invoked) is mapped to an explicit
 * non-conversion, NOT dropped — dropping it is informative censoring that inflates rates.
 */

import type { Session } from "../types";
import type { IntentClustering } from "../dimensions/types";
import { topAndMargin } from "../signals/normalize";
import type { IntentFunnel } from "./types";

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface Acc {
  searched: number;
  found: number;
  invoked: number;
  succeeded: number;
  topScores: number[];
}

export function buildFunnel(sessions: Session[], clustering: IntentClustering): IntentFunnel[] {
  const clusterOf = new Map<string, string>();
  for (const a of clustering.assignments) clusterOf.set(`${a.ts}|${a.query}`, a.clusterId);
  const labelOf = new Map(clustering.clusters.map((c) => [c.id, c.label]));

  const acc = new Map<string, Acc>();
  const get = (id: string) => {
    let e = acc.get(id);
    if (!e) {
      e = { searched: 0, found: 0, invoked: 0, succeeded: 0, topScores: [] };
      acc.set(id, e);
    }
    return e;
  };

  for (const s of sessions) {
    const searches = [...s.searches].sort((a, b) => a.ts - b.ts);
    for (let i = 0; i < searches.length; i++) {
      const sr = searches[i];
      const cid = clusterOf.get(`${sr.ts}|${sr.query}`);
      if (!cid) continue;
      const e = get(cid);
      e.searched++;

      const found = sr.hits.length > 0 || (sr.hitCount ?? 0) > 0;
      if (found) e.found++;

      const invoked = sr.invokedToolIds.length > 0;
      if (invoked) e.invoked++;

      const windowEnd = i + 1 < searches.length ? searches[i + 1].ts : Infinity;
      const succeeded = s.toolCalls.some(
        (c) =>
          c.status === "ok" &&
          c.startTs !== undefined &&
          c.startTs >= sr.ts &&
          c.startTs < windowEnd &&
          sr.hits.some((h) => h.toolId === c.toolId),
      );
      if (succeeded) e.succeeded++;

      const { topScoreNorm } = topAndMargin(sr.hits);
      if (topScoreNorm !== undefined) e.topScores.push(topScoreNorm);
    }
  }

  return [...acc.entries()].map(([clusterId, e]) => ({
    clusterId,
    label: labelOf.get(clusterId) ?? clusterId,
    searched: e.searched,
    found: e.found,
    invoked: e.invoked,
    succeeded: e.succeeded,
    foundRate: e.searched ? e.found / e.searched : 0,
    invokeRate: e.found ? e.invoked / e.found : 0,
    successRate: e.invoked ? e.succeeded / e.invoked : 0,
    medianTopScoreNorm: median(e.topScores),
  }));
}

/** Sessions that searched but never invoked anything → abandoned (mapped, not dropped). */
export function countAbandoned(sessions: Session[]): number {
  return sessions.filter((s) => s.searches.length > 0 && s.toolCalls.length === 0).length;
}
