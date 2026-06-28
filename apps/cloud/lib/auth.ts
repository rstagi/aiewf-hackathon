import { NextResponse } from "next/server";
import type { ApiErr } from "@sia/contract";

/**
 * Inbound shared-key guard for the mutation + ingest routes (Phase 2).
 *
 * OPT-IN by design: if `SIA_API_KEY` is unset, auth is DISABLED so the Phase-1
 * pipe keeps working with zero env. When it IS set, the caller must present
 * `Authorization: Bearer <key>`; a missing/wrong key returns a 401 envelope.
 * Returns `null` when the request is allowed (so callers do `if (denied) return denied`).
 *
 * NEVER log the key.
 */
export function requireApiKey(req: Request): NextResponse<ApiErr> | null {
  const expected = process.env.SIA_API_KEY;
  if (!expected) return null; // auth disabled — frictionless default
  if (req.headers.get("authorization") === `Bearer ${expected}`) return null;
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}
