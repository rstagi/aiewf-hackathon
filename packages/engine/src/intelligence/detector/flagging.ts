/**
 * Flag emission (§4.3, §4.4) — the confound-disciplined detections.
 *
 * Phase-0 (model-free) flags:
 *  - funnel_leak + the three-way intent split (§4.4c): a cluster whose found→invoke
 *    conversion is significantly below the pooled rate of all OTHER clusters
 *    (Fisher exact, BY-FDR across clusters, event + effect-size gated), classified into
 *    "no capability → build" vs "exists but unused → tune description".
 *  - tool_high_error and tool_retrieved_never_invoked (from the inventory quadrant).
 *  - oscillation (per session).
 *
 * Sentiment (a) and resolution (b) flags arrive with the Phase 1/2 models.
 */

import type { GatewaySignals, InventoryEntry } from "../types";
import { twoProportionTest } from "../stats/proportions";
import { signedEffectGate, rankByEffect } from "../stats/gating";
import { benjaminiYekutieli } from "../stats/multiplicity";
import type { DetectionConfig, Flag, IntentFunnel } from "./types";

export function buildFlags(args: {
  funnel: IntentFunnel[];
  inventory: InventoryEntry[];
  signals: GatewaySignals[];
  config: DetectionConfig;
}): Flag[] {
  const { funnel, inventory, signals, config } = args;
  const flags: Flag[] = [];

  // ── Intent funnel leaks: each cluster's found→invoke vs the pooled rate of others ──
  const eligible = funnel.filter((f) => f.searched >= config.minClusterSearches && f.found > 0);
  const totalInvoked = eligible.reduce((a, f) => a + f.invoked, 0);
  const totalFound = eligible.reduce((a, f) => a + f.found, 0);

  const candidates = eligible
    .map((f) => {
      const othersInvoked = totalInvoked - f.invoked;
      const othersFound = totalFound - f.found;
      const othersRate = othersFound ? othersInvoked / othersFound : 0;
      const effect = f.invokeRate - othersRate; // signed risk difference
      const { p } = twoProportionTest(f.invoked, f.found, othersInvoked, othersFound);
      return { f, effect, p, othersRate };
    })
    .filter(
      (c) =>
        c.effect < 0 && // underperforming
        c.f.found >= config.minCellEvents && // enough denominator (Fisher is exact near 0/1, so no normal-approx gate)
        signedEffectGate(c.effect, config.minEffect),
    );

  if (candidates.length > 0) {
    const { rejected } = benjaminiYekutieli(candidates.map((c) => c.p), config.fdrQ);
    candidates.forEach((c, i) => {
      if (!rejected[i]) return;
      const lowConfidence = c.f.medianTopScoreNorm < config.lowConfidenceTopScore;
      flags.push({
        kind: lowConfidence ? "intent_no_capability" : "intent_tune_description",
        intentCluster: c.f.clusterId,
        intentLabel: c.f.label,
        funnelStage: "invoked",
        effectSize: c.effect,
        effectKind: "risk_difference_vs_pooled",
        direction: "-",
        pValue: c.p,
        qValue: config.fdrQ,
        n: c.f.found,
        reason: `Intent "${c.f.label}" converts found→invoke at ${pct(c.f.invokeRate)} vs ${pct(c.othersRate)} for other intents (median top-score ${c.f.medianTopScoreNorm.toFixed(2)}).`,
        recommendation: lowConfidence
          ? "Retrieval confidence is low/flat — likely no well-matched capability. Consider BUILDING a tool for this intent."
          : "A candidate is retrieved but rarely invoked — TUNE its description/ranking so the model selects it.",
      });
    });
  }

  // ── Tool-health flags from the inventory quadrant ──
  for (const e of inventory) {
    if (e.quadrant === "high_error" && e.invokedCount >= config.minToolInvocations) {
      const rate = e.errorCount / e.invokedCount;
      flags.push(toolFlag("tool_high_error", e, rate, "error_rate", e.invokedCount,
        `Tool ${e.toolId} errors on ${pct(rate)} of ${e.invokedCount} invocations.`,
        "Review this tool's reliability / error handling."));
    }
    if (e.quadrant === "retrieved_never_invoked" && e.retrievedCount >= config.minToolInvocations) {
      flags.push(toolFlag("tool_retrieved_never_invoked", e, e.retrievedCount, "retrieved_count", e.retrievedCount,
        `Tool ${e.toolId} was retrieved ${e.retrievedCount}× but never invoked.`,
        "Either the description oversells it (retrieved for the wrong intents) or it's redundant — review/prune."));
    }
  }

  // ── Oscillation (per session) ──
  for (const g of signals) {
    if (g.perSession.oscillation) {
      flags.push({
        kind: "oscillation",
        effectSize: 1,
        effectKind: "boolean",
        direction: "+",
        n: g.perCall.length,
        reason: `Session ${g.sessionId}: ${g.perSession.oscillationDetail}`,
        recommendation: "Repeated identical/cyclic calls waste turns — check for a stuck loop or a tool that doesn't advance state.",
      });
    }
  }

  // Rank by |effect size| (never q×effect).
  return rankByEffect(flags, (f) => f.effectSize);
}

function toolFlag(
  kind: Flag["kind"],
  e: InventoryEntry,
  effectSize: number,
  effectKind: string,
  n: number,
  reason: string,
  recommendation: string,
): Flag {
  return { kind, toolId: e.toolId, effectSize, effectKind, direction: "-", n, reason, recommendation };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`;
}
