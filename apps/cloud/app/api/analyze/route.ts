import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import type { AnalyzeResponseData, ApiResponse, Proposal } from "@sia/contract";
import { detectGaps } from "@sia/engine";
import { requireApiKey } from "@/lib/auth";
import { getRegistry } from "@/lib/registry";
import { getProposalStore, getUsageStore } from "@/lib/stores";
import { authorFix } from "@/lib/author";

export const runtime = "nodejs";

/** Stable proposal id from the route + cluster queries, so re-analyze dedups rather than duplicates. */
function proposalId(route: string, queries: string[]): string {
  const h = createHash("sha256").update(`${route}|${[...queries].sort().join("|")}`).digest("hex").slice(0, 10);
  return `prop_${h}`;
}

/**
 * Cluster ingested usage into intents, surface the gaps, route each (deterministically), and
 * author the fix (LLM, templated fallback) — writing one Proposal per gap. The heart of the loop.
 */
export async function POST(req: Request): Promise<NextResponse<ApiResponse<AnalyzeResponseData>>> {
  const denied = requireApiKey(req);
  if (denied) return denied;

  const active = (await getRegistry()).getActive();
  if (!active) {
    return NextResponse.json({ ok: false, error: "no active config" }, { status: 500 });
  }

  const usage = await (await getUsageStore()).load();
  const proposalStore = await getProposalStore();
  const nearMissMin = Number(process.env.SIA_NEAR_MISS_MIN ?? 1.5);
  const gaps = detectGaps(usage, { nearMissMin });

  const existing = new Map((await proposalStore.list()).map((p) => [p.id, p]));
  const created: Proposal[] = [];
  for (const gap of gaps) {
    const id = proposalId(gap.route, gap.queries);
    // Never clobber a fix that's already been applied (re-analyze is idempotent).
    if (existing.get(id)?.status === "applied") continue;

    const fix = await authorFix(gap, active);
    const proposal: Proposal = {
      id,
      intentLabel: gap.label,
      queries: gap.queries,
      route: gap.route,
      rationale: fix.rationale,
      change: fix.change,
      status: "proposed",
      createdAt: Date.now(),
    };
    await proposalStore.save(proposal);
    created.push(proposal);
  }

  return NextResponse.json({ ok: true, proposals: created });
}
