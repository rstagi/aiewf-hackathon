/**
 * Argument-repair retry (§3.2 signal 6): a call that re-invokes a tool AFTER a prior
 * errored call to the same tool, with a DIFFERENT args size — i.e. the agent tried to
 * fix its arguments. Two consecutive successes are not a repair.
 */

import type { Session } from "../types";

/** Returns a boolean per session.toolCalls (same order): true where the call is a post-error retry. */
export function detectArgRepairs(session: Session): boolean[] {
  const calls = session.toolCalls;
  const flags = calls.map(() => false);
  for (let i = 0; i < calls.length; i++) {
    const cur = calls[i];
    for (let j = i - 1; j >= 0; j--) {
      if (calls[j].toolId !== cur.toolId) continue;
      // Most recent prior call to the same tool: repair iff it errored and args changed.
      if (calls[j].status === "error" && calls[j].argsSizeBytes !== cur.argsSizeBytes) flags[i] = true;
      break;
    }
  }
  return flags;
}
