import { MongoClient, type Collection, type Document } from "mongodb";
import type { UsageStore } from "@sia/engine";
import type { ExtendedTraceEnvelope } from "@sia/contract";

/**
 * MongoDB-backed {@link UsageStore} — the durable usage log the analyzer reads.
 *
 * Lives in the Cloud (not @sia/engine) so the engine stays DB-free — same split as
 * {@link MongoConfigStore}. One append-only collection `usage`, one doc per envelope
 * (Mongo manages `_id`); load strips it back to the plain wire envelope.
 */
export class MongoUsageStore implements UsageStore {
  private constructor(
    private readonly client: MongoClient,
    private readonly usage: Collection<Document>,
  ) {}

  /** Connect + ping so a dead URI fails FAST (≤3s) and the factory can fall back (PLAN risk #1). */
  static async connect(uri: string, dbName: string): Promise<MongoUsageStore> {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000, connectTimeoutMS: 3000 });
    await client.connect();
    const db = client.db(dbName);
    await db.command({ ping: 1 });
    return new MongoUsageStore(client, db.collection("usage"));
  }

  async append(envelopes: ExtendedTraceEnvelope[]) {
    if (envelopes.length === 0) return;
    await this.usage.insertMany(envelopes.map((e) => ({ ...e })));
  }

  async load() {
    const docs = await this.usage.find().toArray();
    return docs.map((d) => {
      const { _id, ...rest } = d as Record<string, unknown>;
      return rest as unknown as ExtendedTraceEnvelope;
    });
  }

  async close() {
    await this.client.close();
  }
}
