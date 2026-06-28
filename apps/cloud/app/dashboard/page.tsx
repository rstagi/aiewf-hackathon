import { existsSync, readFileSync } from "node:fs";
import type { ExtendedTraceEnvelope } from "@sia/contract";
import {
  buildSessions,
  DeterministicIntentClusterer,
  mrr,
  parseTraceJsonl,
  runDetector,
  successAtK,
} from "@sia/engine";
import { TRACES_PATH } from "@/lib/paths";
import { getRegistry } from "@/lib/registry";
import { DEMO_LEAK_SKILL_ID, IMPROVED_LEAK_DESC } from "@/lib/levers";
import { clearTraces, improveAndPromote } from "./actions";

// Re-read the trace file + registry on every refresh — no caching.
export const dynamic = "force-dynamic";

const card =
  "rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900";
const th = "px-3 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400";
const td = "px-3 py-2 align-top";
const btn =
  "rounded-lg px-3 py-2 text-sm font-medium shadow-sm transition-colors disabled:opacity-50";

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const num = (x: number, digits = 2): string => (Number.isFinite(x) ? x.toFixed(digits) : "—");
const mean = (xs: number[]): number | undefined =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;

interface SessionRow {
  sessionId: string;
  configId?: string;
  arm?: string;
  searches: number;
  invokeStarts: number;
}

