/**
 * Pure aggregation of per-session resolution verdicts into a report section.
 *
 * The resolution judge (Claude Haiku, behind the `ResolutionJudge` port) scores each session's
 * transcript against the frozen rubric (see `rubric.ts`), returning a binary verdict with
 * confidence + reasoning + evidence. This module folds those per-session verdicts into a
 * corpus-level `ResolutionReport`: resolved rate with a Wilson 95% CI, mean confidence, and the
 * per-session verdicts kept for display.
 *
 * Statistical honesty:
 *  - ONE observation per session (clean unit-of-analysis — §10): a per-session binary verdict,
 *    so the binomial Wilson interval applies directly. Duplicate session ids are deduped
 *    (first-seen wins) to guarantee that invariant.
 *  - This is a DESCRIPTIVE transcript-channel dimension, NOT a join onto the trace funnel/grid.
 *    Trace and transcript are disjoint, non-joinable populations (memory: `ratel-trace-no-turn-text`),
 *    so `grid.resolvedRate` stays dormant; resolution surfaces as its own report section. No
 *    significance is claimed against the trace dimensions here.
 *
 * Model-free and side-effect-free so it is golden-testable; the network call lives behind the port.
 */

import type { ResolutionVerdict } from "../types";
import { wilsonCI } from "../../stats/proportions";

/** One session's resolution verdict, as collected by the detector. */
export interface SessionVerdict {
  sessionId: string;
  verdict: ResolutionVerdict;
}

/** A verdict flattened with its session id, for display. */
export interface ResolutionVerdictRow {
  sessionId: string;
  resolved: 0 | 1;
  confidence: number;
  reasoning: string;
  evidence_span: string;
}

export interface ResolutionReport {
  /** Distinct sessions that received a verdict. */
  sessionsJudged: number;
  resolvedSessions: number;
  unresolvedSessions: number;
  /** resolvedSessions / sessionsJudged (0 when none judged). */
  resolvedRate: number;
  /** Wilson 95% score interval for the resolved rate; [0,1] when nothing judged. */
  resolvedRateCI: [number, number];
  /** Mean judge confidence across the judged sessions (0 when none). */
  meanConfidence: number;
  /** Per-session verdicts, unresolved-first then most-confident-first (actionable view). */
  verdicts: ResolutionVerdictRow[];
  /**
   * Which judge produced these verdicts (e.g. "Claude Haiku 4.5", "Flow-Judge v0.1"). Metadata for
   * report provenance — set by the detector from the injected judge's `label`, not by this pure
   * aggregation (which is judge-agnostic). Optional so existing callers/fakes need not supply it.
   */
  judge?: string;
  /**
   * Operational telemetry attached by the detector (not by this pure aggregation): how many
   * transcript-bearing sessions the judge was RUN over (`sessionsAttempted` ≥ `sessionsJudged`),
   * how many of those FAILED (endpoint error / unparseable verdict), and one representative error.
   * These let the UI surface a judge failure instead of silently dropping the whole section.
   */
  sessionsAttempted?: number;
  sessionsFailed?: number;
  failureSample?: string;
}

/**
 * Fold per-session verdicts into a corpus report. Each input is one judged session; a repeated
 * session id is counted once (first-seen verdict wins) so the unit-of-analysis stays per-session.
 */
export function aggregateResolution(results: SessionVerdict[]): ResolutionReport {
  const bySession = new Map<string, ResolutionVerdictRow>();
  for (const { sessionId, verdict } of results) {
    if (bySession.has(sessionId)) continue; // first-seen wins; one obs per session
    bySession.set(sessionId, {
      sessionId,
      resolved: verdict.resolved === 1 ? 1 : 0,
      confidence: Number.isFinite(verdict.confidence) ? verdict.confidence : 0,
      reasoning: typeof verdict.reasoning === "string" ? verdict.reasoning : "",
      evidence_span: typeof verdict.evidence_span === "string" ? verdict.evidence_span : "",
    });
  }

  const rows = [...bySession.values()];
  const sessionsJudged = rows.length;
  const resolvedSessions = rows.filter((r) => r.resolved === 1).length;
  const unresolvedSessions = sessionsJudged - resolvedSessions;
  const resolvedRate = sessionsJudged > 0 ? resolvedSessions / sessionsJudged : 0;
  const meanConfidence =
    sessionsJudged > 0 ? rows.reduce((sum, r) => sum + r.confidence, 0) / sessionsJudged : 0;

  // Actionable display order: unresolved before resolved; within a group, most confident first.
  rows.sort(
    (a, b) =>
      a.resolved - b.resolved || b.confidence - a.confidence || a.sessionId.localeCompare(b.sessionId),
  );

  return {
    sessionsJudged,
    resolvedSessions,
    unresolvedSessions,
    resolvedRate,
    resolvedRateCI: wilsonCI(resolvedSessions, sessionsJudged),
    meanConfidence,
    verdicts: rows,
  };
}
