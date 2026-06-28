import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentConfig, ConfigStore } from "./types";

/** In-memory store — used by tests and ephemeral runs. No durability. */
export class MemoryConfigStore implements ConfigStore {
  private snapshots: AgentConfig[] = [];
  private activeId?: string;

  async load() {
    return { snapshots: [...this.snapshots], activeId: this.activeId };
  }
  async appendSnapshot(config: AgentConfig) {
    this.snapshots.push(config);
  }
  async saveActive(id: string) {
    this.activeId = id;
  }
}

/**
 * File-backed store: append-only `snapshots.jsonl` (one frozen config per line)
 * plus a tiny `active.json` pointer. The append-only log is the version history;
 * the pointer is the champion. Promote/rollback only ever rewrites the pointer.
 *
 * This is the no-Mongo FALLBACK (PLAN risk #1): the demo never hard-depends on a
 * live DB. Writes use synchronous fs under the async interface — they resolve
 * immediately and stay durable across a Cloud restart.
 */
export class FileConfigStore implements ConfigStore {
  private readonly snapshotsPath: string;
  private readonly activePath: string;

  constructor(dir: string) {
    this.snapshotsPath = join(dir, "snapshots.jsonl");
    this.activePath = join(dir, "active.json");
  }

  async load() {
    const snapshots: AgentConfig[] = [];
    if (existsSync(this.snapshotsPath)) {
      const raw = readFileSync(this.snapshotsPath, "utf8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          snapshots.push(JSON.parse(trimmed) as AgentConfig);
        } catch {
          // tolerate a partially-written final line
        }
      }
    }
    let activeId: string | undefined;
    if (existsSync(this.activePath)) {
      try {
        activeId = (JSON.parse(readFileSync(this.activePath, "utf8")) as { activeId?: string }).activeId;
      } catch {
        activeId = undefined;
      }
    }
    return { snapshots, activeId };
  }

  async appendSnapshot(config: AgentConfig) {
    this.ensureDir(this.snapshotsPath);
    appendFileSync(this.snapshotsPath, `${JSON.stringify(config)}\n`);
  }

  async saveActive(id: string) {
    this.ensureDir(this.activePath);
    writeFileSync(this.activePath, `${JSON.stringify({ activeId: id }, null, 2)}\n`);
  }

  private ensureDir(filePath: string) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}
