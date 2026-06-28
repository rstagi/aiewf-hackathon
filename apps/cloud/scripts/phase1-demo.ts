// ─────────────────────────────────────────────────────────────────────────────
// Phase-1 demo — the WHOLE self-healing loop, driven by Cloud HTTP calls.
//
// Seed a catalog (with the planted weak skill + the true gap) → drive the REAL BM25 catalog
// over synthetic traffic → POST the usage → analyze → see TWO proposals (improve-existing +
// create-new) → apply them → GET the active catalog and prove the improved description AND the
// brand-new skill (with its body) are live → re-drive the misses and prove they now clear the
// retrieval floor. The magic, proven end to end.
//
// Generalizes the golden test's driveRun() (apps/example/src/run.ts shape). Requires the Cloud
// running on SIA_CLOUD_URL (default http://localhost:3210).
// ─────────────────────────────────────────────────────────────────────────────
import { buildToolCatalog, enrichEnvelopes } from "@sia/sdk";
import { indexSkillDefs } from "@sia/engine";
import {
  SEED_CONFIG_DRAFT,
  SEED_SKILL_DEFS,
  DEMO_SCENARIOS,
  GAP_SCENARIOS,
  SCENARIOS,
  LEAK_SKILL_ID,
  type Scenario,
} from "@sia/seed";
import type { AgentConfig, ExtendedTraceEnvelope, Proposal } from "@sia/contract";

