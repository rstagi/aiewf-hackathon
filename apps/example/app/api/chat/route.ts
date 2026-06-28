import { runAgentTurn, type ChatMessage } from "@/src/agent/runtime";

// The agent uses the Anthropic provider — Node runtime only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatRequestBody {
  messages: ChatMessage[];
}

export async function POST(req: Request): Promise<Response> {
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: "messages[] required" }, { status: 400 });
  }

  try {
    const { answer, frame } = await runAgentTurn({ messages: body.messages });
    return Response.json({ answer, frame });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[example] chat turn failed:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
