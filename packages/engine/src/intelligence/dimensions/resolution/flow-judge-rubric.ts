/**
 * Resolution rubric, re-expressed in Flow-Judge's evaluation format.
 *
 * Flow-Judge (`flowaicom/Flow-Judge-v0.1`, a Phi-3.5-mini fine-tune) is trained on a fixed
 * prompt template with `<evaluation_criteria>` and `<scoring_rubric>` sections and emits a
 * `<feedback>`/`<score>` pair — it does NOT take the Claude judge's system prompt (which carries
 * JSON-output instructions that would fight Flow-Judge's own output format). So the SAME §3.4
 * resolution criteria as the frozen `RESOLUTION_RUBRIC` are distilled here into Flow-Judge's
 * native shape: a binary 0/1 scoring rubric. The two rubrics MUST stay semantically aligned —
 * both judge goal completion (not politeness), both key on re-ask / escalate / abandon, both
 * binarize to resolved=1 / unresolved=0 — so the resolved rate means the same thing whichever
 * judge produced it.
 *
 * Framework-free AND SDK-free, like `rubric.ts`: the strings live in the pure engine so tests can
 * assert the contract without importing the HTTP adapter (`lib/intelligence-flow-judge.ts`), which
 * fills these into the Flow-Judge prompt template. Treat the text as a frozen contract.
 */

/** Flow-Judge `<evaluation_criteria>`: what the judge must assess (mirrors RESOLUTION_RUBRIC's Notes). */
export const FLOW_JUDGE_CRITERIA = `Did the AI assistant fully resolve the user's request in this transcript — that is, accomplish what the user actually asked for? Judge goal completion, NOT politeness or faithfulness: a grounded, well-written answer that does not solve the request is unresolved.`;

/** Flow-Judge `<scoring_rubric>`: binary score-level descriptions (mirrors RESOLUTION_RUBRIC's Criteria). */
export const FLOW_JUDGE_RUBRIC = `- Score 0 (UNRESOLVED): The user's goal was not met — wrong answer, the assistant gave up, the user had to rephrase/correct, the request was escalated, the user ABANDONED the session, or the tool result was never turned into a solution. If the user re-asked the same thing later in the session, score the conversation 0.
- Score 1 (RESOLVED): The assistant's final state fully accomplished what the user actually asked for — the goal is met, not merely acknowledged or partially advanced.`;
