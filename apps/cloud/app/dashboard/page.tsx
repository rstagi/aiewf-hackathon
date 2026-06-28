import { existsSync, readFileSync } from "node:fs";
import type { ExtendedTraceEnvelope } from "@sia/contract";
import {
  buildSessions,
  DeterministicIntentClusterer,
  parseTraceJsonl,
  runDetector,
} from "@sia/engine";
import { TRACES_PATH } from "@/lib/paths";

// Re-read the trace file on every refresh — no caching.
export const dynamic = "force-dynamic";

const card =
  "rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900";
const th = "px-3 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400";
const td = "px-3 py-2 align-top";

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const num = (x: number, digits = 2): string => (Number.isFinite(x) ? x.toFixed(digits) : "—");

interface SessionRow {
  sessionId: string;
  configId?: string;
  arm?: string;
  searches: number;
  invokeStarts: number;
}

export default async function DashboardPage() {
  const raw = existsSync(TRACES_PATH) ? readFileSync(TRACES_PATH, "utf8") : "";
  const envelopes = parseTraceJsonl(raw);

  if (envelopes.length === 0) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <Header />
        <div className={`${card} p-10 text-center text-sm text-neutral-500 dark:text-neutral-400`}>
          No traces yet — run the example app.
        </div>
      </main>
    );
  }

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
  const report = await runDetector(
    { sessions },
    { clusterer: new DeterministicIntentClusterer() },
    // RELAXED gates — defaults fire nothing on demo-scale data.
    { minClusterSearches: 2, minCellEvents: 2, fdrQ: 0.2 },
  );

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-10 sm:px-6">
      <Header />

      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        {report.sessionsAnalyzed} sessions · {report.searchesAnalyzed} searches · {envelopes.length} envelopes
      </p>

      {/* ── Flags ── */}
      <section className={`${card} overflow-hidden`}>
        <SectionTitle>Flags ({report.flags.length})</SectionTitle>
        {report.flags.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-neutral-500 dark:text-neutral-400">No flags fired.</p>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full border-t border-neutral-200 text-sm dark:border-neutral-800">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800">
                  <th className={th}>kind</th>
                  <th className={th}>target</th>
                  <th className={th}>effect</th>
                  <th className={th}>p</th>
                  <th className={th}>reason</th>
                </tr>
              </thead>
              <tbody>
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
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Funnel ── */}
      <section className={`${card} overflow-hidden`}>
        <SectionTitle>Intent funnel ({report.funnel.length})</SectionTitle>
        {report.funnel.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-neutral-500 dark:text-neutral-400">No clusters.</p>
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full border-t border-neutral-200 text-sm dark:border-neutral-800">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800">
                  <th className={th}>intent</th>
                  <th className={th}>searched</th>
                  <th className={th}>found</th>
                  <th className={th}>invoked</th>
                  <th className={th}>invoke rate</th>
                </tr>
              </thead>
              <tbody>
                {report.funnel.map((f) => (
                  <tr key={f.clusterId} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800/60">
                    <td className={td}>{f.label}</td>
                    <td className={`${td} tabular-nums`}>{f.searched}</td>
                    <td className={`${td} tabular-nums`}>{f.found}</td>
                    <td className={`${td} tabular-nums`}>{f.invoked}</td>
                    <td className={`${td} tabular-nums`}>{pct(f.invokeRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Per-session ── */}
      <section className={`${card} overflow-hidden`}>
        <SectionTitle>Sessions ({sessionRows.length})</SectionTitle>
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full border-t border-neutral-200 text-sm dark:border-neutral-800">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-800">
                <th className={th}>session</th>
                <th className={th}>config</th>
                <th className={th}>arm</th>
                <th className={th}>searches</th>
                <th className={th}>invoke_start</th>
              </tr>
            </thead>
            <tbody>
              {sessionRows.map((s) => (
                <tr key={s.sessionId} className="border-b border-neutral-100 last:border-0 dark:border-neutral-800/60">
                  <td className={`${td} font-mono text-xs`}>{s.sessionId}</td>
                  <td className={`${td} font-mono text-xs`}>{s.configId ?? "—"}</td>
                  <td className={td}>{s.arm ?? "—"}</td>
                  <td className={`${td} tabular-nums`}>{s.searches}</td>
                  <td className={`${td} tabular-nums`}>{s.invokeStarts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Header() {
  return (
    <header className="mb-6">
      <h1 className="text-xl font-semibold tracking-tight">SIA Cloud — Dashboard</h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        Detection over ingested trace envelopes (relaxed demo gates).
      </p>
    </header>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="px-4 py-3 text-sm font-semibold tracking-tight">{children}</h2>;
}
