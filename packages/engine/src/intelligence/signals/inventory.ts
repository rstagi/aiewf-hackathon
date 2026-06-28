/**
 * Fleet inventory health quadrant (§3.2 signal 11): aggregate each tool across all
 * sessions into a hygiene class. `never_retrieved` isn't observable from traces alone
 * (you'd need the full catalog), so the observable quadrants are covered here.
 */

import type { Session, InventoryEntry } from "../types";

const HIGH_ERROR_RATE = 0.5;

export function computeInventory(sessions: Session[]): InventoryEntry[] {
  const agg = new Map<string, { retrieved: number; invoked: number; error: number }>();
  const get = (id: string) => {
    let e = agg.get(id);
    if (!e) {
      e = { retrieved: 0, invoked: 0, error: 0 };
      agg.set(id, e);
    }
    return e;
  };

  for (const s of sessions) {
    for (const search of s.searches) for (const h of search.hits) get(h.toolId).retrieved++;
    for (const c of s.toolCalls) {
      const e = get(c.toolId);
      e.invoked++;
      if (c.status === "error") e.error++;
    }
  }

  return [...agg.entries()].map(([toolId, e]) => ({
    toolId,
    retrievedCount: e.retrieved,
    invokedCount: e.invoked,
    errorCount: e.error,
    quadrant:
      e.invoked === 0
        ? "retrieved_never_invoked"
        : e.error / e.invoked >= HIGH_ERROR_RATE
          ? "high_error"
          : "healthy",
  }));
}
