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

/** Persistence boundary for the registry. Swap File ⟷ Memory without touching logic. */
export interface ConfigStore {
  load(): { snapshots: AgentConfig[]; activeId?: string };
  appendSnapshot(config: AgentConfig): void;
  saveActive(id: string): void;
}
