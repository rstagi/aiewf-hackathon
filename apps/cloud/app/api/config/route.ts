import { NextResponse } from "next/server";
import type { ApiResponse, ApplyChangeRequest, ApplyChangeResponseData } from "@sia/contract";
import { requireApiKey } from "@/lib/auth";
import { applyChange } from "@/lib/registry";

export const runtime = "nodejs";

/**
 * Derive (or dedup) a child config snapshot by applying one optimization to a parent
 * (default: the active champion). Returns the child id — it is NOT promoted here; the
 * caller flips the active pointer via POST /api/promote. This is the programmatic seam
 * the Phase-3 optimizer drives; the dashboard uses the in-process action instead.
 */
export async function POST(
  req: Request,
): Promise<NextResponse<ApiResponse<ApplyChangeResponseData>>> {
  const denied = requireApiKey(req);
  if (denied) return denied;

  let body: ApplyChangeRequest;
  try {
    body = (await req.json()) as ApplyChangeRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const change = body?.change;
  const KNOWN_KINDS = ["rewrite_skill_desc", "set_suggested_model"];
  if (!change?.kind || !KNOWN_KINDS.includes(change.kind) || !change.skillId || typeof change.to !== "string") {
    return NextResponse.json(
      {
        ok: false,
        error: "Expected { change: { kind: 'rewrite_skill_desc' | 'set_suggested_model', skillId, to } }",
      },
      { status: 400 },
    );
  }

  try {
    const config = applyChange(change, body.parentId);
    return NextResponse.json({ ok: true, config });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "applyChange failed" },
      { status: 400 },
    );
  }
}
