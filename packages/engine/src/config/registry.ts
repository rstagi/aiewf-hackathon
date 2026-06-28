import { deriveChild, freezeConfig } from "./resolve";
import { FileConfigStore, MemoryConfigStore } from "./store";
import type { AgentConfig, ConfigChange, ConfigDraft, ConfigStore } from "./types";

/**
 * The config registry: the source of truth for every config snapshot and the
 * single `activeConfigId` pointer (the "champion"). Snapshots are immutable and
 * content-addressed; promotion and rollback are *only* pointer flips, so they
 * are instant and trivially reversible.
 *
 * The full version history is held in an in-memory Map, hydrated once from the
 * store at `open()`. READS are synchronous (served from the Map — the SDK's JIT
 * fetch never awaits I/O); WRITES are async (they await the store so a Mongo
 * round-trip is durable before the new version/pointer is considered committed).
 */
export class ConfigRegistry {
  private readonly byId = new Map<string, AgentConfig>();
  private activeId?: string;

  /** Use {@link ConfigRegistry.open} — the constructor takes pre-loaded state. */
  private constructor(
    private readonly store: ConfigStore,
    loaded: { snapshots: AgentConfig[]; activeId?: string },
  ) {
    for (const snapshot of loaded.snapshots) this.byId.set(snapshot.id, freezeConfig(snapshot, snapshot.parentId));
    this.activeId = loaded.activeId;
  }

  /** Hydrate the registry from its store (the one async step). */
  static async open(store: ConfigStore): Promise<ConfigRegistry> {
    const loaded = await store.load();
    return new ConfigRegistry(store, loaded);
  }

  /** Mint (or dedup) a snapshot from a draft surface. Does NOT change the champion. */
  async register(draft: ConfigDraft, parentId?: string): Promise<AgentConfig> {
    const config = freezeConfig(draft, parentId);
    const existing = this.byId.get(config.id);
    if (existing) return existing; // identical surface ⇒ same id ⇒ dedup
    // Durability-first: persist BEFORE publishing to the in-memory map, so a rejected store
    // write leaves no phantom snapshot and the thrown error is truthful.
    await this.store.appendSnapshot(config);
    this.byId.set(config.id, config);
    return config;
  }

  /** Mint the genesis config and make it champion in one step. */
  async seed(draft: ConfigDraft): Promise<AgentConfig> {
    const config = await this.register(draft);
    await this.setActive(config.id);
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
  async setActive(id: string): Promise<AgentConfig> {
    const config = this.byId.get(id);
    if (!config) throw new Error(`setActive: unknown config '${id}'`);
    // Durability-first: persist the flip BEFORE moving the in-memory pointer, so a failed
    // write leaves the champion unchanged rather than tearing memory from storage.
    await this.store.saveActive(id);
    this.activeId = id;
    return config;
  }

  /** Derive + register a child by applying a change to a parent. Champion unchanged. */
  async applyChange(parentId: string, change: ConfigChange): Promise<AgentConfig> {
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

  /** Release the underlying store (e.g. a Mongo client). */
  async close(): Promise<void> {
    await this.store.close?.();
  }
}

export function openFileRegistry(dir: string): Promise<ConfigRegistry> {
  return ConfigRegistry.open(new FileConfigStore(dir));
}

export function openMemoryRegistry(): Promise<ConfigRegistry> {
  return ConfigRegistry.open(new MemoryConfigStore());
}
