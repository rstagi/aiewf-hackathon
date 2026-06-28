/**
 * The trace envelope + event union moved into the shared wire contract
 * (@sia/contract) so the SDK (emit) and the engine (ingest) agree on ONE definition
 * (PLAN risk #1). This module re-exports it so the rest of the intelligence tree can
 * keep importing from "./events" unchanged.
 */
export { parseLine, parseTraceJsonl, NOISE_TYPES, isNoise } from "@sia/contract";
export type {
  SearchHit,
  SkillHit,
  SearchStage,
  TraceEvent,
  TraceEnvelope,
  ExtendedTraceEnvelope,
  TraceAttribution,
  Arm,
} from "@sia/contract";
