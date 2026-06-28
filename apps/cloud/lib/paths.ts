import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Walk up from cwd looking for the dir containing `pnpm-workspace.yaml` (the repo
 * root); fall back to cwd. cwd is `apps/cloud` when run via
 * `pnpm --filter @sia/cloud dev`, so a fixed relative path is fragile — search up.
 */
export function findRepoRoot(): string {
  let dir = process.cwd();
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/** Runtime data lives at repo-root `data/runtime/` (gitignored). */
export const RUNTIME_DIR = path.join(findRepoRoot(), "data", "runtime");
export const TRACES_PATH = path.join(RUNTIME_DIR, "traces.jsonl");
export const REGISTRY_DIR = path.join(RUNTIME_DIR, "registry");
/** Self-healing proposals, file-store fallback (a single JSON array). */
export const PROPOSALS_PATH = path.join(RUNTIME_DIR, "proposals.json");
