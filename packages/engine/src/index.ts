// @sia/engine — the framework-free brain.
// Config types come from @sia/contract; everything here is runtime logic the Cloud
// merely hosts (portable, testable, not Cloud-coupled).
//
// v4 surface = exactly the verified cores the self-healing loop reuses:
//   • content-hashed config versions + pointer-flip promote/rollback (the catalog authority)
//   • async storage boundary (File / Memory in-engine; Mongo lives in the Cloud)
//   • deterministic Jaccard intent clustering
//   • trace ingest → reconstructed sessions (usage → what the agent actually did)

// ── Config registry: immutable content-hashed snapshots + pointer-flip promote/rollback ──
export {
  ConfigRegistry,
  openFileRegistry,
  openMemoryRegistry,
  FileConfigStore,
  MemoryConfigStore,
  freezeConfig,
  deriveChild,
  deepFreeze,
  modelForSkill,
  contentHash,
  canonicalize,
  canonicalJSON,
} from "./config/index";
export type { ConfigStore } from "./config/types";

// ── Usage ingest log (the analyzer's input) — File/Memory in-engine, Mongo in the Cloud ──
export { MemoryUsageStore, FileUsageStore } from "./usage/store";
export type { UsageStore } from "./usage/types";

// ── Self-healing proposals (the analyze → apply unit) ──
export { MemoryProposalStore, FileProposalStore } from "./proposals/store";
export type { ProposalStore } from "./proposals/types";

// ── Skills ──
export { indexSkillDefs } from "./skills/types";

// ── Trace ingest → reconstructed sessions ──
export { parseTraceJsonl, groupBySession } from "./intelligence/trace/ingest";
export { buildSessions, buildSession } from "./intelligence/trace/session";

// ── Gap detection (the v4 gate: cluster missed queries → route create/improve) ──
export { detectGaps } from "./intelligence/gaps";
export type { GapCluster, GapCandidate, GapRoute, DetectGapsOptions } from "./intelligence/gaps";

// ── Intent clustering (deterministic Jaccard baseline) ──
export { DeterministicIntentClusterer, tokenize } from "./intelligence/dimensions/intent/cluster";
export type {
  IntentCluster,
  IntentClustering,
  IntentClusterer,
  IntentAssignment,
} from "./intelligence/dimensions/types";

// ── Reconstructed session domain types ──
export type { Session, SearchEvent, ToolCall, SkillInvoke, Turn } from "./intelligence/types";
