import { NextResponse } from "next/server";
import { appendFileSync, mkdirSync } from "node:fs";
import type { ApiResponse, TraceBatch } from "@sia/contract";
import { requireApiKey } from "@/lib/auth";
import { RUNTIME_DIR, TRACES_PATH } from "@/lib/paths";

export const runtime = "nodejs";

type TracesResponseData = { received: number };

/**
 * The SDK POSTs a fire-and-forget batch of trace envelopes at end-of-run. We append
 * each as one JSONL line — this just needs to be correct + fast. Guarded by the
 * shared inbound key (when SIA_API_KEY is set); the SDK forwards it as a bearer.
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

  mkdirSync(RUNTIME_DIR, { recursive: true });
  for (const env of body.envelopes) {
    appendFileSync(TRACES_PATH, JSON.stringify(env) + "\n");
  }

  return NextResponse.json({ ok: true, received: body.envelopes.length });
}
