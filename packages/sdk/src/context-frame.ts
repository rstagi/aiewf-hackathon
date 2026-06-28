// ─────────────────────────────────────────────────────────────────────────────
// Context-frame capture — the SDK's unique value (PLAN Phase 2).
//
// A `ContextFrame` is the host-side record of the *assembled context* for ONE
// query/turn: the system prompt, the skills BM25 retrieved (+ scores + which cleared
// the invoke floor), the bodies of the skills the agent invoked, and the outcome.
// It is what the Phase-4 inspector renders — "exactly what context your agent saw".
//
// Field shapes echo the engine's reconstruction types (SearchEvent / Session in
// @sia/engine intelligence) so a later Cloud ingest of frames lines up. It is also a
// compatible SUPERSET of the example app's simpler ContextFrame
// (apps/example/src/sia/context-frame.ts) so Phase-3 adoption is lossless.
//
// This module imports ONLY @sia/contract (AgentConfig / SkillCatalogDef). It must NOT
// import @sia/engine — the engine is a devDependency of the SDK (test-only), and the
// frame is a pure host-side object, never a wire payload. (When frames DO cross HTTP in
// Phase 4, promote these types to @sia/contract; for now they live with the client.)
// ─────────────────────────────────────────────────────────────────────────────

import type { AgentConfig, SkillCatalogDef } from "@sia/contract";

/**
 * One hit from the live catalog. This is the **camelCase** shape `catalog.search()`
 * returns from the native 0.2.0 core — deliberately NOT the contract's snake_case wire
 * `SearchHit { tool_id, score }`. Keeping it local keeps capture testable without the
 * native catalog and avoids conflating the two.
 */
export interface RetrievalHit {
  toolId: string;
  score: number;
}

/**
 * One retrieved capability + the floor verdict. Echoes engine `SearchEvent.hits[]`.
 * `skillId` === the registered `toolId` here (in this catalog skills ARE the tools).
 */
export interface RetrievedSkill {
  skillId: string;
  /** Raw BM25 score (engine SearchEvent.hits[].score). */
  score: number;
  /**
   * `score >= floor` — i.e. "cleared the floor", NOT "was invoked". Only the TOP hit is
   * invoked, so a non-top hit can have `clearedFloor: true` yet never appear in
   * `invokedSkillIds`. Read this as a retrieval-strength signal, not an invoke predicate.
   */
  clearedFloor: boolean;
}

/**
 * Coarse per-turn label. `"missed"` (nothing invoked AND no direct answer — the leak/gap)
 * is NEW; `"answered"` / `"tool"` carry over from the example app's `TurnOutcome`, so the
 * values the example produces are a subset of these.
 */
export type FrameOutcome = "answered" | "tool" | "missed";

/** Rich per-invocation I/O — identical to the example app's ToolCallRecord (lifted verbatim). */
export interface ToolCallRecord {
  toolId: string;
  args: unknown;
  result: string;
}

/**
 * The assembled context for one query/turn. A compatible superset of the example's frame:
 * `retrieved` / `invokedSkillIds` / `invokedBodies` are the new capture; `toolCalls` /
 * `answer` / `steps` / `tokens` are the example's optional richness (the deterministic demo
 * omits them; the Phase-3 LLM agent fills them in).
 */
export interface ContextFrame {
  turnId: string;
  ts: number;
  /** Which content-addressed catalog version assembled this turn. */
  configId: string;
  /** Native memory-sink session id (`sess-<...>`); the one always-present attribution. */
  sessionId: string;
  model: string;
  systemPrompt: string;
  userQuery: string;
  // ── retrieval (echoes engine SearchEvent) ──────────────────────────────────
  /** The invoke floor in effect for this capture (the demo gates on 3.5). */
  floor: number;
  retrieved: RetrievedSkill[];
  /** Ids the agent actually invoked (echoes engine SearchEvent.invokedToolIds). */
  invokedSkillIds: string[];
  /** Resolved playbook per invoked skill (PLAN's "invoked skill body"). Omitted when empty. */
  invokedBodies?: Record<string, string>;
  // ── example-compatible optional richness (Phase-3 fills; demo omits) ────────
  toolCalls?: ToolCallRecord[];
  answer?: string;
  steps?: number;
  tokens?: { input: number; output: number; total: number };
  outcome: FrameOutcome;
}

