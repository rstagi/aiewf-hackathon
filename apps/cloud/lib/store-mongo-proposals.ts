import { MongoClient, type Collection } from "mongodb";
import type { ProposalStore } from "@sia/engine";
import type { Proposal, ProposalStatus } from "@sia/contract";

/**
 * MongoDB-backed {@link ProposalStore}. One collection `proposals`, `_id` = proposal.id
 * (deterministic), so save is an idempotent upsert and setStatus is an in-place `$set`.
 */
interface ProposalDoc extends Proposal {
  _id: string; // === proposal.id
}

export class MongoProposalStore implements ProposalStore {
  private constructor(
    private readonly client: MongoClient,
    private readonly proposals: Collection<ProposalDoc>,
  ) {}

  /** Connect + ping so a dead URI fails FAST (≤3s) and the factory can fall back (PLAN risk #1). */
  static async connect(uri: string, dbName: string): Promise<MongoProposalStore> {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000, connectTimeoutMS: 3000 });
    await client.connect();
    const db = client.db(dbName);
    await db.command({ ping: 1 });
    return new MongoProposalStore(client, db.collection<ProposalDoc>("proposals"));
  }

  async save(proposal: Proposal) {
    // On upsert Mongo derives `_id` from the filter's equality, so the replacement must NOT
    // carry `_id` (mongodb's WithoutId constraint). `proposal` has no `_id` of its own.
    await this.proposals.replaceOne({ _id: proposal.id }, proposal, { upsert: true });
  }

  async list() {
    const docs = await this.proposals.find().toArray();
    return docs.map(({ _id, ...p }) => p as Proposal);
  }

  async get(id: string) {
    const doc = await this.proposals.findOne({ _id: id });
    if (!doc) return undefined;
    const { _id, ...p } = doc;
    return p as Proposal;
  }

  async setStatus(id: string, status: ProposalStatus) {
    const res = await this.proposals.updateOne({ _id: id }, { $set: { status } });
    if (res.matchedCount === 0) throw new Error(`ProposalStore: unknown proposal '${id}'`);
  }

  async close() {
    await this.client.close();
  }
}
