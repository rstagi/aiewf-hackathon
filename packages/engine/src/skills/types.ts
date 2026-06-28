/**
 * Stable skill identity. The types live in @sia/contract (shared with the SDK's
 * catalog builder); the runtime indexer stays here in the engine.
 */
export type { SkillDefinition, SkillCatalogDef } from "@sia/contract";

import type { SkillDefinition, SkillCatalogDef } from "@sia/contract";

export function indexSkillDefs(defs: SkillDefinition[]): SkillCatalogDef {
  return new Map(defs.map((d) => [d.skillId, d]));
}