export default async function DashboardPage() {
  // ── What's live right now (the optimizable surface the SDK fetches JIT) ──
  const active = getRegistry().getActive();
  const leakSkill = active?.skills.find((s) => s.skillId === DEMO_LEAK_SKILL_ID);
  // Exact match to the value the promote action writes — no fragile substring heuristic.
  const leakTuned = leakSkill?.description === IMPROVED_LEAK_DESC;

  const raw = existsSync(TRACES_PATH) ? readFileSync(TRACES_PATH, "utf8") : "";
  const envelopes = parseTraceJsonl(raw);

  // Per-session rollup. configId / arm are CAMELCASE additive fields the SDK spreads
  // onto each envelope after drainTraceEvents(); take the first non-empty per session.
  const rowsById = new Map<string, SessionRow>();
  for (const e of envelopes) {
    let row = rowsById.get(e.session_id);
    if (!row) {
      row = { sessionId: e.session_id, searches: 0, invokeStarts: 0 };
      rowsById.set(e.session_id, row);
    }
    const ext = e as ExtendedTraceEnvelope;
    if (ext.configId && !row.configId) row.configId = ext.configId;
    if (ext.arm && !row.arm) row.arm = ext.arm;
    if (e.type === "search") row.searches += 1;
    if (e.type === "invoke_start") row.invokeStarts += 1;
  }
  const sessionRows = [...rowsById.values()];

  const sessions = buildSessions(envelopes);
  const report =
    envelopes.length === 0
      ? null
      : await runDetector(
          { sessions },
          { clusterer: new DeterministicIntentClusterer() },
          // RELAXED gates — defaults fire nothing on demo-scale data.
          { minClusterSearches: 2, minCellEvents: 2, fdrQ: 0.2 },
        );

  // Retrieval quality, aggregated over sessions that actually invoked a tool.
  const meanSak = mean(sessions.map((s) => successAtK(s, 5)).filter((x): x is number => x !== undefined));
  const meanMrr = mean(sessions.map((s) => mrr(s)).filter((x): x is number => x !== undefined));
  const invokedSessions = sessions.filter((s) => successAtK(s, 5) !== undefined).length;

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-10 sm:px-6">
      <Header />

      {/* ── Active config: the optimizable surface + the live levers ── */}
      <ActiveConfigCard active={active} leakDesc={leakSkill?.description} leakTuned={leakTuned} />

      {report === null ? (
        <div className={`${card} p-10 text-center text-sm text-neutral-500 dark:text-neutral-400`}>
          No traces yet — run <code className="font-mono">pnpm example</code>, then refresh.
        </div>
      ) : (
        <>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {report.sessionsAnalyzed} sessions · {report.searchesAnalyzed} searches · {envelopes.length} envelopes
          </p>

          {/* ── Flags ── */}
          <section className={`${card} overflow-hidden`}>
            <SectionTitle>Flags ({report.flags.length})</SectionTitle>
            {report.flags.length === 0 ? (
              <Empty>No flags fired.</Empty>
            ) : (
              <Table head={["kind", "target", "effect", "p", "reason"]}>
                {report.flags.map((f, i) => (
                  <tr key={i} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800/60">
                    <td className={`${td} font-mono text-xs`}>
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        {f.kind}
                      </span>
                    </td>
                    <td className={td}>{f.intentLabel ?? f.toolId ?? "—"}</td>
                    <td className={`${td} tabular-nums`}>{num(f.effectSize)}</td>
                    <td className={`${td} tabular-nums`}>{f.pValue == null ? "—" : num(f.pValue, 3)}</td>
                    <td className={`${td} text-neutral-600 dark:text-neutral-300`}>{f.reason}</td>
                  </tr>
                ))}
              </Table>
            )}
          </section>

          {/* ── Funnel ── */}
          <section className={`${card} overflow-hidden`}>
            <SectionTitle>Intent funnel ({report.funnel.length})</SectionTitle>
            {report.funnel.length === 0 ? (
              <Empty>No clusters.</Empty>
            ) : (
              <Table head={["intent", "searched", "found", "invoked", "invoke rate", "top score"]}>
                {report.funnel.map((f) => (
                  <tr key={f.clusterId} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800/60">
                    <td className={td}>{f.label}</td>
                    <td className={`${td} tabular-nums`}>{f.searched}</td>
                    <td className={`${td} tabular-nums`}>{f.found}</td>
                    <td className={`${td} tabular-nums`}>{f.invoked}</td>
                    <td className={`${td} tabular-nums`}>{pct(f.invokeRate)}</td>
                    <td className={`${td} tabular-nums`}>{num(f.medianTopScoreNorm)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </section>

          {/* ── Inventory quadrant ── */}
          <section className={`${card} overflow-hidden`}>
            <SectionTitle>Tool inventory ({report.inventory.length})</SectionTitle>
            {report.inventory.length === 0 ? (
              <Empty>No tools observed.</Empty>
            ) : (
              <Table head={["tool", "retrieved", "invoked", "errors", "quadrant"]}>
                {report.inventory.map((e) => (
                  <tr key={e.toolId} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800/60">
                    <td className={`${td} font-mono text-xs`}>{e.toolId}</td>
                    <td className={`${td} tabular-nums`}>{e.retrievedCount}</td>
                    <td className={`${td} tabular-nums`}>{e.invokedCount}</td>
                    <td className={`${td} tabular-nums`}>{e.errorCount}</td>
                    <td className={td}>
                      <QuadrantBadge quadrant={e.quadrant} />
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </section>

          {/* ── (intent, tool) grid ── */}
          <section className={`${card} overflow-hidden`}>
            <SectionTitle>Intent × tool grid ({report.grid.length})</SectionTitle>
            {report.grid.length === 0 ? (
              <Empty>No (intent, tool) cells yet — needs invocations.</Empty>
            ) : (
              <Table head={["intent", "tool", "n", "success", "95% CI"]}>
                {report.grid.map((g, i) => (
                  <tr key={i} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800/60">
                    <td className={td}>{g.label}</td>
                    <td className={`${td} font-mono text-xs`}>{g.toolId}</td>
                    <td className={`${td} tabular-nums`}>{g.n}</td>
                    <td className={`${td} tabular-nums`}>{pct(g.successRate)}</td>
                    <td className={`${td} tabular-nums text-neutral-500 dark:text-neutral-400`}>
                      [{num(g.successCI[0])}, {num(g.successCI[1])}]
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </section>

          {/* ── Retrieval quality ── */}
          <section className={`${card} p-4`}>
            <h2 className="text-sm font-semibold tracking-tight">Retrieval quality</h2>
            <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              Over the {invokedSessions} session{invokedSessions === 1 ? "" : "s"} that invoked a tool.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:max-w-md">
              <Stat label="success@5" value={meanSak === undefined ? "—" : pct(meanSak)} />
              <Stat label="MRR" value={meanMrr === undefined ? "—" : num(meanMrr)} />
            </div>
          </section>

          {/* ── Per-session ── */}
          <section className={`${card} overflow-hidden`}>
            <SectionTitle>Sessions ({sessionRows.length})</SectionTitle>
            <Table head={["session", "config", "arm", "searches", "invoke_start"]}>
              {sessionRows.map((s) => (
                <tr key={s.sessionId} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800/60">
                  <td className={`${td} font-mono text-xs`}>{s.sessionId}</td>
                  <td className={`${td} font-mono text-xs`}>{s.configId ?? "—"}</td>
                  <td className={td}>{s.arm ?? "—"}</td>
                  <td className={`${td} tabular-nums`}>{s.searches}</td>
                  <td className={`${td} tabular-nums`}>{s.invokeStarts}</td>
                </tr>
              ))}
            </Table>
          </section>
        </>
      )}
    </main>
  );
}

function Header() {
  return (
    <header>
      <h1 className="text-xl font-semibold tracking-tight">SIA Cloud — Dashboard</h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Detection over ingested trace envelopes (relaxed demo gates).
      </p>
    </header>
  );
}

function ActiveConfigCard({
  active,
  leakDesc,
  leakTuned,
}: {
  active: ReturnType<ReturnType<typeof getRegistry>["getActive"]>;
  leakDesc?: string;
  leakTuned: boolean;
}) {
  if (!active) {
    return (
      <section className={`${card} p-4`}>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">No active config.</p>
      </section>
    );
  }
  return (
    <section className={`${card} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">
            Active config{" "}
            <span className="font-mono text-xs text-neutral-500 dark:text-neutral-400">{active.id}</span>
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            {active.parentId ? (
              <>
                derived from <span className="font-mono">{active.parentId}</span> · model {active.modelDefault}
              </>
            ) : (
              <>genesis (v1) · model {active.modelDefault}</>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <form action={improveAndPromote}>
            <button
              type="submit"
              className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`}
              disabled={leakTuned}
              title={leakTuned ? "Already tuned" : "Rewrite the leaking skill's description and promote"}
            >
              {leakTuned ? "✓ tuned & promoted" : "Rewrite & promote account-recovery →"}
            </button>
          </form>
          <form action={clearTraces}>
            <button type="submit" className={`${btn} border border-neutral-300 dark:border-neutral-700`}>
              Clear traces
            </button>
          </form>
        </div>
      </div>
      <div className="border-t border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          <span className="font-mono">{LEAK_SKILL_ID}</span> description{" "}
          {leakTuned ? (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
              tuned
            </span>
          ) : (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              mediocre
            </span>
          )}
        </p>
        <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">“{leakDesc}”</p>
      </div>
    </section>
  );
}

function QuadrantBadge({ quadrant }: { quadrant: "retrieved_never_invoked" | "high_error" | "healthy" }) {
  const styles: Record<string, string> = {
    healthy: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
    retrieved_never_invoked: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    high_error: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  };
  return <span className={`rounded px-1.5 py-0.5 font-mono text-xs ${styles[quadrant]}`}>{quadrant}</span>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="text-xs text-neutral-500 dark:text-neutral-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="px-4 py-3 text-sm font-semibold tracking-tight">{children}</h2>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 pb-4 text-sm text-neutral-500 dark:text-neutral-400">{children}</p>;
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full border-t border-neutral-200 text-sm dark:border-neutral-800">
        <thead>
          <tr className="border-b border-neutral-200 dark:border-neutral-800">
            {head.map((h) => (
              <th key={h} className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
