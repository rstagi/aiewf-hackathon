import { NextResponse } from "next/server";
import type { ApiResponse, TraceBatch } from "@sia/contract";
import { requireApiKey } from "@/lib/auth";
import { getUsageStore } from "@/lib/stores";

export const runtime = "nodejs";

type TracesResponseData = { received: number };

/**
 * The SDK (or the demo driver) POSTs a batch of trace envelopes at end-of-run. Phase 1
 * persists them through the UsageStore — Mongo when reachable, else the file fallback (same
 * JSONL path as before) — so the analyzer can read the accumulated usage back. The `{ envelopes }`
 * request + `{ ok, received }` response are unchanged, so the SDK emit path stays compatible.
 */
export async function POST(req: Request): Promise<NextResponse<ApiResponse<TracesResponseData>>> {
  const denied = requireApiKey(req);
  if (denied) return denied;

  let body: TraceBatch;
  try {
    body = (await req.json()) as TraceBatch;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body?.envelopes)) {
    return NextResponse.json({ ok: false, error: "Expected { envelopes: [...] }" }, { status: 400 });
  }

  await (await getUsageStore()).append(body.envelopes);
  return NextResponse.json({ ok: true, received: body.envelopes.length });
}
