import { deriveChild, freezeConfig } from "./resolve";
import { FileConfigStore, MemoryConfigStore } from "./store";
import type { AgentConfig, ConfigChange, ConfigDraft, ConfigStore } from "./types";

/**
 * The config registry: the source of truth for every config snapshot and the
 * single `activeConfigId` pointer (the "champion"). Snapshots are immutable and
 * content-addressed; promotion and rollback are *only* pointer flips, so they
 * are instant and trivially reversible.
 */
export class ConfigRegistry {
  private readonly byId = new Map<string, AgentConfig>();
  private activeId?: string;

  constructor(private readonly store: ConfigStore) {
    const { snapshots, activeId } = store.load();
    for (const snapshot of snapshots) this.byId.set(snapshot.id, freezeConfig(snapshot, snapshot.parentId));
    this.activeId = activeId;
  }

  /** Mint (or dedup) a snapshot from a draft surface. Does NOT change the champion. */
  register(draft: ConfigDraft, parentId?: string): AgentConfig {
    const config = freezeConfig(draft, parentId);
    const existing = this.byId.get(config.id);
    if (existing) return existing; // identical surface ⇒ same id ⇒ dedup
    this.byId.set(config.id, config);
    this.store.appendSnapshot(config);
    return config;
  }

  /** Mint the genesis config and make it champion in one step. */
  seed(draft: ConfigDraft): AgentConfig {
    const config = this.register(draft);
    this.setActive(config.id);
    return config;
  }

  get(id: string): AgentConfig | undefined {
    return this.byId.get(id);
  }
  has(id: string): boolean {
    return this.byId.has(id);
  }
  list(): AgentConfig[] {
    return [...this.byId.values()];
  }

  getActiveId(): string | undefined {
    return this.activeId;
  }
  getActive(): AgentConfig | undefined {
    return this.activeId ? this.byId.get(this.activeId) : undefined;
  }

  /** Pointer flip. This is promote AND rollback — both just move the champion. */
  setActive(id: string): AgentConfig {
    const config = this.byId.get(id);
    if (!config) throw new Error(`setActive: unknown config '${id}'`);
    this.activeId = id;
    this.store.saveActive(id);
    return config;
  }

  /** Derive + register a child by applying a change to a parent. Champion unchanged. */
  applyChange(parentId: string, change: ConfigChange): AgentConfig {
    const parent = this.byId.get(parentId);
    if (!parent) throw new Error(`applyChange: unknown parent '${parentId}'`);
    return this.register(deriveChild(parent, change), parent.id);
  }

  /** Root→leaf chain via parentId, for the before/after lineage view. */
  lineage(id: string): AgentConfig[] {
    const chain: AgentConfig[] = [];
    const seen = new Set<string>();
    let current = this.byId.get(id);
    while (current && !seen.has(current.id)) {
      chain.unshift(current);
      seen.add(current.id);
      current = current.parentId ? this.byId.get(current.parentId) : undefined;
    }
    return chain;
  }
}

export function openFileRegistry(dir: string): ConfigRegistry {
  return new ConfigRegistry(new FileConfigStore(dir));
}

export function openMemoryRegistry(): ConfigRegistry {
  return new ConfigRegistry(new MemoryConfigStore());
}
