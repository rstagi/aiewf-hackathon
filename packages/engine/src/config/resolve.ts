import { contentHash } from "./hash";
import type { AgentConfig, ConfigChange, ConfigDraft, SkillSnapshot } from "./types";

/** Recursively freeze so a snapshot can never be mutated in place after minting. */
export function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object") {
    for (const value of Object.values(obj as Record<string, unknown>)) deepFreeze(value);
    Object.freeze(obj);
  }
  return obj;
}

function normalizeSkill(skill: SkillSnapshot): SkillSnapshot {
  const out: SkillSnapshot = { skillId: skill.skillId, description: skill.description };
  // Cloud-authored body fields must survive normalization, or a stored snapshot would lose
  // them and its surface would no longer hash to its `id` (content-hash divergence).
  if (skill.name !== undefined) out.name = skill.name;
  if (skill.tags !== undefined) out.tags = [...skill.tags];
  if (skill.instructions !== undefined) out.instructions = skill.instructions;
  if (skill.suggested_model !== undefined) out.suggested_model = skill.suggested_model;
  return out;
}

/** Freeze a draft surface into a content-addressed, immutable AgentConfig. */
export function freezeConfig(draft: ConfigDraft, parentId?: string): AgentConfig {
  const config: AgentConfig = {
    id: contentHash(draft),
    ...(parentId ? { parentId } : {}),
    systemPrompt: draft.systemPrompt,
    skills: draft.skills.map(normalizeSkill),
    tools: [...draft.tools],
    modelDefault: draft.modelDefault,
  };
  return deepFreeze(config);
}

/**
 * Apply a single optimization to a parent surface, producing the *child draft*
 * (no identity yet — the registry mints it). The parent is never mutated.
 * Throws if the targeted skill is absent; tolerates a stale `from` (we apply
 * `to` regardless so a re-proposed change is idempotent).
 */
export function deriveChild(parent: AgentConfig, change: ConfigChange): ConfigDraft {
  // `add_skill` APPENDS a brand-new capability, so its precondition is the INVERSE of the
  // mutating kinds': the skill must NOT already exist. Handle it before the must-exist guard.
  if (change.kind === "add_skill") {
    if (parent.skills.some((s) => s.skillId === change.skillId)) {
      throw new Error(`deriveChild: skill '${change.skillId}' already exists in config ${parent.id}`);
    }
    const appended = normalizeSkill({
      skillId: change.skillId,
      description: change.description,
      name: change.name,
      tags: change.tags,
      instructions: change.instructions,
      ...(change.suggested_model !== undefined ? { suggested_model: change.suggested_model } : {}),
    });
    return {
      systemPrompt: parent.systemPrompt,
      skills: [...parent.skills.map(normalizeSkill), appended],
      tools: [...parent.tools],
      modelDefault: parent.modelDefault,
    };
  }

  // Mutating kinds: the targeted skill MUST exist.
  const target = parent.skills.find((s) => s.skillId === change.skillId);
  if (!target) {
    throw new Error(`deriveChild: skill '${change.skillId}' not found in config ${parent.id}`);
  }
  const skills = parent.skills.map((skill) => {
    if (skill.skillId !== change.skillId) return normalizeSkill(skill);
    switch (change.kind) {
      case "rewrite_skill_desc":
        return normalizeSkill({ ...skill, description: change.to });
      case "set_suggested_model":
        return normalizeSkill({ ...skill, suggested_model: change.to });
      default: {
        // Exhaustiveness guard: a new ConfigChange kind must add a branch above, and an
        // unknown kind smuggled past route validation fails loudly here, not as a later
        // undefined-skill TypeError.
        const _exhaustive: never = change;
        throw new Error(`deriveChild: unsupported change kind '${(change as ConfigChange).kind}'`);
      }
    }
  });
  return {
    systemPrompt: parent.systemPrompt,
    skills,
    tools: [...parent.tools],
    modelDefault: parent.modelDefault,
  };
}

/** The model a skill should run on under a given config (override ⇒ default). */
export function modelForSkill(config: AgentConfig, skillId: string): string {
  const skill = config.skills.find((s) => s.skillId === skillId);
  return skill?.suggested_model ?? config.modelDefault;
}
