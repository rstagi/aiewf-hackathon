// ─────────────────────────────────────────────────────────────────────────────
// Context frame — a lightweight record of what the agent did this turn (which tools it
// called, the answer, token usage). Rendered by the inspector panel and logged locally.
// (When SIA lands, this also becomes the usage signal it learns from.)
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolCallRecord {
  toolId: string;
  args: unknown;
  result: string;
}

export type TurnOutcome = "answered" | "tool";

export interface ContextFrame {
  turnId: string;
  ts: number;
  model: string;
  systemPrompt: string;
  userQuery: string;
  toolCalls: ToolCallRecord[];
  answer: string;
  steps: number;
  tokens?: { input: number; output: number; total: number };
  outcome: TurnOutcome;
}

export function buildContextFrame(
  base: { model: string; systemPrompt: string; userQuery: string },
  end: {
    toolCalls: ToolCallRecord[];
    answer: string;
    steps: number;
    tokens?: { input: number; output: number; total: number };
  },
): ContextFrame {
  return {
    turnId: `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    ts: Date.now(),
    ...base,
    toolCalls: end.toolCalls,
    answer: end.answer,
    steps: end.steps,
    tokens: end.tokens,
    outcome: end.toolCalls.length > 0 ? "tool" : "answered",
  };
}
