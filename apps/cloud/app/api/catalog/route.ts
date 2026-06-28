import { NextResponse } from "next/server";
import type {
  ApiResponse,
  ConfigDraft,
  IngestCatalogRequest,
  IngestCatalogResponseData,
} from "@sia/contract";
import { requireApiKey } from "@/lib/auth";
import { getRegistry } from "@/lib/registry";

export const runtime = "nodejs";

/**
 * Ingest a catalog surface: mint (or dedup to) a content-hashed version and set it active in
 * one step. Lets the demo / a developer seed a chosen corpus over the API rather than relying
 * on the auto-seeded genesis. Immutable + content-addressed — re-ingesting the same surface
 * collapses to the same id.
 */
export async function POST(req: Request): Promise<NextResponse<ApiResponse<IngestCatalogResponseData>>> {
  const denied = requireApiKey(req);
  if (denied) return denied;

  let body: IngestCatalogRequest;
  try {
    body = (await req.json()) as IngestCatalogRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const draft = body?.draft as ConfigDraft | undefined;
  if (
    !draft ||
    typeof draft.systemPrompt !== "string" ||
    !Array.isArray(draft.skills) ||
    !Array.isArray(draft.tools) ||
    typeof draft.modelDefault !== "string" ||
    !draft.skills.every((s) => s && typeof s.skillId === "string" && typeof s.description === "string")
  ) {
    return NextResponse.json(
      { ok: false, error: "Expected { draft: { systemPrompt, skills: [{ skillId, description }], tools[], modelDefault } }" },
      { status: 400 },
    );
  }

  const reg = await getRegistry();
  const config = await reg.register(draft); // mint or dedup — no lineage (a fresh catalog)
  await reg.setActive(config.id); // make it the champion
  return NextResponse.json({ ok: true, config });
}
