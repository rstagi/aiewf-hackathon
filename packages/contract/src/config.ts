// ─────────────────────────────────────────────────────────────────────────────
// AgentConfig — the optimizable surface.
// Frozen, content-addressed snapshots the Cloud owns and the SDK fetches JIT.
// Imported by BOTH sides, NEVER copied (anti-drift; PLAN risk #1).
// ─────────────────────────────────────────────────────────────────────────────

/** One skill as frozen into a config snapshot — resolved, NOT live-retrieved. */
export interface SkillSnapshot {
  skillId: string;
  /** The description the retriever (BM25) indexes and the model reads. Lever 1 rewrites this. */
  description: string;
  /** Per-skill model override. Lever 2 sets this. Undefined ⇒ use modelDefault. (snake_case mirrors Ratel wire.) */
  suggested_model?: string;
  // ── Cloud-authored body (PLAN risk #3) ──────────────────────────────────────
  // Present ONLY for skills the Cloud generated, which have NO local SkillDefinition.
  // For seed skills these stay undefined and the local SkillDefinition supplies
  // name/tags/instructions at retrieval time. Carrying the body on the snapshot is what
  // makes a brand-new skill executable with no redeploy. They ARE part of the content hash
  // (a new skill ⇒ a new version); a body-less snapshot hashes EXACTLY as before.
  /** Display name — folded into BM25 text when there is no local SkillDefinition. */
  name?: string;
  /** Stable tags — folded into BM25 text when there is no local SkillDefinition. */
  tags?: string[];
  /** The playbook the executor follows when this skill is invoked (the skill body). */
  instructions?: string;
}

/** A frozen, content-addressed snapshot of an agent's optimizable surface. */
export interface AgentConfig {
  /** Content hash of the surface — stable dedup key. `cfg_<12 hex>`. */
  id: string;
  /** Lineage pointer to the config this was derived from (for the before/after chart). */
  parentId?: string;
  systemPrompt: string;
  skills: SkillSnapshot[];
  tools: string[];
  modelDefault: string;
}

/** A config surface without its derived identity — the input to `freezeConfig`/`contentHash`. */
export type ConfigDraft = Omit<AgentConfig, "id" | "parentId">;

/**
 * A single optimization applied to a config surface to derive a child snapshot.
 * The two hero levers (description-first), plus `add_skill` — the Cloud authoring a
 * brand-new capability to close a true gap (it carries its own body; see SkillSnapshot).
 */
export type ConfigChange =
  | { kind: "rewrite_skill_desc"; skillId: string; from?: string; to: string }
  | { kind: "set_suggested_model"; skillId: string; from?: string; to: string }
  | {
      kind: "add_skill";
      skillId: string;
      name: string;
      description: string;
      tags: string[];
      instructions: string;
      suggested_model?: string;
    };

export type ConfigChangeKind = ConfigChange["kind"];

// ─────────────────────────────────────────────────────────────────────────────
// SkillDefinition — stable, NON-optimizable skill identity.
// Lives OUTSIDE the versioned AgentConfig; joined with the snapshot's description
// at retrieval time to form the BM25 searchable text.
// ─────────────────────────────────────────────────────────────────────────────
export interface SkillDefinition {
  skillId: string;
  /** Human/display name — part of the BM25 searchable text. */
  name: string;
  /** Stable tags — folded into the searchable text. */
  tags: string[];
  /** The playbook the executor follows to actually answer when this skill is invoked. */
  instructions: string;
  /** Canonical intents this skill is the correct ("gold") capability for. */
  goldIntents: string[];
}

export type SkillCatalogDef = Map<string, SkillDefinition>;

/**
 * Resolve which model a skill runs on under a config: per-skill override beats the
 * config default; unknown skill ⇒ modelDefault. Pure — lives in the contract so the
 * SDK (Lever 2) can resolve without depending on the engine.
 */
export function modelForSkill(config: AgentConfig, skillId: string): string {
  const skill = config.skills.find((s) => s.skillId === skillId);
  return skill?.suggested_model ?? config.modelDefault;
}
