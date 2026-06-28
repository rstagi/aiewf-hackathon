import { NextResponse } from "next/server";
import type { ApiResponse, ProposalsResponseData } from "@sia/contract";
import { getProposalStore } from "@/lib/stores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // never statically pre-render an empty list at build

/** List all proposals (proposed / applied / dismissed) for the before/after story. */
export async function GET(): Promise<NextResponse<ApiResponse<ProposalsResponseData>>> {
  const proposals = await (await getProposalStore()).list();
  return NextResponse.json({ ok: true, proposals });
}
