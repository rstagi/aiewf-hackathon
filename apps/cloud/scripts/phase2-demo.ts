// ─────────────────────────────────────────────────────────────────────────────
// Phase-2 demo — the SAME self-healing loop as Phase 1, now driven through @sia/sdk.
//
// What changed vs phase1-demo.ts (proves API parity + the SDK's added value):
//   • fetchActiveConfig(opts)  replaces the raw GET /api/config/active
//   • emitTraces(catalog, …)   replaces the raw POST /api/traces (per-session, fire-and-forget)
//   • captureContextFrame(…)   records the assembled context per query — retrieved skills +
//                              scores + which cleared the floor + the invoked skill BODY + outcome
//   • the executor RESOLVES the body (resolveSkillBody, Cloud-first) and runs it, so a brand-new
//                              Cloud-authored skill executes its snapshot body with no redeploy
// The admin surface (/api/analyze, /api/proposals, /api/apply) stays raw HTTP — the SDK
// convenience layer is over report-usage + fetch-catalog, not the operator endpoints.
//
// Requires the Cloud running on SIA_CLOUD_URL (default http://localhost:3210).
// ─────────────────────────────────────────────────────────────────────────────
import {
  buildToolCatalog,
  captureContextFrame,
  emitTraces,
  fetchActiveConfig,
  modelForSkill,
  resolveSkillBody,
  type ContextFrame,
} from "@sia/sdk";
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
import type { AgentConfig, Proposal } from "@sia/contract";

const BASE = process.env.SIA_CLOUD_URL ?? "http://localhost:3210";
// The Cloud is multi-project; this demo drives ONE project (default: the seeded demo corpus).
// Set SIA_PROJECT to run the whole loop against an isolated project (handy for verification).
const PROJECT = process.env.SIA_PROJECT ?? "demo-support";
const INVOKE_FLOOR = 3.5;
const defs = indexSkillDefs(SEED_SKILL_DEFS);
// The SDK carries the project (x-sia-project) so fetchActiveConfig + emitTraces hit the SAME
// namespace as the raw admin calls below — no straddling.
const opts = { cloudUrl: BASE, apiKey: process.env.SIA_API_KEY, project: PROJECT };

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`   ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
}
function section(title: string) {
  console.log(`\n${"─".repeat(78)}\n${title}\n${"─".repeat(78)}`);
}

/** Raw HTTP for the admin surface (seed / analyze / proposals / apply) — project-scoped. */
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(PROJECT)}`;
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = (await res.json()) as T & { ok: boolean; error?: string };
  if (!json.ok) throw new Error(`${path} → ${res.status} ${json.error ?? "request failed"}`);
  return json;
}

interface Verdict {
  scenario: Scenario;
  top?: string;
  score: number;
  invoked: boolean;
}

/**
 * Drive the real native BM25 catalog over scenarios THROUGH THE SDK: build the catalog,
 * search, invoke the top hit if it clears the floor (executing its resolved body), capture
 * a ContextFrame per query, and — when `emit` — report usage via emitTraces (one POST per
 * session). Returns the frames + verdicts (+ how many envelopes were emitted).
 *
 * `emit` is false for the step-8 re-drive: phase1 reads only the verdicts there and never
 * POSTs healed traffic, so emitting it would pollute the append-only usage log.
 */
