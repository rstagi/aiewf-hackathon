// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for the Phase-2 context-frame capture + Cloud-first body resolution.
//
// Drives the seed corpus directly (no native catalog needed — capture takes plain
// RetrievalHit[]). Pins: Cloud-first precedence, clearedFloor straddling the floor,
// the total `outcome` function, invokedBodies population, and the "compatible superset
// of the example app's frame" invariant (so Phase-3 adoption is lossless).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { freezeConfig, indexSkillDefs } from "@sia/engine";
import { SEED_CONFIG_DRAFT, SEED_SKILL_DEFS, LEAK_SKILL_ID } from "@sia/seed";
import type { AgentConfig } from "@sia/contract";
import { captureContextFrame, resolveSkillBody, type ContextFrame } from "./index";

const seedConfig = freezeConfig(SEED_CONFIG_DRAFT);
const defs = indexSkillDefs(SEED_SKILL_DEFS);
const localLeakBody = SEED_SKILL_DEFS.find((d) => d.skillId === LEAK_SKILL_ID)!.instructions;

/** A frame's required fields, minimal, for capture tests. Overridden per-case. */
function captureBase() {
  return {
    sessionId: "sess-test",
    model: "claude-haiku-4-5-20251001",
    systemPrompt: "you are a support agent",
    userQuery: "reset my account password",
    floor: 3.5,
    config: seedConfig,
    localDefs: defs,
  } as const;
}

describe("resolveSkillBody — Cloud-first (snapshot.instructions ?? localDef.instructions)", () => {
  it("falls back to the LOCAL def body for a seed skill (body-less snapshot)", () => {
    // The seed snapshot carries no `instructions`, so Cloud-first resolves to the local def.
    expect(resolveSkillBody(seedConfig, defs, LEAK_SKILL_ID)).toBe(localLeakBody);
  });

  it("uses the SNAPSHOT body for a Cloud-authored skill with no local def", () => {
    const authored: AgentConfig = {
      id: "cfg_authored",
      systemPrompt: "",
      tools: [],
      modelDefault: "m",
      skills: [
        { skillId: "live-agent-handoff", description: "talk to a human", name: "Human Handoff", tags: ["human"], instructions: "AUTHORED BODY" },
      ],
    };
    expect(resolveSkillBody(authored, indexSkillDefs([]), "live-agent-handoff")).toBe("AUTHORED BODY");
  });

  it("returns undefined for an unknown skill", () => {
    expect(resolveSkillBody(seedConfig, defs, "does-not-exist")).toBeUndefined();
  });

  it("when BOTH a snapshot body and a local body exist, the snapshot (Cloud) wins", () => {
    const both: AgentConfig = {
      id: "cfg_both",
      systemPrompt: "",
      tools: [],
      modelDefault: "m",
      skills: [{ skillId: LEAK_SKILL_ID, description: "d", instructions: "SNAPSHOT BODY" }],
    };
    expect(resolveSkillBody(both, defs, LEAK_SKILL_ID)).toBe("SNAPSHOT BODY");
    // local-first would have returned the seed body — prove Cloud-first diverges:
    expect(resolveSkillBody(both, defs, LEAK_SKILL_ID)).not.toBe(localLeakBody);
  });
});

describe("captureContextFrame", () => {
  it("marks clearedFloor by comparing each hit's score to the floor", () => {
    const frame = captureContextFrame({
      ...captureBase(),
      hits: [
        { toolId: "account-recovery", score: 5.0 },
        { toolId: "doc-summary", score: 2.0 },
      ],
      invokedSkillIds: ["account-recovery"],
    });
    expect(frame.retrieved).toEqual([
      { skillId: "account-recovery", score: 5.0, clearedFloor: true },
      { skillId: "doc-summary", score: 2.0, clearedFloor: false },
    ]);
  });

  it("derives outcome as a total function: tool / answered / missed", () => {
    const tool = captureContextFrame({
      ...captureBase(),
      hits: [{ toolId: "account-recovery", score: 9 }],
      invokedSkillIds: ["account-recovery"],
    });
    expect(tool.outcome).toBe("tool");

    const answered = captureContextFrame({
      ...captureBase(),
      hits: [{ toolId: "account-recovery", score: 1 }],
      invokedSkillIds: [],
      answer: "Here's how to reset your password…",
    });
    expect(answered.outcome).toBe("answered");

    const missed = captureContextFrame({
      ...captureBase(),
      hits: [{ toolId: "account-recovery", score: 1 }],
      invokedSkillIds: [],
    });
    expect(missed.outcome).toBe("missed");
  });

  it("resolves invokedBodies only for invoked skills, and omits the key when nothing ran", () => {
    const invoked = captureContextFrame({
      ...captureBase(),
      hits: [{ toolId: LEAK_SKILL_ID, score: 9 }],
      invokedSkillIds: [LEAK_SKILL_ID],
    });
    expect(invoked.invokedBodies).toEqual({ [LEAK_SKILL_ID]: localLeakBody });

    const missed = captureContextFrame({
      ...captureBase(),
      hits: [{ toolId: LEAK_SKILL_ID, score: 1 }],
      invokedSkillIds: [],
    });
    expect(missed.invokedBodies).toBeUndefined();
  });

  it("defaults configId to config.id and generates a turnId/ts when omitted", () => {
    const frame = captureContextFrame({
      ...captureBase(),
      hits: [],
      invokedSkillIds: [],
    });
    expect(frame.configId).toBe(seedConfig.id);
    expect(frame.turnId).toMatch(/^turn_/);
    expect(frame.ts).toBeGreaterThan(0);
  });
});

describe("ContextFrame is a compatible superset of the example app's frame", () => {
  it("accepts every field the example app's ContextFrame sets (lossless Phase-3 adoption)", () => {
    // Mirrors apps/example/src/sia/context-frame.ts field set + types. Compiles only if every
    // example field is settable on the canonical ContextFrame with a compatible type; the
    // Phase-2 additions (configId/sessionId/floor/retrieved/invokedSkillIds) are what adoption adds.
    const adopted: ContextFrame = {
      turnId: "turn_x",
      ts: 1,
      model: "m",
      systemPrompt: "s",
      userQuery: "q",
      toolCalls: [{ toolId: "a", args: { utterance: "q" }, result: "r" }],
      answer: "ans",
      steps: 2,
      tokens: { input: 1, output: 2, total: 3 },
      outcome: "answered", // the example's narrower union ("answered" | "tool")
      configId: "cfg",
      sessionId: "sess",
      floor: 3.5,
      retrieved: [],
      invokedSkillIds: [],
    };
    for (const k of [
      "turnId", "ts", "model", "systemPrompt", "userQuery",
      "toolCalls", "answer", "steps", "tokens", "outcome",
    ]) {
      expect(adopted).toHaveProperty(k);
    }
  });
});
