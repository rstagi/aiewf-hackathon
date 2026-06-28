import { NextResponse } from "next/server";

export const runtime = "nodejs";

interface HealthResponse {
  ok: true;
  service: string;
  ts: number;
}

/** Liveness probe — mirrors the reference app's `{ ok, ... }` envelope shape. */
export async function GET(): Promise<NextResponse<HealthResponse>> {
  return NextResponse.json({ ok: true, service: "sia-cloud", ts: Date.now() });
}
