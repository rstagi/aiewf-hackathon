import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { findRepoRoot } from "./paths";

/**
 * The ANTHROPIC_API_KEY lives in the monorepo-root `.env.local`, but Next.js only auto-loads
 * env files from the app's own directory (apps/cloud). Rather than duplicate the secret, load
 * the repo-root `.env.local` into process.env on demand, never overwriting anything already set.
 * Server-side only. Idempotent.
 */
let loaded = false;

export function loadRepoEnv(): void {
  if (loaded) return;
  loaded = true;
  const file = path.join(findRepoRoot(), ".env.local");
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