/**
 * Resolve the playbook a skill's executor follows.
 *
 * **Cloud-first**: the Cloud-authored snapshot body wins, else the local SkillDefinition
 * body. This matches how `buildToolCatalog` resolves name/tags/description (snapshot-first)
 * and lets the Cloud heal a skill's body with no redeploy — the self-healing-catalog thesis.
 * Both fields are named `instructions` (SkillSnapshot.instructions / SkillDefinition.instructions).
 *
 * The two sources are mutually exclusive for every current skill (a seed skill ships its body
 * in `SEED_SKILL_DEFS` with a body-less snapshot; a brand-new `add_skill` skill carries
 * `instructions` on the snapshot and has no local def), so the order only ever decides a future
 * tiebreak. Returns `undefined` for an unknown skill.
 */
export function resolveSkillBody(
  config: AgentConfig,
  localDefs: SkillCatalogDef,
  skillId: string,
): string | undefined {
  return (
    config.skills.find((s) => s.skillId === skillId)?.instructions ??
    localDefs.get(skillId)?.instructions
  );
}

/** Everything `captureContextFrame` needs. Optional fields default or are omitted. */
export interface CaptureFrameInput {
  /** Native memory-sink session id for this turn. */
  sessionId: string;
  /** Defaults to `config.id`. */
  configId?: string;
  model: string;
  systemPrompt: string;
  userQuery: string;
  /** The invoke floor used to decide `clearedFloor` (and, by the host, what to invoke). */
  floor: number;
  /** The live `catalog.search()` result (camelCase). */
  hits: RetrievalHit[];
  /** Ids the host actually invoked this turn. */
  invokedSkillIds: string[];
  /** For body resolution (Cloud-first). */
  config: AgentConfig;
  /** For body resolution (Cloud-first). */
  localDefs: SkillCatalogDef;
  // optional richness the LLM host supplies; the demo omits these
  toolCalls?: ToolCallRecord[];
  answer?: string;
  steps?: number;
  tokens?: { input: number; output: number; total: number };
  // optional overrides; else generated
  turnId?: string;
  ts?: number;
}

function newTurnId(): string {
  return `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Assemble a `ContextFrame` from a turn's raw retrieval + invocation. Pure apart from the
 * default `turnId`/`ts` stamps. `outcome` is a total function: invoked ⇒ `"tool"`; else a
 * non-empty answer ⇒ `"answered"`; else `"missed"` (the deterministic demo, with no answer
 * text, lands here for every leak/gap).
 */
export function captureContextFrame(input: CaptureFrameInput): ContextFrame {
  const retrieved: RetrievedSkill[] = input.hits.map((h) => ({
    skillId: h.toolId,
    score: h.score,
    clearedFloor: h.score >= input.floor,
  }));

  const bodies: Record<string, string> = {};
  for (const id of input.invokedSkillIds) {
    const body = resolveSkillBody(input.config, input.localDefs, id);
    if (body !== undefined) bodies[id] = body;
  }

  const outcome: FrameOutcome =
    input.invokedSkillIds.length > 0
      ? "tool"
      : input.answer && input.answer.trim().length > 0
        ? "answered"
        : "missed";

  return {
    turnId: input.turnId ?? newTurnId(),
    ts: input.ts ?? Date.now(),
    configId: input.configId ?? input.config.id,
    sessionId: input.sessionId,
    model: input.model,
    systemPrompt: input.systemPrompt,
    userQuery: input.userQuery,
    floor: input.floor,
    retrieved,
    invokedSkillIds: input.invokedSkillIds,
    invokedBodies: Object.keys(bodies).length ? bodies : undefined,
    toolCalls: input.toolCalls,
    answer: input.answer,
    steps: input.steps,
    tokens: input.tokens,
    outcome,
  };
}
