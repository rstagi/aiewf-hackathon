// ─────────────────────────────────────────────────────────────────────────────
// SDK SEAM — the skills catalog (Phase 3: wired to the Cloud).
//
// The agent's SKILLS are owned by SIA and fetched from the Cloud's `example-assistant`
// project via the SDK. The catalog starts EMPTY — the agent runs as a normal assistant
// with its own tools (see ../agent/tools.ts) — and SIA grows it from observed usage:
// each turn fires a BM25 search whose zero-hit traces the Cloud clusters into proposed
// skills (ingest → analyze → author → apply), exactly the self-healing-catalog thesis.
//
// Config cadence: the active snapshot is fetched ONCE per chat session and PINNED for
// every turn in it (SDK orthodoxy — never refetch mid-session). A heal authored while a
// session is open therefore becomes visible on the NEXT session (a new conversation /
// reload / "New chat"), never mid-conversation.
// ─────────────────────────────────────────────────────────────────────────────

import { fetchActiveConfig } from "@sia/sdk";
import { indexSkillDefs, freezeConfig } from "@sia/engine";
import { EXAMPLE_CONFIG_DRAFT } from "@sia/seed";
import type { AgentConfig, SkillCatalogDef } from "@sia/contract";

/** The Cloud base URL (a single running instance on :3210 in dev). */
export const CLOUD_URL = process.env.CLOUD_URL ?? "http://localhost:3210";
/** The Cloud project (storage namespace) this agent reports to and fetches from. */
export const SIA_PROJECT = process.env.SIA_PROJECT ?? "example-assistant";
/** Inbound shared key for the Cloud (Phase 2 auth); unset in local dev. */
export const API_KEY = process.env.SIA_API_KEY;

// Confidence floor for injecting + invoking the top retrieved skill. CALIBRATED against the
// example's own (small, growing) catalog — NOT the larger demo-support corpus, whose 3.5 floor
// assumes many docs. Measured against a freshly-authored 1-skill catalog: an on-target query
// scores ~1.6–2.6, a tangential one ~0.8, and a genuinely-unrelated one returns no hit at all
// (BM25 over few docs yields lower absolute scores). 1.5 cleanly separates real intents from
// noise, and stays safe as the catalog grows (more docs sharpen, not inflate, on-target IDF).
export const INVOKE_FLOOR = Number(process.env.INVOKE_FLOOR ?? "1.5");
export const TOP_K = 5;

// The example's skills are Cloud-authored — their name/tags/body ride on the SkillSnapshot,
// so there are NO local SkillDefinitions and `buildToolCatalog`/`resolveSkillBody` fall back
// to the snapshot (the Phase-1 path). Kept as a stable empty map so the seam is obvious if a
// local example skill is ever added.
export const LOCAL_SKILL_DEFS: SkillCatalogDef = indexSkillDefs([]);

// Offline fallback: the genesis config the Cloud auto-seeds for this project. Used only when
// the Cloud is unreachable, so a missing Cloud degrades to "agent with its native tools"
// instead of a broken chat. Its id is the real genesis content hash, so trace attribution
// still lines up if the Cloud later comes back.
const OFFLINE_CONFIG: AgentConfig = freezeConfig(EXAMPLE_CONFIG_DRAFT);

// Per-session config pin. Keyed by `${project}:${sessionId}`. Grows with sessions over a
// long-lived server — fine for the demo; a TTL/LRU would bound it in production.
const sessionConfigs = new Map<string, AgentConfig>();

async function fetchOrFallback(label: string): Promise<AgentConfig> {
  try {
    return await fetchActiveConfig({ cloudUrl: CLOUD_URL, project: SIA_PROJECT, apiKey: API_KEY });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[sia] ${label}: Cloud unreachable (${msg}); using offline genesis config.`);
    return OFFLINE_CONFIG;
  }
}

/**
 * The active config for a chat session — fetched once, then pinned. Every turn in the same
 * session reuses the identical snapshot (and thus the identical catalog), so a mid-session
 * promotion can never straddle the conversation.
 */
export async function configForSession(sessionId: string): Promise<AgentConfig> {
  const key = `${SIA_PROJECT}:${sessionId}`;
  const cached = sessionConfigs.get(key);
  if (cached) return cached;
  const config = await fetchOrFallback("configForSession");
  sessionConfigs.set(key, config);
  return config;
}

/** Read-only catalog view for the `/api/catalog` route — a fresh peek at the active config. */
export interface CatalogView {
  configId: string;
  modelDefault: string;
  skills: { skillId: string; name: string; description: string }[];
}

export async function fetchCatalogView(): Promise<CatalogView> {
  const config = await fetchOrFallback("fetchCatalogView");
  return {
    configId: config.id,
    modelDefault: config.modelDefault,
    skills: config.skills.map((s) => ({
      skillId: s.skillId,
      name: s.name ?? s.skillId,
      description: s.description,
    })),
  };
}
