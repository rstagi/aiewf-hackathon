/**
 * Resolution rubric — frozen verbatim from the RFC (Appendix B).
 *
 * This is the grading prompt the resolution judge runs as its system prompt: score 1 if
 * the assistant fully accomplished the user's goal, 0 otherwise, forcing a structured
 * `{resolved, confidence, reasoning, evidence_span}` verdict. It keys on the §3.4 behavioral
 * proxies (re-ask / escalation / abandonment), so those proxies CANNOT later validate the
 * judge — only exogenous thumbs/CSAT can (calibration is deferred until such labels exist).
 *
 * Framework-free AND SDK-free: the string lives here so the pure engine can reference it
 * (e.g. tests asserting the contract) without importing the Claude adapter. The adapter in
 * `lib/intelligence-claude.ts` imports this constant as its system prompt. Treat the text as
 * a frozen contract — change it only deliberately, since it is the distillation teacher's prompt.
 */
export const RESOLUTION_RUBRIC = `You are grading whether an AI assistant resolved the user's request in a transcript.

# Input
- The full conversation transcript (user turns, assistant turns, tool calls + results).

# Criteria
RESOLVED (score 1): the assistant's final state fully accomplished what the user
actually asked for — the goal is met, not merely acknowledged or partially advanced.
UNRESOLVED (score 0): the user's goal was not met — wrong answer, gave up, the user
had to rephrase/correct, escalated, ABANDONED the session, or the tool result was
never turned into a solution.

# Output (structured)
- resolved: 0 or 1
- confidence: 0.0–1.0
- reasoning: 1–3 sentences citing the decisive moment
- evidence_span: the transcript span that determined the verdict

# Notes
- Judge goal completion, NOT politeness or faithfulness. A grounded, well-written
  answer that does not solve the request is UNRESOLVED.
- If the user re-asked the same thing later in the session, lean UNRESOLVED for the
  earlier attempt.`;
