/**
 * Reads real conversation transcripts captured by the Ratel plugin hooks under
 * `<chatDir>` (default `~/.ratel/chat`). This is the transcript channel the trace
 * telemetry lacks (memory: `ratel-trace-no-turn-text`): turn text keyed by the host's
 * session id, with a `state.json` index of per-session metadata.
 *
 * Mirrors ratel-mcp's `HookChatSource` parsing exactly (`{role, content, ts}` JSONL,
 * tolerant line parsing) but adapts the turns to the engine's `Turn` shape (numeric
 * `ts`, `index`). Framework-free: node builtins only, `chatDir` injected so the
 * environment coupling (homedir) stays in the route layer and the source stays portable.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ChatRole } from "@sia/contract";
import type { Turn } from "../types";

/** Hosts the capture hook may write under; used to locate turn files when state lacks one. */
const KNOWN_HOSTS = ["claude-code", "codex", "unknown"] as const;

export interface ChatSessionSummary {
  sessionId: string;
  host: string;
  cwd?: string;
  updatedAt?: string;
  lastAnalyzedAt?: string;
}

/** One session's metadata plus its full transcript — the debug view for `detailFor`. */
export interface ChatDetail extends ChatSessionSummary {
  turns: Turn[];
}

/**
 * Whether a session id is safe to use as a path component. Session ids reach the store from
 * untrusted callers (a query param), and `turnsFor` joins them into a file path, so reject
 * anything that could traverse out of the chat dir before it touches the filesystem.
 */
export function isSafeSessionId(id: string): boolean {
  return id.length > 0 && id.length <= 200 && !/[/\\]/.test(id) && !id.includes("..") && !id.includes("\0");
}

interface RawSessionMeta {
  sessionId?: string;
  host?: string;
  cwd?: string;
  updatedAt?: string;
  lastAnalyzedAt?: string;
}

export class HookChatTranscriptSource {
  constructor(private readonly chatDir: string) {}

  /** Per-session metadata from `state.json`; empty when the index is missing/malformed. */
  listSessions(): ChatSessionSummary[] {
    const statePath = join(this.chatDir, "state.json");
    if (!existsSync(statePath)) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(statePath, "utf8"));
    } catch {
      return [];
    }
    const sessions = (parsed as { sessions?: Record<string, RawSessionMeta> } | null)?.sessions;
    if (!sessions || typeof sessions !== "object") return [];
    return Object.entries(sessions).map(([id, m]) => ({
      sessionId: m.sessionId ?? id,
      host: m.host ?? "unknown",
      cwd: m.cwd,
      updatedAt: m.updatedAt,
      lastAnalyzedAt: m.lastAnalyzedAt,
    }));
  }

  /**
   * Parsed turns for one session, or `[]` when no transcript file is found. `host` from
   * the state index narrows the lookup; absent that, every known host dir is tried.
   */
  turnsFor(sessionId: string, host?: string): Turn[] {
    const hosts = host ? [host] : this.hostFor(sessionId);
    for (const h of hosts) {
      const path = join(this.chatDir, h, `${sessionId}.jsonl`);
      if (existsSync(path)) return parseTurns(readFileSync(path, "utf8"));
    }
    return [];
  }

  /**
   * One session's metadata + full transcript for the debug viewer, or `null` when no transcript
   * is found. Host (and other metadata) come from the state index when present; turns are read
   * by `turnsFor`, which self-resolves the host even when the index lacks the session.
   */
  detailFor(sessionId: string): ChatDetail | null {
    const meta = this.listSessions().find((s) => s.sessionId === sessionId);
    const turns = this.turnsFor(sessionId, meta?.host);
    if (turns.length === 0) return null;
    return {
      sessionId,
      host: meta?.host ?? "unknown",
      cwd: meta?.cwd,
      updatedAt: meta?.updatedAt,
      lastAnalyzedAt: meta?.lastAnalyzedAt,
      turns,
    };
  }

  private hostFor(sessionId: string): readonly string[] {
    const known = this.listSessions().find((s) => s.sessionId === sessionId)?.host;
    return known ? [known] : KNOWN_HOSTS;
  }
}

/** Parse the `{role, content, ts}` JSONL into engine `Turn`s; malformed lines are skipped. */
export function parseTurns(raw: string): Turn[] {
  const turns: Turn[] = [];
  let index = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const turn = parseTurn(trimmed, index);
    if (turn) {
      turns.push(turn);
      index++;
    }
  }
  return turns;
}

function parseTurn(line: string, index: number): Turn | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const obj = parsed as Record<string, unknown>;
  const role = obj.role;
  const content = obj.content;
  if ((role !== "user" && role !== "assistant") || typeof content !== "string") return undefined;
  const turn: Turn = { role: role as ChatRole, content, index };
  if (typeof obj.ts === "string") {
    const ms = Date.parse(obj.ts);
    if (!Number.isNaN(ms)) turn.ts = ms;
  }
  return turn;
}
