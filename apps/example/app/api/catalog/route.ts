import { fetchCatalogView } from "@/src/sia/catalog";
import { TOOL_INFO } from "@/src/agent/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only view of the agent's catalog: its native tools, and the SIA-managed skills. */
export async function GET(): Promise<Response> {
  const cat = await fetchCatalogView();
  return Response.json({
    configId: cat.configId,
    modelDefault: cat.modelDefault,
    tools: TOOL_INFO,
    skills: cat.skills,
  });
}
