import { NextResponse } from "next/server";
import type { ActiveConfigResponseData, ApiResponse } from "@sia/contract";
import { getRegistry } from "@/lib/registry";

export const runtime = "nodejs";

/**
 * The SDK fetches the active (champion) config JIT from here. Success spreads the
 * payload at the TOP level (`{ ok: true, config }`), mirroring the reference envelope.
 */
export async function GET(): Promise<NextResponse<ApiResponse<ActiveConfigResponseData>>> {
  const config = getRegistry().getActive();
  if (!config) {
    return NextResponse.json({ ok: false, error: "no active config" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, config });
}
