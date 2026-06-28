import { getRegistry, storageKind } from "@/lib/registry";

// Re-read live state on every load — no caching.
export const dynamic = "force-dynamic";

const ROUTES: { method: string; path: string; desc: string }[] = [
  { method: "GET", path: "/api/health", desc: "liveness + live storage backend" },
  { method: "GET", path: "/api/config/active", desc: "the active catalog the SDK fetches JIT" },
  { method: "POST", path: "/api/config", desc: "derive a child config snapshot (a change)" },
  { method: "POST", path: "/api/promote", desc: "flip the active pointer (promote / rollback)" },
  { method: "POST", path: "/api/traces", desc: "ingest usage trace envelopes from the SDK" },
];

/**
 * API-first landing — the Cloud is a backend product (the Phase-4 inspector lives in the
 * example app, not here). This page just proves the Cloud booted and shows the live
 * storage backend + active catalog version.
 */
export default async function Home() {
  const reg = await getRegistry();
  const active = reg.getActive();
  const backend = storageKind() ?? "unknown";

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-6 py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">SIA Cloud</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          The catalog authority — content-hashed config versions + pointer-flip promote/rollback.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-4 sm:max-w-md">
        <Stat label="storage backend" value={backend} mono />
        <Stat label="active config" value={active?.id ?? "—"} mono />
      </section>

      <section>
        <h2 className="text-sm font-semibold tracking-tight">API surface</h2>
        <ul className="mt-3 space-y-1.5">
          {ROUTES.map((r) => (
            <li key={r.path} className="flex items-baseline gap-3 text-sm">
              <span className="w-12 shrink-0 font-mono text-xs text-neutral-500 dark:text-neutral-400">{r.method}</span>
              <code className="font-mono text-neutral-800 dark:text-neutral-200">{r.path}</code>
              <span className="text-neutral-500 dark:text-neutral-400">— {r.desc}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="text-xs text-neutral-500 dark:text-neutral-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}
