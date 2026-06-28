/**
 * Retrieval-quality signals (§3.2 signal 1): success@k and MRR over the tools the
 * agent actually invoked, using the retrieval rank joined onto each ToolCall.
 */

import type { Session } from "../types";

function invokedCalls(session: Session) {
  return session.toolCalls.filter((c) => c.startTs !== undefined);
}

/** Fraction of invoked tools that were within the top-k of a preceding search. */
export function successAtK(session: Session, k = 5): number | undefined {
  const calls = invokedCalls(session);
  if (calls.length === 0) return undefined;
  const within = calls.filter((c) => c.retrievalRank !== undefined && c.retrievalRank <= k).length;
  return within / calls.length;
}

/** Mean reciprocal rank over invoked tools that were joined to a search. */
export function mrr(session: Session): number | undefined {
  const ranked = invokedCalls(session).filter((c) => c.retrievalRank !== undefined);
  if (ranked.length === 0) return undefined;
  return ranked.reduce((acc, c) => acc + 1 / (c.retrievalRank as number), 0) / ranked.length;
}
