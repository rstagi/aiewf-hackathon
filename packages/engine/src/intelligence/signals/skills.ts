/**
 * Skill signal (§3.2 signal 8): how many skill bodies were fetched (get_skill_content
 * analogue). Whether a fetched skill was actually APPLIED needs the assistant's turn
 * text to judge adherence — which trace JSONL doesn't carry (Phase 1+ with transcripts).
 */

import type { Session } from "../types";

export function skillSignals(session: Session): { skillFetched: number } {
  // TODO(phase1): join skillInvokes to subsequent turns to score fetched-but-not-applied.
  return { skillFetched: session.skillInvokes.length };
}
