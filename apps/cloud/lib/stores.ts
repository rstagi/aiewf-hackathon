import { FileProposalStore, FileUsageStore } from "@sia/engine";
import type { ProposalStore, UsageStore } from "@sia/engine";
import { PROPOSALS_PATH, TRACES_PATH } from "./paths";
import { MongoUsageStore } from "./store-mongo-usage";
import { MongoProposalStore } from "./store-mongo-proposals";

/**
 * Usage + proposal store factories — the same graceful-fallback story as the config
 * {@link getRegistry}: Mongo when `MONGO_URI` is set + reachable, else the file fallback
 * (PLAN risk #1: the demo never hard-depends on a live DB). Each is a promise-memoized
 * singleton on `globalThis` (Next bundles route handlers into separate module graphs), and
 * a rejected init self-clears so the next request re-attempts rather than caching the failure.
 */
const g = globalThis as typeof globalThis & {
  __siaUsageStorePromise?: Promise<UsageStore>;
  __siaProposalStorePromise?: Promise<ProposalStore>;
};

/** Error → log string with any mongodb URI (and embedded credentials) redacted. */
function safeErr(e: unknown): string {
  const m = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return m.replace(/mongodb(\+srv)?:\/\/\S*/gi, "mongodb://<redacted>");
}

async function buildUsageStore(): Promise<UsageStore> {
  const uri = process.env.MONGO_URI;
  if (uri) {
    let store: MongoUsageStore | undefined;
    try {
      store = await MongoUsageStore.connect(uri, process.env.MONGO_DB ?? "sia");
      console.log("[sia/cloud] usage store: mongo");
      return store;
    } catch (e) {
      console.warn(`[sia/cloud] Mongo usage store unavailable (${safeErr(e)}); falling back to file store.`);
      if (store) await store.close().catch(() => {});
    }
  }
  console.log("[sia/cloud] usage store: file");
  return new FileUsageStore(TRACES_PATH);
}

async function buildProposalStore(): Promise<ProposalStore> {
  const uri = process.env.MONGO_URI;
  if (uri) {
    let store: MongoProposalStore | undefined;
    try {
      store = await MongoProposalStore.connect(uri, process.env.MONGO_DB ?? "sia");
      console.log("[sia/cloud] proposal store: mongo");
      return store;
    } catch (e) {
      console.warn(`[sia/cloud] Mongo proposal store unavailable (${safeErr(e)}); falling back to file store.`);
      if (store) await store.close().catch(() => {});
    }
  }
  console.log("[sia/cloud] proposal store: file");
  return new FileProposalStore(PROPOSALS_PATH);
}

export function getUsageStore(): Promise<UsageStore> {
  if (!g.__siaUsageStorePromise) {
    const p = buildUsageStore();
    p.catch(() => {
      if (g.__siaUsageStorePromise === p) g.__siaUsageStorePromise = undefined;
    });
    g.__siaUsageStorePromise = p;
  }
  return g.__siaUsageStorePromise;
}

export function getProposalStore(): Promise<ProposalStore> {
  if (!g.__siaProposalStorePromise) {
    const p = buildProposalStore();
    p.catch(() => {
      if (g.__siaProposalStorePromise === p) g.__siaProposalStorePromise = undefined;
    });
    g.__siaProposalStorePromise = p;
  }
  return g.__siaProposalStorePromise;
}
