// ─────────────────────────────────────────────────────────────────────────────
// The example agent — a normal personal assistant on the Vercel AI SDK, now integrated
// with the SIA SDK (Phase 3). Each turn it:
//   1. pins the active AgentConfig for the session (fetched once; ../sia/catalog.ts),
//   2. builds the REAL Ratel BM25 catalog from that snapshot,
//   3. retrieves over the user's query — while the catalog is empty this is a zero-hit
//      search, still emitted so the Cloud can cluster the miss and GROW a skill; once SIA
//      has authored a skill that clears the floor, its playbook is injected into the system
//      prompt and an invoke is recorded (so the Cloud sees the intent is now covered),
//   4. runs the multi-step model loop over its own native tools to answer,
//   5. captures the canonical ContextFrame and fire-and-forget emits the turn's traces.
//
// The agent's optimizable surface (its skills) is never in this code — it comes from the
// Cloud. Author a skill in the Cloud and this same code retrieves and uses it, no redeploy.
// ─────────────────────────────────────────────────────────────────────────────
import "../sia/env"; // load repo-root .env.local (ANTHROPIC_API_KEY) before anything else
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { buildToolCatalog } from "@sia/sdk";
import { configForSession, INVOKE_FLOOR, LOCAL_SKILL_DEFS, TOP_K } from "../sia/catalog";
import {
  captureContextFrame,
  resolveSkillBody,
  type ContextFrame,
  type ToolCallRecord,
} from "../sia/context-frame";
import { emitUsage } from "../sia/usage";
import { TOOLS } from "./tools";

const MAX_STEPS = 6;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentTurnResult {
  answer: string;
  frame: ContextFrame;
}

const asText = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));

function newSessionId(): string {
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function runAgentTurn(opts: {
  messages: ChatMessage[];
  /**
   * Stable per-conversation id — the config pin key AND the trace attribution key. The UI and
   * the driver always pass one. If omitted (e.g. a one-off curl), a fresh id is minted per call,
   * so there is no cross-turn config pin — fine for single-turn use, not for a multi-turn chat.
   */
  sessionId?: string;
}): Promise<AgentTurnResult> {
  const sessionId = opts.sessionId ?? newSessionId();
  const config = await configForSession(sessionId);
  const userQuery = [...opts.messages].reverse().find((m) => m.role === "user")?.content ?? "";

  // Build the REAL native BM25 catalog from the pinned snapshot. Skills are Cloud-authored
  // (bodies on the snapshot); LOCAL_SKILL_DEFS is empty, so the snapshot supplies name/tags/body.
  // The skill executor only feeds the invoke trace — the model answers via its native tools
  // guided by the injected playbook, so the executor just acknowledges.
  const catalog = buildToolCatalog(
    config,
    LOCAL_SKILL_DEFS,
    async (skillId: string) => `[${skillId}] applied its playbook.`,
    { sessionId },
  );
  catalog.drainTraceEvents(); // discard registration churn so the emitted trace is just this turn

  // Retrieve over the query. Empty catalog ⇒ zero hits ⇒ a "missed" search the Cloud clusters.
  const hits = userQuery ? catalog.search(userQuery, TOP_K, "agent") : [];
  const top = hits[0];
  const useSkill = !!top && top.score >= INVOKE_FLOOR;

  // Inject the matched skill's playbook into the system prompt (the model sees it); record the
  // invoke so the Cloud sees this intent is now covered (and stops re-proposing it). The base
  // system prompt — not the augmented one — is stored on the frame; the body rides in
  // `invokedBodies`, keeping the inspector's two signals (prompt vs injected skills) distinct.
  let systemForModel = config.systemPrompt;
  const invokedSkillIds: string[] = [];
  if (useSkill) {
    const body = resolveSkillBody(config, LOCAL_SKILL_DEFS, top.toolId);
    // Only treat the skill as USED when its playbook actually resolves — otherwise the recorded
    // invoke would claim guidance the model never received (inject + invoke + record stay in lockstep).
    if (body) {
      systemForModel = `${config.systemPrompt}\n\n# Relevant skill — ${top.toolId}\n${body}`;
      await catalog.invoke(top.toolId, { utterance: userQuery });
      invokedSkillIds.push(top.toolId);
    }
  }

  // The turn's trace envelopes (the zero-hit search + any invoke) are now buffered. Drain + POST
  // them NOW — concurrently with the model call — because the gap signal the heal loop depends on
  // must reach the Cloud even if generateText throws (a model/rate-limit error is exactly when we
  // want the miss recorded). emitUsage drains synchronously here, so nothing the generation does
  // is lost (native tool calls go through the AI SDK, not the catalog); the POST then overlaps
  // generation. We await it in `finally` so a short-lived driver process can't exit before it lands.
  const emitted = emitUsage(catalog, config.id);

  try {
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const model = anthropic(config.modelDefault);
    const messages = opts.messages.map((m) => ({ role: m.role, content: m.content })) as ModelMessage[];

    const result = await generateText({
      model,
      system: systemForModel,
      messages,
      tools: TOOLS,
      stopWhen: stepCountIs(MAX_STEPS),
    });

    // Collect every native tool call across the multi-step loop for the inspector.
    const toolCalls: ToolCallRecord[] = [];
    for (const step of result.steps) {
      for (const tc of step.toolCalls) {
        const tr = step.toolResults.find((r) => r.toolCallId === tc.toolCallId);
        toolCalls.push({ toolId: tc.toolName, args: tc.input, result: tr ? asText(tr.output) : "" });
      }
    }

    const u = result.totalUsage;
    const frame = captureContextFrame({
      sessionId,
      configId: config.id,
      config,
      localDefs: LOCAL_SKILL_DEFS,
      model: config.modelDefault,
      systemPrompt: config.systemPrompt,
      userQuery,
      floor: INVOKE_FLOOR,
      hits,
      invokedSkillIds,
      toolCalls,
      answer: result.text,
      steps: result.steps.length,
      tokens: { input: u.inputTokens ?? 0, output: u.outputTokens ?? 0, total: u.totalTokens ?? 0 },
    });
    return { answer: result.text, frame };
  } finally {
    await emitted; // best-effort; emitUsage swallows its own errors and never throws into the turn
  }
}
