import { describe, it, expect } from "vitest";
import { DeterministicIntentClusterer, tokenize } from "./cluster";
import type { SearchEvent } from "../../types";

function search(query: string, ts: number): SearchEvent {
  return { query, origin: "agent", hits: [], ts, invokedToolIds: [], foundNotInvoked: [] };
}

describe("tokenize", () => {
  it("drops stopwords, short tokens, and lowercases", () => {
    expect(tokenize("read and update Notion pages")).toEqual(["update", "notion", "pages"]);
    expect(tokenize("list all Linear projects")).toEqual(["linear", "projects"]);
  });
});

describe("DeterministicIntentClusterer", () => {
  const clusterer = new DeterministicIntentClusterer(0.3);

  it("groups token-similar queries and separates dissimilar ones", () => {
    const { clusters, assignments } = clusterer.cluster([
      search("read and update Notion pages", 1),
      search("notion search pages", 2),
      search("Granola meeting notes transcript", 3),
    ]);
    expect(clusters).toHaveLength(2);
    // The two notion queries land in the same cluster; granola in its own.
    const byTs = new Map(assignments.map((a) => [a.ts, a.clusterId]));
    expect(byTs.get(1)).toBe(byTs.get(2));
    expect(byTs.get(3)).not.toBe(byTs.get(1));
  });

  it("labels a cluster by its dominant content tokens", () => {
    const { clusters } = clusterer.cluster([
      search("read and update Notion pages", 1),
      search("notion search pages", 2),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].label).toContain("notion");
    expect(clusters[0].label).toContain("pages");
    expect(clusters[0].size).toBe(2);
  });

  it("is deterministic for the same input", () => {
    const input = [search("query rows of a notion database", 1), search("notion database query sql", 2)];
    const a = clusterer.cluster(input);
    const b = clusterer.cluster(input);
    expect(a).toEqual(b);
  });

  it("assigns every search exactly once", () => {
    const input = [search("a notion page", 1), search("b granola meeting", 2), search("c linear issue", 3)];
    const { assignments } = clusterer.cluster(input);
    expect(assignments).toHaveLength(3);
  });
});
