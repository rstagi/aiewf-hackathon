import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseLine } from "@sia/contract";
import type { ExtendedTraceEnvelope } from "@sia/contract";
import type { UsageStore } from "./types";

/** In-memory usage log — used by tests and ephemeral runs. No durability. */
export class MemoryUsageStore implements UsageStore {
  private envelopes: ExtendedTraceEnvelope[] = [];

  async append(envelopes: ExtendedTraceEnvelope[]) {
    this.envelopes.push(...envelopes);
  }
  async load() {
    return [...this.envelopes];
  }
}

/**
 * File-backed usage log: append-only JSONL (one envelope per line). The no-Mongo FALLBACK
 * (PLAN risk #1). `parseLine` tolerates a partially-written final line and lets the camelCase
 * attribution (configId/arm) pass through untouched. Synchronous fs under the async interface.
 */
export class FileUsageStore implements UsageStore {
  constructor(private readonly path: string) {}

  async append(envelopes: ExtendedTraceEnvelope[]) {
    if (envelopes.length === 0) return;
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const lines = envelopes.map((e) => JSON.stringify(e)).join("\n");
    appendFileSync(this.path, `${lines}\n`);
  }

  async load() {
    if (!existsSync(this.path)) return [];
    const raw = readFileSync(this.path, "utf8");
    const out: ExtendedTraceEnvelope[] = [];
    for (const line of raw.split("\n")) {
      const parsed = parseLine(line);
      if (parsed) out.push(parsed as ExtendedTraceEnvelope);
    }
    return out;
  }
}
