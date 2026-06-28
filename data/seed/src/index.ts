// ─────────────────────────────────────────────────────────────────────────────
// @sia/seed — the committed demo corpus.
//
// THREE exports, all imported across the SDK↔Cloud boundary via @sia/contract types:
//   • SEED_SKILL_DEFS   — stable skill identity (name/tags/instructions/goldIntents).
//                         Folded with each snapshot's description into BM25 text.
//   • SEED_CONFIG_DRAFT  — the genesis AgentConfig surface the Cloud seeds its registry
//                         with (descriptions = the optimizable lever-1 surface).
//   • SCENARIOS          — paired synthetic traffic the example driver replays.
//
// THE DEMO NARRATIVE (PLAN risk #4 — "before must be visibly broken") is engineered HERE:
//   `account-recovery` is given a deliberately MEDIOCRE description and OFF-TARGET tags
//   ("account / profile / settings" — never "password / reset / login"). So password-reset
//   utterances retrieve it only weakly (one shared token, "account") → a hit is returned but
//   at a score BELOW the invoke floor → the agent SKIPS it. The deterministic Jaccard
//   clusterer groups those misses into one intent where nothing cleared the floor — the v4
//   gap gate. The Cloud then rewrites the description (improve-existing) to clear it.
//
// The other capabilities have on-target descriptions/tags so their intents convert cleanly —
// the healthy population that makes the one leaking intent stand out.
//
// Phase 1 EXTENDS this corpus with a SECOND planted weakness — a true GAP (an intent with NO
// covering skill) — so the loop can also demo "create-new" alongside "improve-existing".
// ─────────────────────────────────────────────────────────────────────────────

import type { ConfigDraft, SkillDefinition } from "@sia/contract";

/** SkillId of the deliberately-underperforming capability — the demo's climax target. */
export const LEAK_SKILL_ID = "account-recovery";

/** Default model for genesis (Phase 1 uses a canned executor; this is forward-fuel for lever 2). */
export const SEED_MODEL_DEFAULT = "claude-haiku-4-5-20251001";

