// ─────────────────────────────────────────────────────────────────────────────
// Context frame — the host-side record of what the agent did this turn.
//
// Phase 3 adopts the CANONICAL `@sia/sdk` ContextFrame: a lossless superset of the
// simpler frame this file used to define (it adds the retrieval dimension —
// `floor`/`retrieved`/`invokedSkillIds`/`invokedBodies` — on top of the example's
// `toolCalls`/`answer`/`steps`/`tokens`). Re-exported here so the existing import sites
// (the runtime, the inspector UI) keep importing from one local module while the type
// itself stays owned by the SDK (and, in Phase 4, crosses HTTP to the inspector).
// ─────────────────────────────────────────────────────────────────────────────

export { captureContextFrame, resolveSkillBody } from "@sia/sdk";
export type {
  ContextFrame,
  ToolCallRecord,
  RetrievedSkill,
  FrameOutcome,
  RetrievalHit,
  CaptureFrameInput,
} from "@sia/sdk";
