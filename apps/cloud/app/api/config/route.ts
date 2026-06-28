import { NextResponse } from "next/server";
import type { ApiResponse, ApplyChangeRequest, ApplyChangeResponseData, ConfigChange } from "@sia/contract";
import { requireApiKey } from "@/lib/auth";
import { applyChange } from "@/lib/registry";

export const runtime = "nodejs";

/** Structural validation per ConfigChange kind. Returns an error string, or null if valid. */
function validateChange(change: ConfigChange | undefined): string | null {
  if (!change || typeof change !== "object" || typeof (change as { kind?: unknown }).kind !== "string") {
    return "Expected { change: { kind, skillId, ... } }";
  }
  if (typeof change.skillId !== "string" || !change.skillId) return "change.skillId is required";
  switch (change.kind) {
    case "rewrite_skill_desc":
    case "set_suggested_model":
      return typeof change.to === "string" && change.to ? null : `change.to (string) is required for ${change.kind}`;
    case "add_skill":
      return typeof change.name === "string" &&
        typeof change.description === "string" &&
        Array.isArray(change.tags) &&
        typeof change.instructions === "string"
        ? null
        : "add_skill requires { name, description, tags[], instructions }";
    default:
      return `Unknown change kind '${(change as { kind: string }).kind}'`;
  }
}

/**
 * Derive (or dedup) a child config snapshot by applying one optimization to a parent
 * (default: the active champion). Returns the child id — it is NOT promoted here; the
 * caller flips the active pointer via POST /api/promote. This is the programmatic seam the
 * generate/apply loop drives (the Cloud is API-only — there is no dashboard action).
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
  const invalid = validateChange(change);
  if (invalid) {
    return NextResponse.json({ ok: false, error: invalid }, { status: 400 });
  }

  try {
    const config = await applyChange(change as ConfigChange, body.parentId);
    return NextResponse.json({ ok: true, config });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "applyChange failed" },
      { status: 400 },
    );
  }
}
