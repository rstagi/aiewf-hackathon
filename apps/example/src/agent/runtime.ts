// ─────────────────────────────────────────────────────────────────────────────
// The example agent — a normal personal assistant on the Vercel AI SDK. It exposes its
// own tools to the model and runs a multi-step tool loop. (Skills are a separate,
// currently-empty catalog that SIA will fill later; see ../sia/catalog.ts.)
// ─────────────────────────────────────────────────────────────────────────────
import "../sia/env"; // load repo-root .env.local (ANTHROPIC_API_KEY) before anything else
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { fetchCatalog } from "../sia/catalog";
import { buildContextFrame, type ContextFrame, type ToolCallRecord } from "../sia/context-frame";
import { reportUsage } from "../sia/usage";
import { TOOLS } from "./tools";

const MAX_STEPS = 6;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentTurnResult {
  answer: string;
  frame: ContextFrame;
}

const asText = (v: unknown): string => (typeof v === "string" ? v : JSON.stringify(v));

export async function runAgentTurn(opts: { messages: ChatMessage[] }): Promise<AgentTurnResult> {
  const catalog = fetchCatalog();
  const userQuery = [...opts.messages].reverse().find((m) => m.role === "user")?.content ?? "";

  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = anthropic(catalog.modelDefault);

  const messages = opts.messages.map((m) => ({ role: m.role, content: m.content })) as ModelMessage[];

  const result = await generateText({
    model,
    system: catalog.systemPrompt,
    messages,
    tools: TOOLS,
    stopWhen: stepCountIs(MAX_STEPS),
  });

  // Collect every tool call across the multi-step loop for the inspector.
  const toolCalls: ToolCallRecord[] = [];
  for (const step of result.steps) {
    for (const tc of step.toolCalls) {
      const tr = step.toolResults.find((r) => r.toolCallId === tc.toolCallId);
      toolCalls.push({ toolId: tc.toolName, args: tc.input, result: tr ? asText(tr.output) : "" });
    }
  }

  const u = result.totalUsage;
  const frame = buildContextFrame(
    { model: catalog.modelDefault, systemPrompt: catalog.systemPrompt, userQuery },
    {
      toolCalls,
      answer: result.text,
      steps: result.steps.length,
      tokens: { input: u.inputTokens ?? 0, output: u.outputTokens ?? 0, total: u.totalTokens ?? 0 },
    },
  );

  reportUsage(frame);
  return { answer: result.text, frame };
}
