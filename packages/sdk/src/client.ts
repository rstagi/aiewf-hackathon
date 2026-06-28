import type {
  AgentConfig,
  Arm,
  ExtendedTraceEnvelope,
  TraceEnvelope,
  TraceBatch,
  ApiResponse,
  ActiveConfigResponseData,
} from "@sia/contract";

export interface SdkConfig {
  /** Base URL of the Cloud, e.g. http://localhost:3000 */
  cloudUrl: string;
  /** Inbound shared key for the Cloud (Phase 2). */
  apiKey?: string;
}

/**
 * Fetch the active AgentConfig snapshot from the Cloud and PIN it for the WHOLE run.
 * Never refetch the active pointer per-turn, or a mid-traffic promotion contaminates
 * A/B arms (PLAN risk #1). Callers hold the returned snapshot for the entire session.
 */
export async function fetchActiveConfig(opts: SdkConfig): Promise<AgentConfig> {
  const res = await fetch(`${opts.cloudUrl}/api/config/active`, {
    headers: opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {},
  });
  const body = (await res.json()) as ApiResponse<ActiveConfigResponseData>;
  if (!body.ok) throw new Error(`fetchActiveConfig: ${body.error}`);
  return body.config;
}

export interface EmitAttribution {
  configId: string;
  arm?: Arm;
  experimentId?: string;
}

/**
 * Attach run attribution to drained native envelopes.
 *
 * configId/arm/experimentId CANNOT ride through the SDK's recordEvent() — the Rust
 * core deserializes into its tagged enum and re-wraps the envelope, dropping unknown
 * keys. The ONLY lossless seam is to spread them in AFTER draining. They are camelCase,
 * so they never collide with the snake_case wire fields (PLAN risk #1).
 */
export function enrichEnvelopes(drained: unknown[], attr: EmitAttribution): ExtendedTraceEnvelope[] {
  return drained.map((e) => ({
    ...(e as TraceEnvelope),
    configId: attr.configId,
    ...(attr.arm ? { arm: attr.arm } : {}),
    ...(attr.experimentId ? { experimentId: attr.experimentId } : {}),
  }));
}

/** Minimal shape we need from a catalog: just its drain. (Keeps this testable.) */
export interface Drainable {
  drainTraceEvents(): unknown[];
}

/**
 * Drain a catalog's trace buffer, enrich with run attribution, and POST to the Cloud.
 *
 * Fire-and-forget: a failed/blocked POST must NEVER stall or crash the agent (PLAN
 * risk #3). Buffered at end-of-run, flushed once, dropped on failure. Returns the
 * envelopes that were sent (for the golden assertion + caller inspection).
 */
export async function emitTraces(
  catalog: Drainable,
  attr: EmitAttribution,
  opts: SdkConfig,
): Promise<ExtendedTraceEnvelope[]> {
  const envelopes = enrichEnvelopes(catalog.drainTraceEvents(), attr);
  if (envelopes.length === 0) return envelopes;
  const batch: TraceBatch = { envelopes };
  try {
    const res = await fetch(`${opts.cloudUrl}/api/traces`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      // Non-fatal, but visible: a 401 (bad/missing SIA_API_KEY) otherwise drops silently
      // and the dashboard just looks empty while the run reports success.
      console.warn(
        `[sia/sdk] trace emit rejected (${res.status} ${res.statusText}); ` +
          `${envelopes.length} envelopes dropped — check SIA_API_KEY.`,
      );
    }
  } catch {
    // drop-on-failure: telemetry must never kill the agent.
  }
  return envelopes;
}