async function drive(config: AgentConfig, scenarios: readonly Scenario[], { emit }: { emit: boolean }) {
  // The executor resolves the body Cloud-first and "runs" it — so a brand-new authored skill
  // (no local def) executes its snapshot body, not just gets retrieved.
  const exec = async (id: string) => {
    const body = resolveSkillBody(config, defs, id);
    return body ? `[${id}] ran authored playbook (${body.length} chars)` : `[${id}] ran (no body)`;
  };
  const frames: ContextFrame[] = [];
  const verdicts: Verdict[] = [];
  let emitted = 0;
  for (const sc of scenarios) {
    const catalog = buildToolCatalog(config, defs, exec, { sessionId: `sess-${sc.id}` });
    catalog.drainTraceEvents(); // discard registration churn
    const hits = catalog.search(sc.utterance, 5, "agent");
    const top = hits[0];
    const invoked = !!top && top.score >= INVOKE_FLOOR;
    const answer = invoked ? String(await catalog.invoke(top!.toolId, { utterance: sc.utterance })) : undefined;
    frames.push(
      captureContextFrame({
        sessionId: `sess-${sc.id}`,
        configId: config.id,
        model: modelForSkill(config, top?.toolId ?? ""),
        systemPrompt: config.systemPrompt,
        userQuery: sc.utterance,
        floor: INVOKE_FLOOR,
        hits,
        invokedSkillIds: invoked ? [top!.toolId] : [],
        config,
        localDefs: defs,
        answer,
      }),
    );
    // emit AFTER capture: emitTraces drains the buffer; capture read `hits` from the search return.
    if (emit) emitted += (await emitTraces(catalog, { configId: config.id, arm: "champion" }, opts)).length;
    verdicts.push({ scenario: sc, top: top?.toolId, score: top?.score ?? 0, invoked });
  }
  return { frames, verdicts, emitted };
}

function printVerdicts(verdicts: Verdict[]) {
  for (const v of verdicts) {
    console.log(
      `   [${v.scenario.intent.padEnd(18)}] "${v.scenario.utterance}"\n` +
        `        ${v.top ? `${v.top}:${v.score.toFixed(2)}` : "(no hits)"} → ${v.invoked ? "INVOKE" : "miss"}`,
    );
  }
}

/** Render a captured ContextFrame — the SDK's headline (what context the agent assembled). */
function printFrame(frame: ContextFrame | undefined, label: string) {
  if (!frame) return;
  const top3 = frame.retrieved
    .slice(0, 3)
    .map((r) => `${r.skillId}:${r.score.toFixed(2)}${r.clearedFloor ? "✓" : "✗"}`)
    .join("  ");
  console.log(`   ┌ ${label}  ·  ${frame.sessionId}  ·  [${frame.outcome}]  floor=${frame.floor}`);
  console.log(`   │ query    : "${frame.userQuery}"`);
  console.log(`   │ retrieved: ${top3 || "(no hits)"}`);
  console.log(`   │ invoked  : ${frame.invokedSkillIds.length ? frame.invokedSkillIds.join(", ") : "(none)"}`);
  if (frame.invokedBodies) {
    for (const [id, body] of Object.entries(frame.invokedBodies)) {
      console.log(`   │   body[${id}]: "${body.slice(0, 68)}${body.length > 68 ? "…" : ""}"`);
    }
  }
  console.log(`   └`);
}

const frameFor = (frames: ContextFrame[], scenarioId: string) =>
  frames.find((f) => f.sessionId === `sess-${scenarioId}`);

