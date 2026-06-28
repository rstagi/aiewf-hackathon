// ─────────────────────────────────────────────────────────────────────────────
// SDK SEAM — usage reporting (Phase 3: wired to the Cloud).
//
// The agent reports how it used the catalog so the Cloud can cluster misses into intents
// and propose skills. This drains the live catalog's native trace buffer (the auto-emitted
// `search` + `invoke` envelopes for this turn), tags it with the consumed configId, and
// fire-and-forget POSTs it to the Cloud — `@sia/sdk` `emitTraces`. Telemetry must NEVER
// break a chat turn, so every failure is swallowed.
// ─────────────────────────────────────────────────────────────────────────────

import { emitTraces, type Drainable } from "@sia/sdk";
import { API_KEY, CLOUD_URL, SIA_PROJECT } from "./catalog";

/**
 * Drain + emit this turn's traces to the Cloud. Returns the number of envelopes sent (0 on
 * any failure). `arm` is vestigial here (the example runs no A/B arms) but kept as "champion"
 * for attribution consistency with the rest of the system.
 */
export async function emitUsage(catalog: Drainable, configId: string): Promise<number> {
  try {
    const sent = await emitTraces(
      catalog,
      { configId, arm: "champion" },
      { cloudUrl: CLOUD_URL, project: SIA_PROJECT, apiKey: API_KEY },
    );
    return sent.length;
  } catch (err) {
    console.warn("[sia] emitUsage failed:", err instanceof Error ? err.message : err);
    return 0;
  }
}
