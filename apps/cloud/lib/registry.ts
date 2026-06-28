import { openFileRegistry, ConfigRegistry } from "@sia/engine";
import { SEED_CONFIG_DRAFT } from "@sia/seed";
import type { AgentConfig, ConfigChange } from "@sia/contract";
import { REGISTRY_DIR } from "./paths";
import { MongoConfigStore } from "./store-mongo";

export type StorageKind = "mongo" | "file";

// Cross-layer singleton anchored on globalThis. Next bundles Route Handlers into separate
// module graphs, so a plain module-level `let` is NOT guaranteed shared between them.
// globalThis is one per process and bridges them (and survives HMR). We memoize the
// PROMISE (not the resolved value) so concurrent first requests share ONE init — the
// sync check-and-assign below can't interleave (JS is single-threaded until the first await).
const g = globalThis as typeof globalThis & {
  __siaRegistryPromise?: Promise<ConfigRegistry>;
  __siaStorageKind?: StorageKind;
};

/** Error → log string, with any mongodb URI (and its embedded credentials) redacted. */
function safeErr(e: unknown): string {
  const m = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return m.replace(/mongodb(\+srv)?:\/\/\S*/gi, "mongodb://<redacted>");
}

/** Mint the genesis config + make it champion on first boot. No-op once seeded. */
async function ensureSeeded(reg: ConfigRegistry): Promise<ConfigRegistry> {
  // Deterministic genesis id: cfg_abd14cd40fc3.
  if (reg.getActiveId() === undefined) await reg.seed(SEED_CONFIG_DRAFT);
  return reg;
}

/**
 * Open the registry against Mongo when `MONGO_URI` is set, else the file store.
 *
 * The ENTIRE Mongo path — connect, hydrate, AND the genesis seed write — is inside one
 * try, so ANY Mongo failure (unreachable, or reachable-but-unwritable: read-only role,
 * full disk, secondary) degrades to the file store instead of crashing. The demo path
 * must never hard-depend on a live DB (PLAN risk #1). The abandoned client is closed so
 * a failed Mongo attempt doesn't leak a connection.
 */
async function build(): Promise<ConfigRegistry> {
  const uri = process.env.MONGO_URI;
  if (uri) {
    let store: MongoConfigStore | undefined;
    try {
      store = await MongoConfigStore.connect(uri, process.env.MONGO_DB ?? "sia");
      const reg = await ensureSeeded(await ConfigRegistry.open(store));
      g.__siaStorageKind = "mongo";
      console.log("[sia/cloud] storage backend: mongo");
      return reg;
    } catch (e) {
      console.warn(`[sia/cloud] Mongo backend unavailable (${safeErr(e)}); falling back to file store.`);
      if (store) await store.close().catch(() => {}); // release the client we won't use
    }
  }
  g.__siaStorageKind = "file";
  console.log("[sia/cloud] storage backend: file");
  return ensureSeeded(await openFileRegistry(REGISTRY_DIR));
}

export function getRegistry(): Promise<ConfigRegistry> {
  if (!g.__siaRegistryPromise) {
    const p = build();
    // A rejected promise stays truthy — without this, a transient first-boot failure would
    // be cached forever and brick every route until a process restart. Clear it so the next
    // request re-attempts init (keep the sync assign-before-await so concurrent firsts share one).
    p.catch(() => {
      if (g.__siaRegistryPromise === p) g.__siaRegistryPromise = undefined;
    });
    g.__siaRegistryPromise = p;
  }
  return g.__siaRegistryPromise;
}

/** Which backend the live registry actually opened (after {@link getRegistry} runs). */
export function storageKind(): StorageKind | undefined {
  return g.__siaStorageKind;
}

/**
 * Derive a child snapshot by applying one optimization to a parent (default: the active
 * champion). Mints + registers the child but does NOT change the champion — promotion is a
 * separate, explicit pointer flip.
 */
export async function applyChange(change: ConfigChange, parentId?: string): Promise<AgentConfig> {
  const reg = await getRegistry();
  const base = parentId ?? reg.getActiveId();
  if (!base) throw new Error("applyChange: no active config and no parentId");
  return reg.applyChange(base, change);
}

/** Promote a snapshot to champion — one pointer flip (this is also rollback). */
export async function promote(id: string): Promise<AgentConfig> {
  return (await getRegistry()).setActive(id);
}
