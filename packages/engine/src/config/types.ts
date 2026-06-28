/**
 * Config surface types now live in the shared wire contract (@sia/contract) so the
 * SDK (fetch) and the Cloud (serve) import the SAME definitions, never copies
 * (anti-drift; PLAN risk #1). This module re-exports them for the engine's internal
 * imports and keeps the one runtime-only boundary the contract must NOT carry:
 * ConfigStore (a File⟷Memory IO interface).
 */
export type {
  SkillSnapshot,
  AgentConfig,
  ConfigDraft,
  ConfigChange,
  ConfigChangeKind,
} from "@sia/contract";

import type { AgentConfig } from "@sia/contract";

/**
 * Persistence boundary for the registry. Swap File ⟷ Memory ⟷ Mongo without
 * touching the content-hash/dedup/pointer-flip logic.
 *
 * ASYNC by design: a Mongo-backed store does real network I/O. Only the three
 * persistence ops are async — the registry loads everything into an in-memory Map
 * once (at `open`) and serves all READS synchronously from there, so the SDK's
 * JIT `GET /api/config/active` never awaits a round-trip.
 */
export interface ConfigStore {
  /** Read the full version history + the active pointer (once, at registry open). */
  load(): Promise<{ snapshots: AgentConfig[]; activeId?: string }>;
  /** Durably append one immutable snapshot (idempotent on the content-hashed id). */
  appendSnapshot(config: AgentConfig): Promise<void>;
  /** Persist the active-pointer flip (this is BOTH promote and rollback). */
  saveActive(id: string): Promise<void>;
  /** Release any held resources (e.g. a Mongo client). Optional for in-memory stores. */
  close?(): Promise<void>;
}
