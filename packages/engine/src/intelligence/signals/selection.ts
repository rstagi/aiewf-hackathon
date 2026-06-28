/**
 * Selection signal (§3.2 signal 2): tools retrieved but never invoked, aggregated
 * across a session's searches.
 */

import type { Session } from "../types";

export function foundNotInvoked(session: Session): string[] {
  const set = new Set<string>();
  for (const s of session.searches) for (const id of s.foundNotInvoked) set.add(id);
  return [...set];
}
