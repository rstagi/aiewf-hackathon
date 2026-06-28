import { ToolCatalog } from "@ratel-ai/sdk";
import type { AgentConfig, SkillCatalogDef } from "@sia/contract";

/**
 * Build a Ratel `ToolCatalog` — the REAL native BM25 retriever — from an immutable
 * config snapshot.
 *
 * Each skill is registered as a retrievable capability whose searchable text folds
 * the stable `tags` into the *optimizable* `description`, so a rewritten description
 * changes BM25 ranking exactly as it would in production. We register tools (the 0.2.0
 * native binary's BM25 engine over tool docs).
 *
 * The catalog is constructed with a `memory` trace sink so the SDK can `drainTraceEvents()`
 * at end-of-run and POST the envelopes to the Cloud (emit-by-composition — there is NO
 * HTTP sink in 0.2.0). search auto-emits `search` (with hits); invoke auto-emits
 * invoke_start/end/error.
 */
export interface ToolCatalogTrace {
  /** Session id stamped on every drained envelope by the native memory sink. */
  sessionId: string;
}

/** Run a skill's body and return the agent's answer text. Injected by the caller. */
export type SkillExecutor = (skillId: string, args: Record<string, unknown>) => Promise<string>;

function searchableDescription(description: string, tags: string[]): string {
  return tags.length ? `${description} Tags: ${tags.join(", ")}.` : description;
}

export function buildToolCatalog(
  config: AgentConfig,
  defs: SkillCatalogDef,
  execute: SkillExecutor,
  trace?: ToolCatalogTrace,
): ToolCatalog {
  const catalog = new ToolCatalog(
    trace ? { trace: { kind: "memory", sessionId: trace.sessionId } } : {},
  );
  for (const snapshot of config.skills) {
    const def = defs.get(snapshot.skillId);
    // A Cloud-authored skill has NO local SkillDefinition (`def === undefined`); its name/tags
    // (and its body, used by the executor) ride on the snapshot. Prefer those, so a brand-new
    // skill is actually BM25-retrievable with no redeploy. For seed skills the snapshot carries
    // no name/tags, so this falls back to `def` and is byte-identical to before (golden stays green).
    const name = snapshot.name ?? def?.name ?? snapshot.skillId;
    const tags = snapshot.tags ?? def?.tags ?? [];
    catalog.register({
      id: snapshot.skillId,
      name,
      description: searchableDescription(snapshot.description, tags),
      inputSchema: { type: "object", properties: { utterance: { type: "string" } } },
      outputSchema: { type: "object" },
      execute: (args: Record<string, unknown>) => execute(snapshot.skillId, args),
    });
  }
  return catalog;
}
