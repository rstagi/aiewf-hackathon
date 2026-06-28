import { MongoClient, type Collection } from "mongodb";
import type { ConfigStore } from "@sia/engine";
import type { AgentConfig } from "@sia/contract";

/**
 * MongoDB-backed {@link ConfigStore} — the catalog authority's durable backend.
 *
 * Lives in the Cloud (not @sia/engine) so the engine stays a pure, dependency-free
 * brain: the engine owns the INTERFACE + the File/Memory fallbacks; only the product
 * carries the `mongodb` driver. Two collections mirror the File store's two files:
 *   • `configs` — one immutable, content-hashed snapshot per doc (`_id` = config.id)
 *   • `pointer` — a single `{ _id: "active", configId }` doc (the champion)
 * Promote/rollback only ever upserts the pointer; snapshots are never mutated.
 */

interface ConfigDoc extends AgentConfig {
  _id: string; // === config.id (the content hash)
}
interface PointerDoc {
  _id: "active";
  configId: string;
}

function isDuplicateKey(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: number }).code === 11000;
}

export class MongoConfigStore implements ConfigStore {
  private constructor(
    private readonly client: MongoClient,
    private readonly configs: Collection<ConfigDoc>,
    private readonly pointer: Collection<PointerDoc>,
  ) {}

  /**
   * Connect + verify reachability with a ping so a dead URI fails FAST (≤3s) and the
   * Cloud factory can fall back to the file store (PLAN risk #1: never die on the DB).
   */
  static async connect(uri: string, dbName: string): Promise<MongoConfigStore> {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000, connectTimeoutMS: 3000 });
    await client.connect();
    const db = client.db(dbName);
    await db.command({ ping: 1 }); // force a real round-trip; throws if unreachable
    return new MongoConfigStore(
      client,
      db.collection<ConfigDoc>("configs"),
      db.collection<PointerDoc>("pointer"),
    );
  }

  async load() {
    const docs = await this.configs.find().toArray();
    const snapshots = docs.map(({ _id, ...cfg }) => cfg as AgentConfig);
    const ptr = await this.pointer.findOne({ _id: "active" });
    return { snapshots, activeId: ptr?.configId };
  }

  async appendSnapshot(config: AgentConfig) {
    try {
      await this.configs.insertOne({ _id: config.id, ...config });
    } catch (e) {
      // Snapshots are immutable + content-hashed: a duplicate id is the SAME surface, so a
      // re-insert (e.g. two instances seeding genesis) is a safe no-op, not an error.
      if (!isDuplicateKey(e)) throw e;
    }
  }

  async saveActive(id: string) {
    await this.pointer.updateOne({ _id: "active" }, { $set: { configId: id } }, { upsert: true });
  }

  async close() {
    await this.client.close();
  }
}
