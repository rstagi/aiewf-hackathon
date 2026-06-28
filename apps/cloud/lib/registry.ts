import { openFileRegistry, type ConfigRegistry } from "@sia/engine";
import { SEED_CONFIG_DRAFT } from "@sia/seed";
import type { AgentConfig, ConfigChange } from "@sia/contract";
import { REGISTRY_DIR } from "./paths";

// Cross-layer singleton anchored on globalThis. Next bundles Route Handlers and Server
// Actions/Components into separate module graphs, so a plain module-level `let` is NOT
// guaranteed to be shared between them — the dashboard's in-process promote could then be
// invisible to the SDK's GET /api/config/active. globalThis is one per process and bridges
// both graphs (and survives HMR). Re-seed guard via getActiveId().
const globalForRegistry = globalThis as typeof globalThis & {
  __siaRegistry?: ConfigRegistry;
};

export function getRegistry(): ConfigRegistry {
  if (!globalForRegistry.__siaRegistry) {
    const reg = openFileRegistry(REGISTRY_DIR);
    if (reg.getActiveId() === undefined) {
      // Mint genesis + make it champion. Deterministic id: cfg_abd14cd40fc3.
      reg.seed(SEED_CONFIG_DRAFT);
    }
    globalForRegistry.__siaRegistry = reg;
  }
  return globalForRegistry.__siaRegistry;
}

/**
 * Derive a child snapshot by applying one optimization to a parent (default: the
 * active champion). Mints + registers the child but does NOT change the champion —
 * promotion is a separate, explicit pointer flip. Used by both POST /api/config and
 * the dashboard live-swap action.
 */
export function applyChange(change: ConfigChange, parentId?: string): AgentConfig {
  const reg = getRegistry();
  const base = parentId ?? reg.getActiveId();
  if (!base) throw new Error("applyChange: no active config and no parentId");
  return reg.applyChange(base, change);
}

/** Promote a snapshot to champion — one pointer flip (this is also rollback). */
export function promote(id: string): AgentConfig {
  return getRegistry().setActive(id);
}
