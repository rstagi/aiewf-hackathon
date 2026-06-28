import { NextResponse } from "next/server";
import type { ApiResponse, PromoteRequest, PromoteResponseData } from "@sia/contract";
import { requireApiKey } from "@/lib/auth";
import { promote } from "@/lib/registry";

export const runtime = "nodejs";

/**
 * Flip the active pointer to a snapshot — promote (or rollback). One O(1) pointer
 * move; the next JIT `GET /api/config/active` serves it, with the app untouched.
 */
export async function POST(
  req: Request,
): Promise<NextResponse<ApiResponse<PromoteResponseData>>> {
  const denied = requireApiKey(req);
  if (denied) return denied;

  let body: PromoteRequest;
  try {
    body = (await req.json()) as PromoteRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body?.id) {
    return NextResponse.json({ ok: false, error: "Expected { id }" }, { status: 400 });
  }

  try {
    const config = promote(body.id);
    return NextResponse.json({ ok: true, config });
  } catch (e) {
    // setActive throws on an unknown id.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "promote failed" },
      { status: 400 },
    );
  }
}
