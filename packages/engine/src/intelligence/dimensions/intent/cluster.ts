/**
 * Deterministic intent clusterer (Phase-0 baseline).
 *
 * Clusters search queries by token-set similarity (Jaccard) with a greedy single
 * pass — no embeddings, fully deterministic given input order. Intent clustering
 * bounds grid-row quality (RFC §9), so this is intentionally transparent and
 * swappable behind `IntentClusterer` for an embedding-backed version later.
 */

import type { SearchEvent } from "../../types";
import type { IntentClusterer, IntentClustering, IntentCluster, IntentAssignment } from "../types";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "by", "from",
  "is", "are", "be", "all", "get", "list", "read", "fetch", "find", "search", "show",
  "this", "that", "these", "those", "it", "its", "as", "at", "into", "out", "up",
  "how", "what", "where", "which", "can", "do", "does", "use", "using", "via", "my",
]);

export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

interface Bucket {
  id: string;
  tokens: Set<string>; // union of member tokens
  tokenFreq: Map<string, number>;
  queries: Map<string, number>; // query → count
  size: number;
}

export class DeterministicIntentClusterer implements IntentClusterer {
  constructor(private readonly threshold = 0.3) {}

  cluster(searches: SearchEvent[]): IntentClustering {
    const buckets: Bucket[] = [];
    const assignments: IntentAssignment[] = [];

    for (const s of searches) {
      const toks = new Set(tokenize(s.query));
      let best: Bucket | undefined;
      let bestSim = 0;
      for (const b of buckets) {
        const sim = jaccard(toks, b.tokens);
        if (sim > bestSim) {
          bestSim = sim;
          best = b;
        }
      }
      let bucket: Bucket;
      if (best && bestSim >= this.threshold) {
        bucket = best;
      } else {
        bucket = { id: `intent_${buckets.length + 1}`, tokens: new Set(), tokenFreq: new Map(), queries: new Map(), size: 0 };
        buckets.push(bucket);
      }
      for (const t of toks) {
        bucket.tokens.add(t);
        bucket.tokenFreq.set(t, (bucket.tokenFreq.get(t) ?? 0) + 1);
      }
      bucket.queries.set(s.query, (bucket.queries.get(s.query) ?? 0) + 1);
      bucket.size++;
      assignments.push({ ts: s.ts, query: s.query, clusterId: bucket.id });
    }

    const clusters: IntentCluster[] = buckets.map((b) => ({
      id: b.id,
      label: labelFor(b),
      queries: [...b.queries.keys()],
      size: b.size,
    }));

    return { clusters, assignments };
  }
}

/** Label = the up-to-3 most frequent content tokens, by frequency then alphabetically. */
function labelFor(b: Bucket): string {
  const top = [...b.tokenFreq.entries()]
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .slice(0, 3)
    .map(([t]) => t);
  return top.join(" ") || "(empty)";
}
