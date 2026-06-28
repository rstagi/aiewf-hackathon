// @sia/sdk — thin wrapper over @ratel-ai/sdk. Adds exactly two things on top of
// normal Ratel use: (a) fetches the optimizable AgentConfig from the Cloud JIT and
// pins it per-run, (b) emits usage traces back to the Cloud by composition
// (memory sink → drain → enrich with attribution → fire-and-forget POST).

export { buildToolCatalog } from "./tool-catalog";
export type { ToolCatalogTrace, SkillExecutor } from "./tool-catalog";

export { fetchActiveConfig, emitTraces, enrichEnvelopes } from "./client";
export type { SdkConfig, EmitAttribution, Drainable } from "./client";

// Convenience re-export: per-skill model resolution (Lever 2) lives in the contract.
export { modelForSkill } from "@sia/contract";