// ─────────────────────────────────────────────────────────────────────────────
// Stable skill identity (NON-optimizable). Joined with the snapshot description at
// retrieval time. NOTE: `account-recovery`'s tags are intentionally generic so the
// description is the ONLY lever that can fix retrieval.
// ─────────────────────────────────────────────────────────────────────────────
export const SEED_SKILL_DEFS: SkillDefinition[] = [
  {
    skillId: "account-recovery",
    name: "Account Center",
    tags: ["account", "profile", "settings"],
    instructions:
      "Walk the user through resetting their password and regaining access to a locked account, " +
      "step by step: verify identity, send a reset link, and confirm the new credentials work.",
    goldIntents: ["reset password", "recover account", "locked out", "forgot login"],
  },
  {
    skillId: "doc-summary",
    name: "Document Summarizer",
    tags: ["summary", "summarize", "document", "tldr"],
    instructions:
      "Summarize the provided document concisely, capturing the key points, decisions, and any figures.",
    goldIntents: ["summarize document", "tldr of a document"],
  },
  {
    skillId: "billing-refund",
    name: "Billing & Refunds",
    tags: ["billing", "invoice", "refund", "payment", "charge"],
    instructions:
      "Resolve billing questions: explain invoices and charges, process refunds, and update payment methods.",
    goldIntents: ["refund an invoice", "billing question", "wrong charge"],
  },
  {
    skillId: "order-tracking",
    name: "Order Tracking",
    tags: ["order", "shipping", "delivery", "tracking", "package"],
    instructions:
      "Look up an order and report its current shipping and delivery status, with the tracking number and ETA.",
    goldIntents: ["track my order", "where is my package", "delivery status"],
  },
  {
    skillId: "tech-support",
    name: "Technical Support",
    tags: ["bug", "error", "crash", "troubleshoot", "broken"],
    instructions:
      "Troubleshoot technical problems: reproduce the error, isolate the cause, and give a concrete fix or workaround.",
    goldIntents: ["app is crashing", "fix an error", "something is broken"],
  },
  {
    skillId: "plan-upgrade",
    name: "Plans & Upgrades",
    tags: ["plan", "upgrade", "subscription", "pricing", "tier"],
    instructions:
      "Compare subscription plans and walk the user through upgrading, downgrading, or changing their tier.",
    goldIntents: ["upgrade my plan", "compare pricing", "change subscription"],
  },
  {
    skillId: "data-export",
    name: "Data Export",
    tags: ["export", "download", "data", "csv", "backup"],
    instructions:
      "Help the user export and download their data (CSV / JSON backup), explaining scope and format.",
    goldIntents: ["export my data", "download a backup"],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Genesis config surface (v1). The `description` field is the LEVER-1 surface the
// Cloud optimizes. `account-recovery`'s description is deliberately about "account
// settings", not password reset — that is the seeded weakness.
// ─────────────────────────────────────────────────────────────────────────────
export const SEED_CONFIG_DRAFT: ConfigDraft = {
  systemPrompt:
    "You are a helpful customer-support agent. Search for the most relevant capability for each " +
    "user request and use it when you are confident it matches; otherwise ask a clarifying question.",
  skills: [
    {
      skillId: "account-recovery",
      // MEDIOCRE on purpose — no "password" / "reset" / "login" terms ⇒ weak BM25 match.
      description: "Manage your account settings and update your profile information.",
    },
    {
      skillId: "doc-summary",
      description: "Summarize a long document into a concise set of key points and takeaways.",
    },
    {
      skillId: "billing-refund",
      description: "Help with billing: invoices, charges, payments, and refunds.",
    },
    {
      skillId: "order-tracking",
      description: "Track an order and check its shipping and delivery status.",
    },
    {
      skillId: "tech-support",
      description: "Troubleshoot technical issues, errors, crashes, and bugs in the app.",
    },
    {
      skillId: "plan-upgrade",
      description: "Compare plans and upgrade or change your subscription tier.",
    },
    {
      skillId: "data-export",
      description: "Export and download your data as a CSV or JSON backup.",
    },
  ],
  tools: [],
  modelDefault: SEED_MODEL_DEFAULT,
};

// ─────────────────────────────────────────────────────────────────────────────
// Paired synthetic traffic. Utterances within an intent share core tokens so the
// deterministic Jaccard clusterer groups them (threshold 0.3); the leak cluster
// shares "account" with the mediocre description (guarantees a weak hit → found>0)
// but not "password"/"reset" (keeps the score under the invoke floor → invoked=0).
// ─────────────────────────────────────────────────────────────────────────────
export interface Scenario {
  /** Stable scenario id; the deterministic sessionId is derived from it. */
  id: string;
  /** The intent label (for the demo script / grouping; not used by the retriever). */
  intent: string;
  /** What the synthetic user actually types — this is what gets searched. */
  utterance: string;
  /** The capability that SHOULD handle this (ground truth for success@k later). */
  goldSkillId: string;
}

export const SCENARIOS: Scenario[] = [
  // ── LEAKING intent: password reset → account-recovery (mediocre description) ──
  { id: "acct-1", intent: "reset password", utterance: "reset my account password", goldSkillId: "account-recovery" },
  { id: "acct-2", intent: "reset password", utterance: "recover my account password", goldSkillId: "account-recovery" },
  { id: "acct-3", intent: "reset password", utterance: "i lost access to my account, reset password", goldSkillId: "account-recovery" },

  // ── HEALTHY intent: summarize a document → doc-summary ──
  { id: "doc-1", intent: "summarize document", utterance: "summarize this document", goldSkillId: "doc-summary" },
  { id: "doc-2", intent: "summarize document", utterance: "summarize the document for me", goldSkillId: "doc-summary" },
  { id: "doc-3", intent: "summarize document", utterance: "can you summarize my document", goldSkillId: "doc-summary" },

  // ── HEALTHY intent: refund an invoice → billing-refund ──
  { id: "bill-1", intent: "refund invoice", utterance: "i want a refund on my invoice", goldSkillId: "billing-refund" },
  { id: "bill-2", intent: "refund invoice", utterance: "refund my invoice please", goldSkillId: "billing-refund" },
  { id: "bill-3", intent: "refund invoice", utterance: "how do i get a refund for an invoice", goldSkillId: "billing-refund" },
];

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — the SECOND planted weakness: a TRUE GAP (an intent with NO covering skill).
//
// "talk to a human" shares NONE of its content tokens ("talk" / "human" / "agent") with any
// of the 7 seed skills' descriptions or tags, so these utterances retrieve nothing above the
// invoke floor (often nothing at all) → every search in the cluster misses, with no near-miss
// candidate. The deterministic Jaccard clusterer still groups them (they share "talk"+"human"),
// and the analyzer routes the gap to CREATE-NEW: the Cloud authors a brand-new
// `live-agent-handoff` skill (carrying its own body) — the create-new half of the demo,
// alongside the improve-existing rewrite of `account-recovery`.
//
// ADDITIVE ONLY: SEED_SKILL_DEFS / SEED_CONFIG_DRAFT / SCENARIOS are untouched, so the genesis
// hash (cfg_abd14cd40fc3) and the golden test stay green by construction.
// ─────────────────────────────────────────────────────────────────────────────

/** SkillId of the to-be-created capability — absent from the genesis catalog (this IS the gap). */
export const GAP_SKILL_ID = "live-agent-handoff";

export const GAP_SCENARIOS: Scenario[] = [
  // ── GAP intent: talk to a human → live-agent-handoff (no covering skill in v1) ──
  // Tight on the shared tokens {talk, human} (one varying verb each) so the Jaccard clusterer
  // groups all three into ONE bucket; none of the 7 seed skills carry "talk"/"human" → no hits.
  { id: "human-1", intent: "talk to a human", utterance: "i want to talk to a human", goldSkillId: GAP_SKILL_ID },
  { id: "human-2", intent: "talk to a human", utterance: "let me talk to a human", goldSkillId: GAP_SKILL_ID },
  { id: "human-3", intent: "talk to a human", utterance: "i need to talk to a human", goldSkillId: GAP_SKILL_ID },
];

/** The full Phase-1 demo traffic: the original paired scenarios PLUS the true-gap cluster. */
export const DEMO_SCENARIOS: Scenario[] = [...SCENARIOS, ...GAP_SCENARIOS];
