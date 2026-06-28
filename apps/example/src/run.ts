// ─────────────────────────────────────────────────────────────────────────────
// @sia/example — traffic driver (`pnpm --filter @sia/example replay`).
//
// Fires a batch of realistic, CLUSTERABLE assistant queries at the REAL agent
// (runAgentTurn) to seed usage on the Cloud — so the self-healing loop has something to
// learn from. Each query is its own session (its own pinned config + trace session). While
// the `example-assistant` catalog is empty every search is a zero-hit miss; the Cloud
// clusters those misses by intent and proposes brand-new skills.
//
// Three intents × a few near-duplicate phrasings each → three clean gap clusters:
//   • split-bill     (compose calculator + currency_convert)
//   • daily-briefing (compose current_datetime + get_calendar + get_weather)
//   • trip-day-plan  (compose web_search + get_weather + currency_convert + calculator)
//
// Point it at a throwaway project to verify without touching real data:
//   SIA_PROJECT=phase3-verify pnpm --filter @sia/example replay
// ─────────────────────────────────────────────────────────────────────────────

import "./sia/env"; // load repo-root .env.local (ANTHROPIC_API_KEY) before the agent runs
import { runAgentTurn } from "./agent/runtime";
import { CLOUD_URL, SIA_PROJECT } from "./sia/catalog";

interface DriveQuery {
  intent: string;
  utterance: string;
}

const QUERIES: DriveQuery[] = [
  { intent: "split-bill", utterance: "Split a $84 dinner bill between 4 of us with a 20% tip" },
  { intent: "split-bill", utterance: "Split a $120 dinner bill between 5 of us including the tip" },
  { intent: "split-bill", utterance: "Split our dinner bill 3 ways and add a 20% tip" },
  { intent: "daily-briefing", utterance: "Give me my daily briefing: today's schedule and the weather" },
  { intent: "daily-briefing", utterance: "What's my daily briefing — my meetings today and the weather" },
  { intent: "daily-briefing", utterance: "Daily briefing please: my calendar today plus the weather forecast" },
  { intent: "trip-day-plan", utterance: "Plan a day trip to Lisbon with the weather and a budget" },
  { intent: "trip-day-plan", utterance: "Plan my day trip to Lisbon — things to do, weather, and budget" },
  { intent: "trip-day-plan", utterance: "Help me plan a day trip to Porto with weather and budget" },
];

async function main(): Promise<void> {
  console.log(`→ driving ${QUERIES.length} queries at the example agent`);
  console.log(`  project=${SIA_PROJECT}  cloud=${CLOUD_URL}\n`);

  let ok = 0;
  for (const [i, q] of QUERIES.entries()) {
    const sessionId = `sess-drive-${i}`;
    try {
      const { frame } = await runAgentTurn({ messages: [{ role: "user", content: q.utterance }], sessionId });
      const top = frame.retrieved[0];
      const topStr = top ? `${top.skillId}@${top.score.toFixed(2)}` : "(no hits)";
      const skillStr = frame.invokedSkillIds.length ? `INVOKE ${frame.invokedSkillIds.join(",")}` : "no skill";
      const tools = (frame.toolCalls ?? []).map((t) => t.toolId).join(", ") || "—";
      console.log(`${String(i + 1).padStart(2)}. [${q.intent}] "${q.utterance}"`);
      console.log(`    retrieved=${topStr}  ${skillStr}  native-tools=[${tools}]  outcome=${frame.outcome}`);
      ok++;
    } catch (err) {
      console.error(`${String(i + 1).padStart(2)}. [${q.intent}] FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\n✓ drive complete — ${ok}/${QUERIES.length} turns, traces emitted to project "${SIA_PROJECT}".`);
  console.log(`\nNext — heal the catalog from this usage:`);
  console.log(`  1. curl -s -XPOST '${CLOUD_URL}/api/analyze?project=${SIA_PROJECT}' | jq '.proposals[] | {id, intentLabel, route}'`);
  console.log(`  2. curl -s -XPOST '${CLOUD_URL}/api/apply?project=${SIA_PROJECT}' -H 'content-type: application/json' -d '{"proposalId":"<id>"}' | jq`);
  console.log(`  3. start a NEW chat session (or re-run this) — the agent now retrieves the authored skill.`);
}

main().catch((err) => {
  console.error("✗ drive failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
