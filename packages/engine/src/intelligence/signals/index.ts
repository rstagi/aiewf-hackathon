/**
 * computeGatewaySignals — assemble the deterministic per-call / per-search / per-session
 * gateway-native signals (§3.2) for one session. This is the model-free differentiated
 * layer the Detector consumes.
 */

import type { Session, GatewaySignals, PerCallSignal, PerSearchSignal, SessionSignal } from "../types";
import { topAndMargin } from "./normalize";
import { detectArgRepairs } from "./repair";
import { detectOscillation } from "./loops";
import { skillSignals } from "./skills";
import { successAtK, mrr } from "./retrieval";

/** True if any auth_needs had no later successful refresh/flow_end for that upstream. */
function authNeededUnresolved(session: Session): boolean {
  const needs = session.authEvents.filter((a) => a.kind === "needs");
  return needs.some(
    (n) =>
      !session.authEvents.some(
        (a) =>
          a.upstream === n.upstream &&
          a.ts >= n.ts &&
          ((a.kind === "refresh" && a.ok) || (a.kind === "flow_end" && a.ok)),
      ),
  );
}

export function computeGatewaySignals(session: Session): GatewaySignals {
  const repairs = detectArgRepairs(session);

  const perCall: PerCallSignal[] = session.toolCalls.map((c, i) => ({
    toolId: c.toolId,
    status: c.status,
    errorCategory: c.errorCategory,
    retrievalRank: c.retrievalRank,
    isArgRepair: repairs[i],
    server: c.server,
  }));

  const perSearch: PerSearchSignal[] = session.searches.map((s) => {
    const { topScoreNorm, rank1MinusRank2 } = topAndMargin(s.hits);
    return {
      query: s.query,
      ts: s.ts,
      topScoreNorm,
      rank1MinusRank2,
      zeroHit: s.hits.length === 0 && (s.hitCount ?? 0) === 0,
      hitCount: s.hits.length || s.hitCount || 0,
      foundNotInvoked: s.foundNotInvoked,
    };
  });

  const osc = detectOscillation(session);
  const perSession: SessionSignal = {
    sessionId: session.sessionId,
    oscillation: osc.oscillation,
    oscillationDetail: osc.detail,
    skillFetched: skillSignals(session).skillFetched,
    authNeededUnresolved: authNeededUnresolved(session),
    successAtK: successAtK(session),
    mrr: mrr(session),
  };

  return { sessionId: session.sessionId, perCall, perSearch, perSession };
}
