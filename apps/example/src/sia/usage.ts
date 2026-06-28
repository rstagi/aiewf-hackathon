// ─────────────────────────────────────────────────────────────────────────────
// PLACEHOLDER SDK SEAM — usage reporting.
//
// The agent reports how it used the catalog so the Cloud can cluster misses into intents
// and propose skills. Today we append one context frame per turn to a gitignored local
// JSONL; this is the corpus the Cloud's Jaccard clusterer will consume once wired.
//   TODO(sdk): replace with @sia/sdk emitTraces(...) → POST /api/traces.
// ─────────────────────────────────────────────────────────────────────────────
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import type { ContextFrame } from "./context-frame";
import { EXAMPLE_USAGE_PATH, RUNTIME_DIR } from "./env";

export function reportUsage(frame: ContextFrame): void {
  try {
    if (!existsSync(RUNTIME_DIR)) mkdirSync(RUNTIME_DIR, { recursive: true });
    appendFileSync(EXAMPLE_USAGE_PATH, JSON.stringify(frame) + "\n");
  } catch (err) {
    // Usage reporting is best-effort; never let it break a turn.
    console.warn("[sia] reportUsage failed:", err instanceof Error ? err.message : err);
  }
}
