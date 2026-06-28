import type { Proposal, ProposalStatus } from "@sia/contract";

/**
 * Persistence boundary for self-healing PROPOSALS — the unit of the analyze → apply loop.
 * Low cardinality (a handful per analyze run) and mutable (status flips proposed → applied),
 * so impls keep the whole set and rewrite on save/setStatus rather than append-only.
 *
 * ASYNC by design. File / Memory impls live in the engine; the Mongo impl lives in the Cloud.
 */
export interface ProposalStore {
  /** Insert or replace a proposal (idempotent on id). */
  save(proposal: Proposal): Promise<void>;
  /** All proposals (caller orders/filters). */
  list(): Promise<Proposal[]>;
  /** One proposal by id, or undefined. */
  get(id: string): Promise<Proposal | undefined>;
  /** Flip a proposal's status (proposed → applied / dismissed). Throws on an unknown id. */
  setStatus(id: string, status: ProposalStatus): Promise<void>;
  /** Release any held resources. Optional for in-memory stores. */
  close?(): Promise<void>;
}
