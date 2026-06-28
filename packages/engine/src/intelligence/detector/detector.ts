/**
 * runDetector — the cross-reference engine entry point (§4).
 *
 * Composes the deterministic layers into a DetectionReport. Models enter via
 * DetectorDeps (DI): in Phase 0 only `clusterer` is supplied, so sentiment/resolution
 * flags and the grid's resolved column are cleanly omitted. Async for forward-compat
 * with the Phase 1/2 model calls.
 */

import type { Session } from "../types";
import { computeGatewaySignals } from "../signals/index";
import { computeInventory } from "../signals/inventory";
import { buildFunnel, countAbandoned } from "./funnel";
import { buildGrid } from "./grid";
import { buildFlags } from "./flagging";
import { aggregateClaimIntents, type SessionExtraction } from "../dimensions/claims/aggregate";
import { clusterUnifiedIntents, type SourcedIntent } from "../dimensions/intent/unified";
import { aggregateResolution, type SessionVerdict } from "../dimensions/resolution/aggregate";
import { DEFAULT_CONFIG, type DetectionConfig, type DetectionReport, type DetectorDeps } from "./types";

export async function runDetector(
  input: { sessions: Session[] },
  deps: DetectorDeps,
  config: Partial<DetectionConfig> = {},
): Promise<DetectionReport> {
  const cfg: DetectionConfig = { ...DEFAULT_CONFIG, ...config };
  const { sessions } = input;

  const allSearches = sessions.flatMap((s) => s.searches);
  const clustering = deps.clusterer.cluster(allSearches);

  const signals = sessions.map(computeGatewaySignals);
  const funnel = buildFunnel(sessions, clustering);
  const grid = buildGrid(sessions, clustering);
  const inventory = computeInventory(sessions);
  const flags = buildFlags({ funnel, inventory, signals, config: cfg });

  // Phase 1/2 hooks: when models are injected, enrich here (sentiment deltas → grid;
  // resolution verdicts → grid.resolvedRate + question (a)/(b) flags).
  // if (deps.sentiment) { ... }
  // if (deps.resolution) { ... }

  // Transcript-channel claim/intent dimension (Orbitals extractor). Runs only over
  // sessions that actually carry turn text; trace-only sessions are skipped. Surfaced as
  // its own report section — it does NOT join the trace funnel (disjoint populations).
  let claimIntel: DetectionReport["claimIntel"];
  const transcriptExtractions: SessionExtraction[] = [];
  if (deps.claimIntent) {
    const withTranscript = sessions.filter((s) => s.turns.length > 0);
    for (const s of withTranscript) {
      try {
        const result = await deps.claimIntent.extract(s.turns);
        transcriptExtractions.push({ sessionId: s.sessionId, result });
      } catch {
        // A single extraction failure must not sink the whole report; skip that session.
      }
    }
    if (transcriptExtractions.length > 0) claimIntel = aggregateClaimIntents(transcriptExtractions);
  }

  // Transcript-channel resolution dimension (Claude Haiku judge). Mirrors the claim/intent block:
  // runs only over sessions that carry turn text, one verdict per session, per-session failures
  // are non-fatal. Surfaced as its own section — it does NOT fill grid.resolvedRate, which would
  // assert the per-session trace↔transcript join the disjoint populations can't support
  // (memory: `ratel-trace-no-turn-text`). Independent of claimIntent, so it recomputes its own
  // transcript-bearing session set.
  let resolutionIntel: DetectionReport["resolutionIntel"];
  if (deps.resolution) {
    const withTurns = sessions.filter((x) => x.turns.length > 0);
    const sessionVerdicts: SessionVerdict[] = [];
    const failures: { sessionId: string; error: string }[] = [];
    for (const s of withTurns) {
      try {
        const verdict = await deps.resolution.judge(s.turns);
        sessionVerdicts.push({ sessionId: s.sessionId, verdict });
      } catch (err) {
        // A single judge failure (LLM 5xx/timeout, context-length 400, unparseable verdict) must
        // not sink the report — but we no longer swallow it silently. Capture it so the section can
        // SURFACE the failure (below) instead of vanishing, which is indistinguishable from
        // "no transcripts to judge". Root cause this addresses: Flow-Judge's 4096-token cap returns
        // a clean 400 on long transcripts (memory-adjacent: the card sometimes silently disappeared).
        failures.push({ sessionId: s.sessionId, error: err instanceof Error ? err.message : String(err) });
      }
    }
    // Surface the section whenever the judge was ATTEMPTED on at least one transcript-bearing
    // session, even if every attempt failed (then sessionsJudged === 0 and the UI shows a failure
    // banner instead of a misleading 0/0 rate). Only a genuinely empty transcript population
    // (withTurns.length === 0) leaves resolutionIntel undefined → correctly no card.
    if (withTurns.length > 0) {
      resolutionIntel = {
        ...aggregateResolution(sessionVerdicts),
        sessionsAttempted: withTurns.length,
        sessionsFailed: failures.length,
        ...(failures[0] ? { failureSample: failures[0].error } : {}),
        // Attach judge provenance so the report can show which judge produced (or failed on) these.
        ...(deps.resolution.label ? { judge: deps.resolution.label } : {}),
      };
    }
  }

  // Unified cross-source intent clustering (LLM). Folds intents from BOTH substrates —
  // trace `Search.query` text AND the transcript intents just extracted — into one semantic
  // list. Descriptive bridge across the disjoint populations; not joined per-session.
  let unifiedIntel: DetectionReport["unifiedIntel"];
  if (deps.unifiedClusterer) {
    const sourced: SourcedIntent[] = [];
    for (const s of sessions) {
      for (const search of s.searches) {
        if (search.query?.trim()) {
          sourced.push({ text: search.query, source: "search", sessionId: s.sessionId });
        }
      }
    }
    for (const { sessionId, result } of transcriptExtractions) {
      for (const intent of result.intents ?? []) {
        if (intent.content?.trim()) {
          sourced.push({ text: intent.content, source: "transcript", sessionId });
        }
      }
    }
    if (sourced.length > 0) {
      try {
        unifiedIntel = await clusterUnifiedIntents(sourced, deps.unifiedClusterer);
      } catch {
        // A clusterer failure (LLM 5xx/timeout) must not sink the rest of the report.
      }
    }
  }

  return {
    sessionsAnalyzed: sessions.length,
    searchesAnalyzed: allSearches.length,
    clusters: clustering.clusters,
    funnel: funnel.sort((a, b) => b.searched - a.searched),
    grid: grid.sort((a, b) => b.n - a.n),
    inventory: inventory.sort((a, b) => b.invokedCount - a.invokedCount),
    flags,
    ...(claimIntel ? { claimIntel } : {}),
    ...(unifiedIntel ? { unifiedIntel } : {}),
    ...(resolutionIntel ? { resolutionIntel } : {}),
    censored: {
      abandonedSessions: countAbandoned(sessions),
      note: "Abandoned sessions (searched, never invoked) are mapped to non-conversion, not dropped (§4.1).",
    },
    config: cfg,
  };
}
