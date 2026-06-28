// @sia/engine — the framework-free brain.
// Lifted ~as-is from lib/intelligence + lib/agentctx/config (archive/v1-pre-reset).
// Config types come from @sia/contract; everything here is runtime logic.

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

// ── Skills ──
export { indexSkillDefs } from "./skills/types";

// ── Trace ingest → reconstructed sessions ──
export { parseTraceJsonl, groupBySession } from "./intelligence/trace/ingest";
export { buildSessions, buildSession } from "./intelligence/trace/session";

// ── Detector (Phase-0: model-free cross-reference engine) ──
export { runDetector } from "./intelligence/detector/detector";
export { DEFAULT_CONFIG } from "./intelligence/detector/types";
export type {
  DetectionConfig,
  DetectionReport,
  DetectorDeps,
  Flag,
  FlagKind,
  IntentFunnel,
} from "./intelligence/detector/types";

// ── Intent clustering (deterministic Phase-0 baseline) ──
export { DeterministicIntentClusterer, tokenize } from "./intelligence/dimensions/intent/cluster";

// ── Reconstructed session domain types ──
export type { Session, SearchEvent, ToolCall, SkillInvoke, Turn } from "./intelligence/types";
