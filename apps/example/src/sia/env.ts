// ─────────────────────────────────────────────────────────────────────────────
// Repo-root resolution + env bootstrap.
//
// The ANTHROPIC_API_KEY lives in the monorepo-root `.env.local`, but Next.js only
// auto-loads env files from the app's own directory (apps/example). Rather than
// duplicate the secret, we load the repo-root `.env.local` into process.env on first
// import (without overwriting anything already set). Server-side only.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Walk up from cwd until we find pnpm-workspace.yaml (the repo root); fall back to cwd. */
export function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const REPO_ROOT = findRepoRoot();
export const RUNTIME_DIR = path.join(REPO_ROOT, "data", "runtime");
/** Where the local per-turn log is written (gitignored). TODO(sdk): replaced by emitTraces → Cloud. */
export const EXAMPLE_USAGE_PATH = path.join(RUNTIME_DIR, "example-usage.jsonl");

/** Parse and load `<repo>/.env.local` into process.env, never overwriting existing values. */
export function loadRepoEnv(): void {
  const file = path.join(REPO_ROOT, ".env.local");
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

// Load eagerly so any importer (the runtime, the route) has the key available.
loadRepoEnv();
