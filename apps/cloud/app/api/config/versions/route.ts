import { NextResponse } from "next/server";
import type { ApiResponse, VersionsResponseData } from "@sia/contract";
import { getRegistry } from "@/lib/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // reflects live storage, never build-time prerender

/** List all catalog versions + the active pointer — the before/after lineage view. */
export async function GET(): Promise<NextResponse<ApiResponse<VersionsResponseData>>> {
  const reg = await getRegistry();
  return NextResponse.json({ ok: true, versions: reg.list(), activeId: reg.getActiveId() });
}
