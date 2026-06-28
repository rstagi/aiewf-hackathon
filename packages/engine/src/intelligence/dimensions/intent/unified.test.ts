import { describe, expect, it } from "vitest";
import { clusterUnifiedIntents, type SourcedIntent } from "./unified";
import type { UnifiedClusterGroup, UnifiedIntentClusterer } from "../types";

/** A deterministic fake LLM clusterer: groups by a caller-supplied text→label map. */
function fakeClusterer(labelOf: (text: string) => string): UnifiedIntentClusterer {
  return {
    async cluster(texts: string[]): Promise<UnifiedClusterGroup[]> {
      const byLabel = new Map<string, string[]>();
      for (const t of texts) {
        const label = labelOf(t);
        const arr = byLabel.get(label) ?? [];
        arr.push(t);
        byLabel.set(label, arr);
      }
      return [...byLabel.entries()].map(([label, members]) => ({ label, members }));
    },
  };
}

const si = (text: string, source: SourcedIntent["source"], sessionId: string): SourcedIntent => ({
  text,
  source,
  sessionId,
});

describe("clusterUnifiedIntents", () => {
  it("merges semantically-similar intents from BOTH substrates into one cluster", async () => {
    const intents: SourcedIntent[] = [
      si("list all Linear projects", "search", "trace-1"),
      si("show me the linear projects", "transcript", "chat-1"),
      si("deploy to prod", "search", "trace-2"),
    ];
    const clusterer = fakeClusterer((t) =>
      t.toLowerCase().includes("linear") ? "Linear projects" : "Deploy",
    );

    const report = await clusterUnifiedIntents(intents, clusterer);

    const linear = report.clusters.find((c) => c.label === "Linear projects")!;
    expect(linear).toBeDefined();
    expect(linear.searchCount).toBe(1);
    expect(linear.transcriptCount).toBe(1);
    expect(linear.sessionIds).toEqual(["chat-1", "trace-1"]);
    expect(linear.members).toContain("list all Linear projects");
    expect(linear.members).toContain("show me the linear projects");
  });

  it("computes session share over distinct sessions with ANY intent and marks <20% as tbc", async () => {
    // 10 distinct sessions: 8 share intent A, 2 have a long-tail intent B.
    const intents: SourcedIntent[] = [];
    for (let i = 0; i < 8; i++) intents.push(si("common intent", "search", `s${i}`));
    intents.push(si("rare intent", "transcript", "s8"));
    intents.push(si("rare intent", "transcript", "s9"));

    const clusterer = fakeClusterer((t) => (t === "common intent" ? "Common" : "Rare"));
    const report = await clusterUnifiedIntents(intents, clusterer);

    expect(report.totalSessionsWithAnyIntent).toBe(10);
    const common = report.clusters.find((c) => c.label === "Common")!;
    const rare = report.clusters.find((c) => c.label === "Rare")!;
    expect(common.sessionShare).toBeCloseTo(0.8);
    expect(common.tbc).toBe(false);
    expect(rare.sessionShare).toBeCloseTo(0.2);
    // 0.2 is the boundary; threshold is strict "< 0.20" so exactly 0.2 is NOT tbc
    expect(rare.tbc).toBe(false);
  });

  it("marks a strictly-below-threshold cluster as tbc", async () => {
    const intents: SourcedIntent[] = [];
    for (let i = 0; i < 9; i++) intents.push(si("common", "search", `s${i}`));
    intents.push(si("rare", "transcript", "s9")); // 1/10 = 0.1 < 0.2
    const clusterer = fakeClusterer((t) => t);
    const report = await clusterUnifiedIntents(intents, clusterer);
    expect(report.clusters.find((c) => c.label === "rare")!.tbc).toBe(true);
  });

  it("counts distinct sessions, not raw occurrences, for share", async () => {
    // Same session contributes the same cluster twice → counts once.
    const intents: SourcedIntent[] = [
      si("a", "search", "s0"),
      si("a again", "transcript", "s0"),
      si("b", "search", "s1"),
    ];
    const clusterer = fakeClusterer((t) => (t.startsWith("a") ? "A" : "B"));
    const report = await clusterUnifiedIntents(intents, clusterer);
    expect(report.totalSessionsWithAnyIntent).toBe(2);
    const a = report.clusters.find((c) => c.label === "A")!;
    expect(a.sessionIds).toEqual(["s0"]);
    expect(a.sessionShare).toBeCloseTo(0.5);
    expect(a.searchCount).toBe(1);
    expect(a.transcriptCount).toBe(1);
  });

  it("dedupes input texts case/whitespace-insensitively before clustering", async () => {
    const seen: string[][] = [];
    const clusterer: UnifiedIntentClusterer = {
      async cluster(texts) {
        seen.push(texts);
        return [{ label: "All", members: texts }];
      },
    };
    await clusterUnifiedIntents(
      [
        si("List  Linear Projects", "search", "s0"),
        si("list linear projects", "transcript", "s1"),
      ],
      clusterer,
    );
    expect(seen[0]).toHaveLength(1); // one distinct text passed to the LLM
  });

  it("ranks clusters by session share descending, then label", async () => {
    const intents: SourcedIntent[] = [
      si("x", "search", "s0"),
      si("y", "search", "s0"),
      si("y", "search", "s1"),
    ];
    const clusterer = fakeClusterer((t) => t.toUpperCase());
    const report = await clusterUnifiedIntents(intents, clusterer);
    expect(report.clusters.map((c) => c.label)).toEqual(["Y", "X"]);
  });

  it("returns an empty report without dividing by zero", async () => {
    const report = await clusterUnifiedIntents([], fakeClusterer(() => "x"));
    expect(report.totalSessionsWithAnyIntent).toBe(0);
    expect(report.clusters).toEqual([]);
  });

  it("ignores blank intent texts", async () => {
    const report = await clusterUnifiedIntents(
      [si("  ", "search", "s0"), si("real", "transcript", "s1")],
      fakeClusterer((t) => t),
    );
    expect(report.totalSessionsWithAnyIntent).toBe(1);
    expect(report.clusters).toHaveLength(1);
    expect(report.clusters[0].members).toEqual(["real"]);
  });

  it("tolerates a clusterer that returns unknown members without crashing", async () => {
    const clusterer: UnifiedIntentClusterer = {
      async cluster() {
        return [{ label: "Hallucinated", members: ["never in the input"] }];
      },
    };
    const report = await clusterUnifiedIntents([si("real", "search", "s0")], clusterer);
    // The hallucinated member maps to no sourced intent → cluster carries zero sessions.
    const c = report.clusters.find((x) => x.label === "Hallucinated");
    if (c) {
      expect(c.sessionIds).toEqual([]);
      expect(c.searchCount).toBe(0);
    }
    expect(report.totalSessionsWithAnyIntent).toBe(1);
  });
});
