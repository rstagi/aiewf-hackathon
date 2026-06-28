// ─────────────────────────────────────────────────────────────────────────────
// @sia/example — the system-under-test driver.
//
// A tiny synthetic-traffic agent that integrates ONLY the SDK. On each run it:
//   1. fetches the active AgentConfig from the Cloud JIT and PINS it for the whole run,
//   2. builds a REAL Ratel BM25 catalog from that snapshot (+ local stable skill identity),
//   3. replays paired scenarios: search → invoke the top hit IFF it clears the confidence
//      floor, else skip (this is what makes the underperforming intent LEAK),
//   4. drains the native trace buffer and fire-and-forget POSTs the envelopes back, tagged
//      with the EXACT configId it consumed + arm.
//
// The app's optimizable surface (skill descriptions) is never in this code — it comes from
// the Cloud. Rewrite a description in the Cloud and this same code retrieves differently.
// ─────────────────────────────────────────────────────────────────────────────

import { buildToolCatalog, emitTraces, fetchActiveConfig } from "@sia/sdk";
import { indexSkillDefs } from "@sia/engine";
import { SEED_SKILL_DEFS, SCENARIOS } from "@sia/seed";

const CLOUD_URL = process.env.CLOUD_URL ?? "http://localhost:3210";
const API_KEY = process.env.SIA_API_KEY; // Phase 2 inbound auth; unset in Phase 1.

// Confidence floor for invoking the top hit. CALIBRATED against the real native BM25 over
// the seed corpus: a strong single-intent match scores ~4.6–4.9, while the deliberately
// mediocre `account-recovery` description matches a reset-password query at only ~2.5.
// 3.5 sits cleanly between them (±1.0 margin) → healthy intents invoke, the leak skips.
const INVOKE_FLOOR = Number(process.env.INVOKE_FLOOR ?? "3.5");
const TOP_K = 5;

/** Deterministic per-scenario session id — the join key for trace attribution. */
function sessionIdFor(scenarioId: string): string {
  return `sess-${scenarioId}`;
}

async function main(): Promise<void> {
  console.log(`→ fetching active config from ${CLOUD_URL} …`);
  const config = await fetchActiveConfig({ cloudUrl: CLOUD_URL, apiKey: API_KEY });
  console.log(`✓ pinned config ${config.id} (${config.skills.length} skills, model=${config.modelDefault})\n`);

  // Stable skill identity is owned by the app (NON-optimizable); descriptions come from the
  // fetched config (the Cloud's optimizable surface).
  const defs = indexSkillDefs(SEED_SKILL_DEFS);

  // Canned executor — Phase 1 needs no LLM. The skill body just acknowledges; what matters
  // for the detector is the search + invoke trace, not the answer text.
  const executor = async (skillId: string) => `[${skillId}] handled your request.`;

  let totalSearches = 0;
  let totalInvokes = 0;
  let totalEmitted = 0;

  for (const sc of SCENARIOS) {
    const sessionId = sessionIdFor(sc.id);
    const catalog = buildToolCatalog(config, defs, executor, { sessionId });
    // Discard the registration churn so the emitted trace is just this run's search/invoke.
    catalog.drainTraceEvents();

    const hits = catalog.search(sc.utterance, TOP_K, "agent");
    totalSearches++;
    const top = hits[0];
    const willInvoke = !!top && top.score >= INVOKE_FLOOR;

    if (willInvoke) {
      await catalog.invoke(top.toolId, { utterance: sc.utterance });
      totalInvokes++;
    }

    const sent = await emitTraces(
      catalog,
      { configId: config.id, arm: "champion" },
      { cloudUrl: CLOUD_URL, apiKey: API_KEY },
    );
    totalEmitted += sent.length;

    const topStr = top ? `${top.toolId}@${top.score.toFixed(2)}` : "(no hits)";
    console.log(
      `${sc.id.padEnd(7)} "${sc.utterance}"\n` +
        `   intent=${sc.intent} top=${topStr} → ${willInvoke ? "INVOKE" : "skip (below floor)"}  [${sent.length} envelopes]`,
    );
  }

  console.log(
    `\n✓ run complete — ${SCENARIOS.length} scenarios, ${totalSearches} searches, ` +
      `${totalInvokes} invokes, ${totalEmitted} envelopes emitted to ${CLOUD_URL}.`,
  );
  console.log(`  configId on every envelope: ${config.id}`);
  console.log(`  ingested usage is at ${CLOUD_URL} (live backend + active config) and GET ${CLOUD_URL}/api/config/active.`);
}

main().catch((err) => {
  console.error("✗ example run failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
