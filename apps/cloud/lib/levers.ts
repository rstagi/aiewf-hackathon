import { LEAK_SKILL_ID } from "@sia/seed";

// The Phase-2 demo's lever-1 target + the exact improved description the dashboard
// promotes. Shared so the server action (which promotes it) and the page (which detects
// whether it's live) agree on one value — no fragile substring heuristic.
export const DEMO_LEAK_SKILL_ID = LEAK_SKILL_ID;

export const IMPROVED_LEAK_DESC =
  "Reset your password, recover a locked account, and regain login access when you are locked out.";
