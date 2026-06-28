import { NextResponse } from "next/server";
import { getRegistry, storageKind, type StorageKind } from "@/lib/registry";

export const runtime = "nodejs";

interface HealthResponse {
  ok: true;
  service: string;
  /** The storage backend the registry actually opened: "mongo" when MONGO_URI is set
   *  and reachable, else "file" (the demo-safe fallback). */
  storage: StorageKind | "unknown";
  /** The active (champion) config id — proves the catalog authority booted. */
  activeConfigId?: string;
  ts: number;
}

/**
 * Liveness + readiness probe. Forces the registry to open (Mongo connect or file
 * fallback) so the reported `storage` reflects the LIVE backend, not just env.
 */
export async function GET(): Promise<NextResponse<HealthResponse>> {
  const reg = await getRegistry();
  return NextResponse.json({
    ok: true,
    service: "sia-cloud",
    storage: storageKind() ?? "unknown",
    activeConfigId: reg.getActiveId(),
    ts: Date.now(),
  });
}
