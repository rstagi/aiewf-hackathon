import { fetchCatalog } from "@/src/sia/catalog";
import { TOOL_INFO } from "@/src/agent/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only view of the agent's catalog: its tools, and the (currently empty) skills. */
export async function GET(): Promise<Response> {
  const cat = fetchCatalog();
  return Response.json({
    modelDefault: cat.modelDefault,
    tools: TOOL_INFO,
    skills: cat.skills.map((s) => ({ skillId: s.skillId, name: s.name, description: s.description })),
  });
}
