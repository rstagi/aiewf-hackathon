import type { ExtendedTraceEnvelope } from "@sia/contract";

/**
 * Persistence boundary for ingested USAGE — the trace envelopes the SDK emits and the
 * analyzer consumes. Append-only: usage is an immutable log, never mutated in place.
 *
 * ASYNC by design (a Mongo-backed impl does network I/O). File / Memory impls live in the
 * engine; the Mongo impl lives in the Cloud — same split as {@link ConfigStore}, so the
 * engine stays DB-free.
 */
export interface UsageStore {
  /** Durably append a batch of trace envelopes (no-op for an empty batch). */
  append(envelopes: ExtendedTraceEnvelope[]): Promise<void>;
  /** Read the full usage log — the analyzer's input. */
  load(): Promise<ExtendedTraceEnvelope[]>;
  /** Release any held resources (e.g. a Mongo client). Optional for in-memory stores. */
  close?(): Promise<void>;
}
