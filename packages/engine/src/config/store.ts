import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentConfig, ConfigStore } from "./types";

/** In-memory store — used by tests and ephemeral runs. */
export class MemoryConfigStore implements ConfigStore {
  private snapshots: AgentConfig[] = [];
  private activeId?: string;

  load() {
    return { snapshots: [...this.snapshots], activeId: this.activeId };
  }
  appendSnapshot(config: AgentConfig) {
    this.snapshots.push(config);
  }
  saveActive(id: string) {
    this.activeId = id;
  }
}

/**
 * File-backed store: append-only `snapshots.jsonl` (one frozen config per line)
 * plus a tiny `active.json` pointer. The append-only log is the version history;
 * the pointer is the champion. Promote/rollback only ever rewrites the pointer.
 */
export class FileConfigStore implements ConfigStore {
  private readonly snapshotsPath: string;
  private readonly activePath: string;

  constructor(dir: string) {
    this.snapshotsPath = join(dir, "snapshots.jsonl");
    this.activePath = join(dir, "active.json");
  }

  load() {
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

  appendSnapshot(config: AgentConfig) {
    this.ensureDir(this.snapshotsPath);
    appendFileSync(this.snapshotsPath, `${JSON.stringify(config)}\n`);
  }

  saveActive(id: string) {
    this.ensureDir(this.activePath);
    writeFileSync(this.activePath, `${JSON.stringify({ activeId: id }, null, 2)}\n`);
  }

  private ensureDir(filePath: string) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}
