// ─────────────────────────────────────────────────────────────────────────────
// PLACEHOLDER SDK SEAM — the skills catalog.
//
// The agent's SKILLS are owned by SIA and will be fetched from the Cloud once it's ready.
// Until then the catalog is intentionally EMPTY — the agent runs as a normal assistant with
// its own tools (see ../agent/tools.ts). Nothing seeds skills here; only SIA fills the catalog.
//   TODO(sdk): fetchCatalog() → @sia/sdk fetchActiveConfig(); skills (with bodies) arrive from SIA.
//
// Target skills SIA should discover from usage (the tools in ../agent/tools.ts are prepped for them):
//   • split-bill      — compose calculator + currency_convert (sum → tip → convert → split); forces
//                        tool-grounded math instead of mental arithmetic.
//   • daily-briefing  — compose current_datetime → get_calendar → get_weather into a fixed-format
//                        briefing (schedule, weather + what to wear, conflicts/gaps, top priority).
//   • trip-day-plan   — compose web_search + get_weather(date) + currency_convert + calculator into a
//                        day plan with a budget.
//   • TODO(sia) one-on-one-prep / interview-prep — pure-knowledge skill, no tools (Type-1 intent).
// ─────────────────────────────────────────────────────────────────────────────

/** A skill as it will live on the SIA-managed catalog (none today). */
export interface CatalogSkill {
  skillId: string;
  name: string;
  description: string;
  tags: string[];
  body: string;
}

export interface ResolvedCatalog {
  systemPrompt: string;
  modelDefault: string;
  /** Empty until SIA starts authoring skills. */
  skills: CatalogSkill[];
}

const SYSTEM_PROMPT =
  "You are a warm, concise personal assistant. Help the user with whatever they ask. " +
  "You have a few tools available — use them when they are genuinely useful (math, the current " +
  "date/time, weather, or web lookups); otherwise just answer directly and helpfully.";

const MODEL_DEFAULT = "claude-sonnet-4-5";

export function fetchCatalog(): ResolvedCatalog {
  return { systemPrompt: SYSTEM_PROMPT, modelDefault: MODEL_DEFAULT, skills: [] };
}
