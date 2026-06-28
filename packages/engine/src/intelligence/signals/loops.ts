/**
 * Loop / oscillation detection (§3.2 signal 7): an identical (tool, args-size) call
 * repeated, or an A→B→A tool-id cycle within a session.
 */

import type { Session } from "../types";

export interface OscillationResult {
  oscillation: boolean;
  detail?: string;
}

export function detectOscillation(session: Session): OscillationResult {
  const calls = session.toolCalls;

  // Identical repeated call (same tool, same args size).
  const seen = new Map<string, number>();
  for (const c of calls) {
    const key = `${c.toolId}|${c.argsSizeBytes ?? ""}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n >= 2) return { oscillation: true, detail: `identical call repeated ${n}× : ${c.toolId}` };
  }

  // A→B→A cycle on tool ids.
  const ids = calls.map((c) => c.toolId);
  for (let i = 0; i + 2 < ids.length; i++) {
    if (ids[i] === ids[i + 2] && ids[i] !== ids[i + 1]) {
      return { oscillation: true, detail: `A→B→A cycle: ${ids[i]} → ${ids[i + 1]} → ${ids[i]}` };
    }
  }

  return { oscillation: false };
}
