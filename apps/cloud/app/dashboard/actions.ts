"use server";

import { existsSync, unlinkSync } from "node:fs";
import { revalidatePath } from "next/cache";
import { applyChange, promote } from "@/lib/registry";
import { DEMO_LEAK_SKILL_ID, IMPROVED_LEAK_DESC } from "@/lib/levers";
import { TRACES_PATH } from "@/lib/paths";

/**
 * The Phase-2 money beat: rewrite the leaking skill's description (lever 1) in a child
 * snapshot and promote it — a pure pointer flip. The example app's code never changes;
 * its next JIT fetch retrieves the new description, so the password-reset cluster now
 * clears the invoke floor and the `intent_tune_description` flag clears.
 *
 * In-process (no HTTP), so this trusted operator action bypasses the inbound-key guard.
 * Idempotent: re-running re-derives the same content-hashed child and re-promotes it.
 */
export async function improveAndPromote(): Promise<void> {
  const child = applyChange({ kind: "rewrite_skill_desc", skillId: DEMO_LEAK_SKILL_ID, to: IMPROVED_LEAK_DESC });
  promote(child.id);
  revalidatePath("/dashboard");
}

/**
 * Truncate the trace log for a clean before/after. Session ids are deterministic, so a
 * re-run would otherwise append onto the same sessions and muddy the funnel. Deletes
 * ONLY traces — the registry (and the promoted pointer) is untouched.
 */
export async function clearTraces(): Promise<void> {
  if (existsSync(TRACES_PATH)) unlinkSync(TRACES_PATH);
  revalidatePath("/dashboard");
}
