import { createHash } from "node:crypto";
import type { ConfigDraft } from "./types";

/**
 * Canonicalize a value for deterministic hashing: object keys are sorted
 * recursively and `undefined` values are dropped (so an absent optional field
 * and an explicit `undefined` hash identically), while array order is preserved
 * (array order is meaningful — e.g. catalog/skill order is part of the surface).
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

export function canonicalJSON(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Content hash of the optimizable surface only — `id` and `parentId` are
 * deliberately excluded so that identical surfaces collapse to one id (clean
 * dedup) and a rollback that re-creates an ancestor surface resolves back to the
 * ancestor's id instead of minting a duplicate.
 */
export function contentHash(draft: ConfigDraft): string {
  const surface = {
    systemPrompt: draft.systemPrompt,
    skills: draft.skills,
    tools: draft.tools,
    modelDefault: draft.modelDefault,
  };
  const digest = createHash("sha256").update(canonicalJSON(surface)).digest("hex");
  return `cfg_${digest.slice(0, 12)}`;
}
