import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { AgentConfig, ConfigChange } from "@sia/contract";
import type { GapCluster } from "@sia/engine";
import { loadRepoEnv } from "./env";

// The Cloud authors the fix for a routed gap: a sharper description (improve-existing) or a
// brand-new skill carrying its own body (create-new). The LLM (Claude via the Vercel AI SDK)
// does the authoring; a DETERMINISTIC templated fallback runs on any model error/timeout so a
// live demo never depends on the model (PLAN risk #5). The route itself is decided upstream by
// the deterministic gap gate — the model only authors content, it does not re-route.

loadRepoEnv(); // make the repo-root ANTHROPIC_API_KEY visible before any model call

/** Model id for authoring. Defaults to the current flagship; override via env for latency. */
const AUTHOR_MODEL = process.env.SIA_AUTHOR_MODEL ?? "claude-opus-4-8";

export interface AuthoredFix {
  rationale: string;
  change: ConfigChange;
}

const STOPISH = new Set(["the", "and", "for", "you", "your", "want", "can", "let", "need", "this", "that"]);

/** Distinct content keywords across the cluster's queries (for tags + templated fallback). */
function keywords(queries: string[], limit = 7): string[] {
  const seen = new Set<string>();
  for (const q of queries) {
    for (const t of q.toLowerCase().split(/[^a-z0-9]+/)) {
      if (t.length >= 3 && !STOPISH.has(t)) seen.add(t);
    }
  }
  return [...seen].slice(0, limit);
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "new-skill";
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Templated fallbacks (no model) — functional, BM25-matchable, deterministic ──
function templatedDescription(gap: GapCluster): string {
  return `Help users who want to ${gap.label} — for example: ${gap.queries.join("; ")}.`;
}

function templatedNewSkill(gap: GapCluster): {
  slug: string;
  name: string;
  description: string;
  tags: string[];
  instructions: string;
} {
  const name = titleCase(gap.label);
  return {
    slug: slugify(gap.label),
    name,
    description: templatedDescription(gap),
    tags: keywords(gap.queries),
    instructions:
      `# ${name}\n\n` +
      `When the user wants to ${gap.label} (e.g. "${gap.queries[0]}"):\n` +
      `1. Acknowledge the request and confirm what they need.\n` +
      `2. Take the most direct action that satisfies it.\n` +
      `3. Confirm the outcome and offer a relevant follow-up.`,
  };
}

const ImprovedDescSchema = z.object({
  description: z
    .string()
    .describe("ONE sentence a BM25 keyword retriever will match these queries on, in the users' own words"),
});

const NewSkillSchema = z.object({
  name: z.string().describe("Short human-readable skill name in Title Case"),
  slug: z.string().describe("kebab-case skill id, distinct from the existing skill ids"),
  description: z
    .string()
    .describe("ONE sentence a BM25 keyword retriever will match these queries on, using the users' actual words"),
  tags: z.array(z.string()).describe("3-7 lowercase keyword tags"),
  instructions: z.string().describe("A short markdown playbook (3-6 steps) the agent follows when this skill runs"),
});

/** Author the fix (LLM, with a templated fallback) for a single routed gap. */
export async function authorFix(gap: GapCluster, active: AgentConfig): Promise<AuthoredFix> {
  if (gap.route === "improve-existing" && gap.candidate) {
    const current = active.skills.find((s) => s.skillId === gap.candidate!.skillId)?.description ?? "";
    const rationale =
      `'${gap.candidate.skillId}' is retrieved for these queries but scores ~${gap.candidate.meanScore.toFixed(2)}, ` +
      `below the invoke floor — sharpening its description closes the gap.`;
    try {
      const { object } = await generateObject({
        model: anthropic(AUTHOR_MODEL),
        schema: ImprovedDescSchema,
        prompt:
          `An existing skill SHOULD cover these user queries, but its description is too weak for a ` +
          `keyword retriever (BM25) to match it.\n\n` +
          `Skill id: ${gap.candidate.skillId}\n` +
          `Current description: "${current}"\n\n` +
          `Queries it should match (one intent):\n${gap.queries.map((q) => `- ${q}`).join("\n")}\n\n` +
          `Rewrite the description into one sentence the retriever will match these queries on, using the ` +
          `users' vocabulary. Keep it accurate to the skill's purpose.`,
      });
      return {
        rationale,
        change: {
          kind: "rewrite_skill_desc",
          skillId: gap.candidate.skillId,
          from: current,
          to: object.description,
        },
      };
    } catch {
      return {
        rationale: `${rationale} (templated — model unavailable)`,
        change: {
          kind: "rewrite_skill_desc",
          skillId: gap.candidate.skillId,
          from: current,
          to: templatedDescription(gap),
        },
      };
    }
  }

  // create-new
  const rationale = `No catalog skill covers these queries; authoring a new skill to close the gap.`;
  const existingIds = new Set(active.skills.map((s) => s.skillId));
  try {
    const { object } = await generateObject({
      model: anthropic(AUTHOR_MODEL),
      schema: NewSkillSchema,
      prompt:
        `Users repeatedly asked an AI agent for a capability its catalog does NOT cover. Author a new skill.\n\n` +
        `Agent role: ${active.systemPrompt}\n\n` +
        `Uncovered user queries (one intent):\n${gap.queries.map((q) => `- ${q}`).join("\n")}\n\n` +
        `Existing skills (do NOT duplicate):\n${active.skills.map((s) => `- ${s.skillId}: ${s.description}`).join("\n")}\n\n` +
        `Author: a Title Case name; a kebab-case slug distinct from the existing ids; a one-sentence description ` +
        `a BM25 retriever will match these queries on (use the users' words); 3-7 lowercase tags; and a short ` +
        `markdown playbook the agent follows when the skill is invoked.`,
    });
    const slug = existingIds.has(object.slug) ? `${object.slug}-new` : slugify(object.slug);
    return {
      rationale,
      change: {
        kind: "add_skill",
        skillId: slug,
        name: object.name,
        description: object.description,
        tags: object.tags,
        instructions: object.instructions,
      },
    };
  } catch {
    const t = templatedNewSkill(gap);
    const slug = existingIds.has(t.slug) ? `${t.slug}-new` : t.slug;
    return {
      rationale: `${rationale} (templated — model unavailable)`,
      change: {
        kind: "add_skill",
        skillId: slug,
        name: t.name,
        description: t.description,
        tags: t.tags,
        instructions: t.instructions,
      },
    };
  }
}

// Exposed for unit tests (the deterministic fallback path; the LLM path is exercised by the demo).
export const _internal = { templatedDescription, templatedNewSkill, keywords, slugify };