const BASE = process.env.SIA_CLOUD_URL ?? "http://localhost:3210";
const INVOKE_FLOOR = 3.5;
const defs = indexSkillDefs(SEED_SKILL_DEFS);

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`   ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
}
function section(title: string) {
  console.log(`\n${"─".repeat(78)}\n${title}\n${"─".repeat(78)}`);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = (await res.json()) as T & { ok: boolean; error?: string };
  if (!json.ok) throw new Error(`${path} → ${res.status} ${json.error ?? "request failed"}`);
  return json;
}

const fetchActive = async () => (await api<{ config: AgentConfig }>("/api/config/active")).config;

/** Drive the real native BM25 catalog over scenarios; returns the enriched envelopes + a verdict log. */
function drive(config: AgentConfig, scenarios: readonly Scenario[]) {
  const exec = async (id: string) =>
    `[${id}] ${config.skills.find((s) => s.skillId === id)?.instructions ? "ran authored body" : "ran"}`;
  const envelopes: ExtendedTraceEnvelope[] = [];
  const verdicts: { scenario: Scenario; top?: string; score: number; invoked: boolean }[] = [];
  for (const sc of scenarios) {
    const catalog = buildToolCatalog(config, defs, exec, { sessionId: `sess-${sc.id}` });
    catalog.drainTraceEvents(); // discard registration churn
    const hits = catalog.search(sc.utterance, 5, "agent");
    const top = hits[0];
    const invoked = !!top && top.score >= INVOKE_FLOOR;
    if (invoked) void catalog.invoke(top.toolId, { utterance: sc.utterance });
    envelopes.push(...enrichEnvelopes(catalog.drainTraceEvents(), { configId: config.id, arm: "champion" }));
    verdicts.push({ scenario: sc, top: top?.toolId, score: top?.score ?? 0, invoked });
  }
  return { envelopes, verdicts };
}

function printVerdicts(verdicts: ReturnType<typeof drive>["verdicts"]) {
  for (const v of verdicts) {
    console.log(
      `   [${v.scenario.intent.padEnd(18)}] "${v.scenario.utterance}"\n` +
        `        ${v.top ? `${v.top}:${v.score.toFixed(2)}` : "(no hits)"} → ${v.invoked ? "INVOKE" : "miss"}`,
    );
  }
}

async function main() {
  section("1 · Seed the catalog (genesis customer-support corpus)");
  const seeded = await api<{ config: AgentConfig }>("/api/catalog", {
    method: "POST",
    body: JSON.stringify({ draft: SEED_CONFIG_DRAFT }),
  });
  const before = seeded.config;
  console.log(`   active config = ${before.id}  (${before.skills.length} skills)`);
  check("genesis is the customer-support corpus (cfg_abd14cd40fc3)", before.id === "cfg_abd14cd40fc3");

  section("2 · Drive synthetic usage through the REAL BM25 catalog (the 'before')");
  const { envelopes, verdicts } = drive(before, DEMO_SCENARIOS);
  printVerdicts(verdicts);
  const leakMissed = verdicts.filter((v) => v.scenario.goldSkillId === LEAK_SKILL_ID).every((v) => !v.invoked);
  const gapMissed = verdicts.filter((v) => v.scenario.intent === "talk to a human").every((v) => !v.invoked);
  check("the planted weak skill (account-recovery) is missed", leakMissed);
  check("the true gap (talk to a human) is missed", gapMissed);

  section("3 · Report usage to the Cloud");
  const posted = await api<{ received: number }>("/api/traces", {
    method: "POST",
    body: JSON.stringify({ envelopes }),
  });
  console.log(`   POST /api/traces → received ${posted.received} envelopes`);

  section("4 · Analyze → cluster the misses → route → author the fixes");
  const analyzed = await api<{ proposals: Proposal[] }>("/api/analyze", { method: "POST" });
  for (const p of analyzed.proposals) {
    console.log(`   • [${p.route}] "${p.intentLabel}" (${p.queries.length} queries)`);
    console.log(`        ${p.rationale}`);
    if (p.change?.kind === "rewrite_skill_desc") console.log(`        → rewrite ${p.change.skillId}: "${p.change.to}"`);
    if (p.change?.kind === "add_skill") console.log(`        → create ${p.change.skillId} ("${p.change.name}")`);
  }

  section("5 · List proposals — expect two (improve-existing + create-new)");
  const { proposals } = await api<{ proposals: Proposal[] }>("/api/proposals");
  const improve = proposals.find((p) => p.route === "improve-existing");
  const create = proposals.find((p) => p.route === "create-new");
  check("a create-new proposal exists", !!create);
  check("an improve-existing proposal exists", !!improve);
  check("improve-existing targets account-recovery", improve?.change?.kind === "rewrite_skill_desc" && improve.change.skillId === LEAK_SKILL_ID);

  section("6 · Apply both proposals (mint new versions + flip the pointer)");
  for (const p of [improve, create]) {
    if (!p) continue;
    const applied = await api<{ config: AgentConfig }>("/api/apply", {
      method: "POST",
      body: JSON.stringify({ proposalId: p.id }),
    });
    console.log(`   applied ${p.route} → new active ${applied.config.id}`);
  }

  section("7 · GET the active catalog — prove the fixes are live");
  const after = await fetchActive();
  const beforeIds = new Set(before.skills.map((s) => s.skillId));
  const newSkill = after.skills.find((s) => !beforeIds.has(s.skillId));
  const leakAfter = after.skills.find((s) => s.skillId === LEAK_SKILL_ID);
  const leakBefore = before.skills.find((s) => s.skillId === LEAK_SKILL_ID);
  console.log(`   active config = ${after.id}  (${after.skills.length} skills, was ${before.skills.length})`);
  if (newSkill) console.log(`   new skill '${newSkill.skillId}': ${newSkill.instructions ? "carries its own body ✓" : "NO BODY"}`);
  if (leakAfter) console.log(`   account-recovery description: "${leakAfter.description}"`);
  check("a brand-new skill is now in the catalog", !!newSkill);
  check("the new skill carries its own instructions (body) — executable, no redeploy", !!newSkill?.instructions);
  check("account-recovery's description was improved", !!leakAfter && leakAfter.description !== leakBefore?.description);

  section("8 · Re-drive the misses against the healed catalog — they now clear the floor");
  const reLeak = drive(after, SCENARIOS.filter((s) => s.goldSkillId === LEAK_SKILL_ID));
  const reGap = drive(after, GAP_SCENARIOS);
  printVerdicts(reLeak.verdicts);
  printVerdicts(reGap.verdicts);
  check("password-reset queries now invoke account-recovery", reLeak.verdicts.every((v) => v.invoked && v.top === LEAK_SKILL_ID));
  check("talk-to-a-human queries now invoke the new skill", reGap.verdicts.every((v) => v.invoked && v.top === newSkill?.skillId));

  section(failures === 0 ? "✅ PHASE 1 DEMO PASSED — the catalog healed itself, no redeploy" : `❌ ${failures} CHECK(S) FAILED`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error("\n❌ demo error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
