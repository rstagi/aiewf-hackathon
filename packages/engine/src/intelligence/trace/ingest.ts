/**
 * Ingestion: raw JSONL text → typed, session-grouped, time-ordered envelopes.
 */

import { parseLine, type TraceEnvelope } from "./events";

/** Parse a full JSONL blob into envelopes, dropping blank/invalid/unknown lines. */
export function parseTraceJsonl(jsonl: string): TraceEnvelope[] {
  const out: TraceEnvelope[] = [];
  for (const line of jsonl.split("\n")) {
    const ev = parseLine(line);
    if (ev) out.push(ev);
  }
  return out;
}

/** Group envelopes by session_id, each group sorted ascending by ts (stable). */
export function groupBySession(envelopes: TraceEnvelope[]): Map<string, TraceEnvelope[]> {
  const groups = new Map<string, TraceEnvelope[]>();
  for (const ev of envelopes) {
    const g = groups.get(ev.session_id);
    if (g) g.push(ev);
    else groups.set(ev.session_id, [ev]);
  }
  for (const g of groups.values()) {
    // Stable sort by ts (events sharing a ts keep insertion order — the emit order).
    g.sort((a, b) => a.ts - b.ts);
  }
  return groups;
}
