// ─────────────────────────────────────────────────────────────────────────────
// GOLDEN TEST (PLAN risk #1 — the SDK↔Cloud attribution seam).
//
// The SDK emits trace envelopes; the engine ingests them. They share ONE definition
// (@sia/contract) but the envelope shape is really owned by the Rust core, so the only
// way to know emit can't silently diverge from ingest is to drive the REAL native
// catalog, drain what it produced, and prove:
//   1. every drained+enriched envelope round-trips through the engine's `parseLine`,
//   2. its wire fields are a subset of the shape in the recorded `__fixtures__/ratel`
//      telemetry (catches casing drift like tool_id → toolId on the trace),
//   3. the additive camelCase attribution (configId/arm) survives ingest untouched,
//   4. `buildSessions` reconstructs the run (leak = search-no-invoke, healthy = invoked).
// If any of these break, paired-A/B attribution would break SILENTLY in production.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { buildToolCatalog, enrichEnvelopes } from "./index";
import { parseLine } from "@sia/contract";
import { freezeConfig, indexSkillDefs, buildSessions } from "@sia/engine";
import { loadFixture } from "@sia/engine/intelligence/__fixtures__/load";
import { SEED_CONFIG_DRAFT, SEED_SKILL_DEFS, SCENARIOS } from "@sia/seed";
import type { ExtendedTraceEnvelope } from "@sia/contract";

const INVOKE_FLOOR = 3.5;
const ATTRIBUTION_KEYS = new Set(["configId", "arm", "experimentId"]);

/** Drive the real native catalog over the seed corpus, exactly like the example driver. */
async function driveRun() {
  const config = freezeConfig(SEED_CONFIG_DRAFT);
  const defs = indexSkillDefs(SEED_SKILL_DEFS);
  const exec = async (id: string) => `[${id}] ok`;
  const envelopes: ExtendedTraceEnvelope[] = [];
  for (const sc of SCENARIOS) {
    const catalog = buildToolCatalog(config, defs, exec, { sessionId: `sess-${sc.id}` });
    catalog.drainTraceEvents(); // discard registration churn
    const hits = catalog.search(sc.utterance, 5, "agent");
    const top = hits[0];
    if (top && top.score >= INVOKE_FLOOR) await catalog.invoke(top.toolId, { utterance: sc.utterance });
    envelopes.push(...enrichEnvelopes(catalog.drainTraceEvents(), { configId: config.id, arm: "champion" }));
  }
  return { config, envelopes };
}

/** type → set of wire keys observed in the recorded golden telemetry. */
function fixtureKeysByType(): Map<string, Set<string>> {
  const byType = new Map<string, Set<string>>();
  for (const name of ["skill-and-success.jsonl", "auth-flow-chain.jsonl", "error-chain.jsonl"]) {
    for (const line of loadFixture(name).split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const t = obj.type as string;
      const set = byType.get(t) ?? new Set<string>();
      for (const k of Object.keys(obj)) set.add(k);
      byType.set(t, set);
    }
  }
  return byType;
}

describe("golden: SDK emit shape == engine ingest shape", () => {
  it("emits a non-empty trace with both search and invoke events", async () => {
    const { envelopes } = await driveRun();
    expect(envelopes.length).toBeGreaterThan(0);
    expect(envelopes.some((e) => e.type === "search")).toBe(true);
    expect(envelopes.some((e) => e.type === "invoke_start")).toBe(true);
    expect(envelopes.some((e) => e.type === "invoke_end")).toBe(true);
  });

  it("every emitted envelope round-trips through engine parseLine (emit ⊆ ingest)", async () => {
    const { envelopes } = await driveRun();
    for (const env of envelopes) {
      const reparsed = parseLine(JSON.stringify(env));
      expect(reparsed, `parseLine rejected an emitted ${env.type} envelope`).not.toBeNull();
    }
  });

  it("emitted wire fields are a subset of the recorded golden telemetry shape", async () => {
    const { envelopes } = await driveRun();
    const golden = fixtureKeysByType();
    for (const env of envelopes) {
      const goldenKeys = golden.get(env.type);
      expect(goldenKeys, `no golden fixture covers emitted type ${env.type}`).toBeDefined();
      const wireKeys = Object.keys(env).filter((k) => !ATTRIBUTION_KEYS.has(k));
      for (const k of wireKeys) {
        expect(goldenKeys!.has(k), `emitted ${env.type} has field "${k}" absent from golden telemetry`).toBe(true);
      }
    }
  });

  it("search hits use snake_case tool_id on the wire (the casing split)", async () => {
    const { envelopes } = await driveRun();
    const search = envelopes.find((e) => e.type === "search");
    expect(search).toBeDefined();
    const hits = (search as Extract<ExtendedTraceEnvelope, { type: "search" }>).hits;
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toHaveProperty("tool_id");
    expect(hits[0]).not.toHaveProperty("toolId");
  });

  it("camelCase attribution (configId/arm) is stamped and survives ingest", async () => {
    const { config, envelopes } = await driveRun();
    for (const env of envelopes) {
      expect(env.configId).toBe(config.id);
      expect(env.arm).toBe("champion");
      const reparsed = parseLine(JSON.stringify(env)) as ExtendedTraceEnvelope;
      expect(reparsed.configId).toBe(config.id);
      expect(reparsed.arm).toBe("champion");
    }
  });

  it("buildSessions reconstructs the run: leak searched-not-invoked, healthy invoked", async () => {
    const { envelopes } = await driveRun();
    const sessions = buildSessions(envelopes);
    expect(sessions.length).toBe(SCENARIOS.length);

    const leak = sessions.find((s) => s.sessionId === "sess-acct-1")!;
    expect(leak.searches.length).toBeGreaterThan(0);
    expect(leak.toolCalls.length).toBe(0); // below floor → never invoked → the leak

    const healthy = sessions.find((s) => s.sessionId === "sess-doc-1")!;
    expect(healthy.searches.length).toBeGreaterThan(0);
    expect(healthy.toolCalls.length).toBeGreaterThan(0);
  });
});