async function main() {
  section("1 · Seed the catalog (genesis customer-support corpus)");
  const seeded = await api<{ config: AgentConfig }>("/api/catalog", {
    method: "POST",
    body: JSON.stringify({ draft: SEED_CONFIG_DRAFT }),
  });
  const before = seeded.config;
  console.log(`   active config = ${before.id}  (${before.skills.length} skills)`);
  check("genesis is the customer-support corpus (cfg_abd14cd40fc3)", before.id === "cfg_abd14cd40fc3");

  section("2 · Drive usage through the SDK + capture context frames (the 'before')");
  const { frames, verdicts, emitted } = await drive(before, DEMO_SCENARIOS, { emit: true });
  printVerdicts(verdicts);
  console.log("\n   context frames (the SDK's capture):");
  printFrame(frameFor(frames, "acct-1"), "LEAK exemplar (password reset)");
  printFrame(frameFor(frames, "human-1"), "GAP exemplar (talk to a human)");
  const leakMissed = verdicts.filter((v) => v.scenario.goldSkillId === LEAK_SKILL_ID).every((v) => !v.invoked);
  const gapMissed = verdicts.filter((v) => v.scenario.intent === "talk to a human").every((v) => !v.invoked);
  check("the planted weak skill (account-recovery) is missed", leakMissed);
  check("the true gap (talk to a human) is missed", gapMissed);
  check("the leak frame's outcome is 'missed' (nothing cleared the floor)", frameFor(frames, "acct-1")?.outcome === "missed");
  check("the gap frame's outcome is 'missed'", frameFor(frames, "human-1")?.outcome === "missed");

  section("3 · Usage reported to the Cloud via @sia/sdk emitTraces");
  console.log(`   emitted ${emitted} envelopes across ${DEMO_SCENARIOS.length} sessions (fire-and-forget POST /api/traces)`);
  check("usage was emitted through the SDK client", emitted > 0);

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
  check(
    "improve-existing targets account-recovery",
    improve?.change?.kind === "rewrite_skill_desc" && improve.change.skillId === LEAK_SKILL_ID,
  );

  section("6 · Apply both proposals (mint new versions + flip the pointer)");
  for (const p of [improve, create]) {
    if (!p) continue;
    const applied = await api<{ config: AgentConfig }>("/api/apply", {
      method: "POST",
      body: JSON.stringify({ proposalId: p.id }),
    });
    console.log(`   applied ${p.route} → new active ${applied.config.id}`);
  }

  section("7 · Fetch the active catalog via the SDK — prove the fixes are live");
  const after = await fetchActiveConfig(opts);
  const beforeIds = new Set(before.skills.map((s) => s.skillId));
  const newSkill = after.skills.find((s) => !beforeIds.has(s.skillId));
  const leakAfter = after.skills.find((s) => s.skillId === LEAK_SKILL_ID);
  const leakBefore = before.skills.find((s) => s.skillId === LEAK_SKILL_ID);
  console.log(`   active config = ${after.id}  (${after.skills.length} skills, was ${before.skills.length})`);
  if (newSkill) console.log(`   new skill '${newSkill.skillId}': ${newSkill.instructions ? "carries its own body ✓" : "NO BODY"}`);
  if (leakAfter) console.log(`   account-recovery description: "${leakAfter.description}"`);
  check("a brand-new skill is now in the catalog", !!newSkill);
  check("the new skill carries its own instructions (body)", !!newSkill?.instructions);
  check("account-recovery's description was improved", !!leakAfter && leakAfter.description !== leakBefore?.description);

  // Phase-2 headline: skill-body resolution from BOTH sources, via the SDK.
  const leakBody = resolveSkillBody(after, defs, LEAK_SKILL_ID);
  const newBody = newSkill ? resolveSkillBody(after, defs, newSkill.skillId) : undefined;
  const localLeakBody = SEED_SKILL_DEFS.find((d) => d.skillId === LEAK_SKILL_ID)!.instructions;
  check(
    "resolveSkillBody(account-recovery) returns the LOCAL def body (snapshot has no body)",
    leakBody === localLeakBody,
  );
  check(
    "resolveSkillBody(new skill) returns the CLOUD-authored snapshot body (no local def)",
    !!newSkill && newBody === newSkill.instructions,
  );

  section("8 · Re-drive the misses against the healed catalog — they now clear the floor");
  const reLeak = await drive(after, SCENARIOS.filter((s) => s.goldSkillId === LEAK_SKILL_ID), { emit: false });
  const reGap = await drive(after, GAP_SCENARIOS, { emit: false });
  printVerdicts(reLeak.verdicts);
  printVerdicts(reGap.verdicts);
  console.log("\n   healed context frames:");
  printFrame(frameFor(reLeak.frames, "acct-1"), "LEAK exemplar (healed)");
  printFrame(frameFor(reGap.frames, "human-1"), "GAP exemplar (healed)");
  check("password-reset queries now invoke account-recovery", reLeak.verdicts.every((v) => v.invoked && v.top === LEAK_SKILL_ID));
  check("talk-to-a-human queries now invoke the new skill", reGap.verdicts.every((v) => v.invoked && v.top === newSkill?.skillId));
  check("the healed gap frame ran the Cloud-authored body", !!frameFor(reGap.frames, "human-1")?.invokedBodies);

  section(failures === 0 ? "✅ PHASE 2 DEMO PASSED — same loop, now through the SDK, with context capture" : `❌ ${failures} CHECK(S) FAILED`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error("\n❌ demo error:", e instanceof Error ? e.message : e);
  process.exit(1);
});
