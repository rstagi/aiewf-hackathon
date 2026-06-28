import { NextResponse } from "next/server";
import type { ApiResponse, ApplyProposalRequest, ApplyProposalResponseData } from "@sia/contract";
import { requireApiKey } from "@/lib/auth";
import { applyChange, getRegistry, promote } from "@/lib/registry";
import { getProposalStore } from "@/lib/stores";

export const runtime = "nodejs";

/**
 * Apply a proposal: derive a child version from the active config by applying its change
 * (deriveChild + register), flip the active pointer to it, and mark the proposal applied.
 * Reuses the catalog-version mechanics — apply is just applyChange + promote.
 */
export async function POST(req: Request): Promise<NextResponse<ApiResponse<ApplyProposalResponseData>>> {
  const denied = requireApiKey(req);
  if (denied) return denied;

  let body: ApplyProposalRequest;
  try {
    body = (await req.json()) as ApplyProposalRequest;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body?.proposalId) {
    return NextResponse.json({ ok: false, error: "Expected { proposalId }" }, { status: 400 });
  }

  const proposalStore = await getProposalStore();
  const proposal = await proposalStore.get(body.proposalId);
  if (!proposal) {
    return NextResponse.json({ ok: false, error: `unknown proposal '${body.proposalId}'` }, { status: 404 });
  }
  if (!proposal.change) {
    return NextResponse.json({ ok: false, error: "proposal has no change to apply" }, { status: 400 });
  }

  const activeId = (await getRegistry()).getActiveId();
  if (!activeId) {
    return NextResponse.json({ ok: false, error: "no active config" }, { status: 500 });
  }

  try {
    const child = await applyChange(proposal.change, activeId); // mint child from the active config
    await promote(child.id); // flip the active pointer — the agent picks it up on its next fetch
    await proposalStore.setStatus(proposal.id, "applied");
    return NextResponse.json({ ok: true, proposal: { ...proposal, status: "applied" }, config: child });
  } catch (e) {
    // e.g. add_skill whose skill already exists (re-apply) — a clean client error, not a 500.
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "apply failed" },
      { status: 400 },
    );
  }
}
