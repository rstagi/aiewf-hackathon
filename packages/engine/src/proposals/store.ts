import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Proposal, ProposalStatus } from "@sia/contract";
import type { ProposalStore } from "./types";

/** In-memory proposal store — used by tests and ephemeral runs. No durability. */
export class MemoryProposalStore implements ProposalStore {
  private byId = new Map<string, Proposal>();

  async save(proposal: Proposal) {
    this.byId.set(proposal.id, proposal);
  }
  async list() {
    return [...this.byId.values()];
  }
  async get(id: string) {
    return this.byId.get(id);
  }
  async setStatus(id: string, status: ProposalStatus) {
    const p = this.byId.get(id);
    if (!p) throw new Error(`ProposalStore: unknown proposal '${id}'`);
    this.byId.set(id, { ...p, status });
  }
}

/**
 * File-backed proposal store: a single JSON array rewritten on each mutation. The no-Mongo
 * FALLBACK (PLAN risk #1). Cardinality is tiny, so a full rewrite per save/setStatus is cheap
 * and keeps update semantics simple (vs. an append-only log that would need load-time dedup).
 */
export class FileProposalStore implements ProposalStore {
  constructor(private readonly path: string) {}

  private readAll(): Proposal[] {
    if (!existsSync(this.path)) return [];
    try {
      return JSON.parse(readFileSync(this.path, "utf8")) as Proposal[];
    } catch {
      return []; // tolerate a partially-written file
    }
  }

  private writeAll(proposals: Proposal[]) {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.path, `${JSON.stringify(proposals, null, 2)}\n`);
  }

  async save(proposal: Proposal) {
    const all = this.readAll();
    const idx = all.findIndex((p) => p.id === proposal.id);
    if (idx >= 0) all[idx] = proposal;
    else all.push(proposal);
    this.writeAll(all);
  }
  async list() {
    return this.readAll();
  }
  async get(id: string) {
    return this.readAll().find((p) => p.id === id);
  }
  async setStatus(id: string, status: ProposalStatus) {
    const all = this.readAll();
    const p = all.find((x) => x.id === id);
    if (!p) throw new Error(`ProposalStore: unknown proposal '${id}'`);
    p.status = status;
    this.writeAll(all);
  }
}
