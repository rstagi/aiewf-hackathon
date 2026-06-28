import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contentHash } from "./hash";
import { deepFreeze, deriveChild, modelForSkill } from "./resolve";
import { ConfigRegistry, openFileRegistry, openMemoryRegistry } from "./registry";
import { FileConfigStore } from "./store";
import type { ConfigDraft } from "./types";

const baseDraft: ConfigDraft = {
  systemPrompt: "You are a helpful support agent.",
  skills: [
    { skillId: "account-recovery", description: "Recover an account." },
    { skillId: "doc-summary", description: "Summarize a document." },
  ],
  tools: ["search", "invoke"],
  modelDefault: "claude-haiku-4-5",
};

describe("contentHash", () => {
  it("is deterministic for the same surface", () => {
    expect(contentHash(baseDraft)).toBe(contentHash(baseDraft));
  });

  it("ignores object key order but not array order", () => {
    const reordered: ConfigDraft = {
      modelDefault: baseDraft.modelDefault,
      tools: baseDraft.tools,
      skills: baseDraft.skills,
      systemPrompt: baseDraft.systemPrompt,
    };
    expect(contentHash(reordered)).toBe(contentHash(baseDraft));

    const swappedSkills: ConfigDraft = { ...baseDraft, skills: [...baseDraft.skills].reverse() };
    expect(contentHash(swappedSkills)).not.toBe(contentHash(baseDraft));
  });

  it("changes when any surface field changes", () => {
    const tweaked: ConfigDraft = {
      ...baseDraft,
      skills: [{ ...baseDraft.skills[0], description: "Reset a forgotten password." }, baseDraft.skills[1]],
    };
    expect(contentHash(tweaked)).not.toBe(contentHash(baseDraft));
  });

  it("treats absent and explicit-undefined optional fields identically", () => {
    const withUndef: ConfigDraft = {
      ...baseDraft,
      skills: [{ ...baseDraft.skills[0], suggested_model: undefined }, baseDraft.skills[1]],
    };
    expect(contentHash(withUndef)).toBe(contentHash(baseDraft));
  });

  it("produces a cfg_ prefixed id", () => {
    expect(contentHash(baseDraft)).toMatch(/^cfg_[0-9a-f]{12}$/);
  });
});

describe("deepFreeze + freezeConfig immutability", () => {
  it("prevents mutation of a frozen config", async () => {
    const reg = await openMemoryRegistry();
    const cfg = await reg.seed(baseDraft);
    expect(() => {
      (cfg as { modelDefault: string }).modelDefault = "x";
    }).toThrow();
    expect(() => {
      (cfg.skills[0] as { description: string }).description = "x";
    }).toThrow();
  });

  it("deepFreeze returns the same object reference", () => {
    const o = { a: { b: 1 } };
    expect(deepFreeze(o)).toBe(o);
    expect(Object.isFrozen(o.a)).toBe(true);
  });
});

describe("deriveChild", () => {
  it("rewrites a skill description without mutating the parent", async () => {
    const reg = await openMemoryRegistry();
    const parent = await reg.seed(baseDraft);
    const child = deriveChild(parent, {
      kind: "rewrite_skill_desc",
      skillId: "account-recovery",
      to: "Reset a forgotten password or recover a locked account.",
    });
    expect(child.skills[0].description).toContain("Reset a forgotten password");
    expect(parent.skills[0].description).toBe("Recover an account."); // parent untouched
  });

  it("sets a suggested model", async () => {
    const reg = await openMemoryRegistry();
    const parent = await reg.seed(baseDraft);
    const child = deriveChild(parent, {
      kind: "set_suggested_model",
      skillId: "doc-summary",
      to: "claude-opus-4-8",
    });
    expect(child.skills[1].suggested_model).toBe("claude-opus-4-8");
    expect(parent.skills[1].suggested_model).toBeUndefined();
  });

  it("throws on an unknown skill", async () => {
    const reg = await openMemoryRegistry();
    const parent = await reg.seed(baseDraft);
    expect(() =>
      deriveChild(parent, { kind: "rewrite_skill_desc", skillId: "nope", to: "x" }),
    ).toThrow(/not found/);
  });
});

describe("deriveChild add_skill (Cloud-authored capability)", () => {
  const newSkill = {
    kind: "add_skill" as const,
    skillId: "live-agent-handoff",
    name: "Live Agent Handoff",
    description: "Connect the user to a human support agent.",
    tags: ["human", "agent", "handoff"],
    instructions: "Collect the issue summary, then route the user to a live human agent.",
  };

  it("appends a brand-new skill carrying its own body, without touching the parent", async () => {
    const reg = await openMemoryRegistry();
    const parent = await reg.seed(baseDraft);
    const child = deriveChild(parent, newSkill);
    expect(child.skills).toHaveLength(parent.skills.length + 1);
    const added = child.skills.find((s) => s.skillId === "live-agent-handoff")!;
    expect(added.name).toBe("Live Agent Handoff");
    expect(added.tags).toEqual(["human", "agent", "handoff"]);
    expect(added.instructions).toContain("live human agent");
    expect(parent.skills.some((s) => s.skillId === "live-agent-handoff")).toBe(false); // parent untouched
  });

  it("mints a new content id with parent lineage", async () => {
    const reg = await openMemoryRegistry();
    const v1 = await reg.seed(baseDraft);
    const v2 = await reg.applyChange(v1.id, newSkill);
    expect(v2.id).not.toBe(v1.id);
    expect(v2.parentId).toBe(v1.id);
  });

  it("throws when the skill already exists (inverse of the mutating-kind precondition)", async () => {
    const reg = await openMemoryRegistry();
    const parent = await reg.seed(baseDraft);
    expect(() => deriveChild(parent, { ...newSkill, skillId: "account-recovery" })).toThrow(/already exists/);
  });

  it("leaves any body-less surface hashing exactly as before (genesis stability)", () => {
    const bodyless: ConfigDraft = {
      ...baseDraft,
      skills: baseDraft.skills.map((s) => ({ ...s, name: undefined, tags: undefined, instructions: undefined })),
    };
    expect(contentHash(bodyless)).toBe(contentHash(baseDraft));
  });
});

describe("modelForSkill", () => {
  it("falls back to the default when no override", async () => {
    const reg = await openMemoryRegistry();
    const cfg = await reg.seed(baseDraft);
    expect(modelForSkill(cfg, "account-recovery")).toBe("claude-haiku-4-5");
  });
  it("uses the override when present", async () => {
    const reg = await openMemoryRegistry();
    const parent = await reg.seed(baseDraft);
    const child = await reg.applyChange(parent.id, {
      kind: "set_suggested_model",
      skillId: "doc-summary",
      to: "claude-opus-4-8",
    });
    expect(modelForSkill(child, "doc-summary")).toBe("claude-opus-4-8");
  });
});

describe("ConfigRegistry", () => {
  it("seeds a genesis config as champion", async () => {
    const reg = await openMemoryRegistry();
    const cfg = await reg.seed(baseDraft);
    expect(reg.getActiveId()).toBe(cfg.id);
    expect(reg.getActive()).toEqual(cfg);
    expect(cfg.parentId).toBeUndefined();
  });

  it("dedups identical surfaces to one snapshot", async () => {
    const reg = await openMemoryRegistry();
    const a = await reg.register(baseDraft);
    const b = await reg.register({ ...baseDraft });
    expect(a.id).toBe(b.id);
    expect(reg.list()).toHaveLength(1);
  });

  it("applyChange registers a child with parent lineage but does not promote it", async () => {
    const reg = await openMemoryRegistry();
    const v1 = await reg.seed(baseDraft);
    const v2 = await reg.applyChange(v1.id, {
      kind: "rewrite_skill_desc",
      skillId: "account-recovery",
      to: "Reset a forgotten password.",
    });
    expect(v2.parentId).toBe(v1.id);
    expect(v2.id).not.toBe(v1.id);
    expect(reg.getActiveId()).toBe(v1.id); // champion unchanged until promoted
  });

  it("promote then rollback is a reversible pointer flip", async () => {
    const reg = await openMemoryRegistry();
    const v1 = await reg.seed(baseDraft);
    const v2 = await reg.applyChange(v1.id, {
      kind: "set_suggested_model",
      skillId: "doc-summary",
      to: "claude-opus-4-8",
    });
    await reg.setActive(v2.id);
    expect(reg.getActiveId()).toBe(v2.id);
    await reg.setActive(v1.id); // rollback
    expect(reg.getActiveId()).toBe(v1.id);
  });

  it("a change that recreates an ancestor surface resolves back to the ancestor id", async () => {
    const reg = await openMemoryRegistry();
    const v1 = await reg.seed(baseDraft);
    const v2 = await reg.applyChange(v1.id, {
      kind: "rewrite_skill_desc",
      skillId: "account-recovery",
      to: "Reset a forgotten password.",
    });
    const back = await reg.applyChange(v2.id, {
      kind: "rewrite_skill_desc",
      skillId: "account-recovery",
      to: "Recover an account.", // original text
    });
    expect(back.id).toBe(v1.id); // dedup collapse ⇒ rollback is free
  });

  it("throws when activating an unknown config", async () => {
    const reg = await openMemoryRegistry();
    await expect(reg.setActive("cfg_deadbeef0000")).rejects.toThrow(/unknown config/);
  });

  it("builds root→leaf lineage", async () => {
    const reg = await openMemoryRegistry();
    const v1 = await reg.seed(baseDraft);
    const v2 = await reg.applyChange(v1.id, {
      kind: "rewrite_skill_desc",
      skillId: "account-recovery",
      to: "Reset a forgotten password.",
    });
    const v3 = await reg.applyChange(v2.id, {
      kind: "set_suggested_model",
      skillId: "doc-summary",
      to: "claude-opus-4-8",
    });
    expect(reg.lineage(v3.id).map((c) => c.id)).toEqual([v1.id, v2.id, v3.id]);
  });
});

describe("FileConfigStore persistence", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "agentctx-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips snapshots and the active pointer across reopen", async () => {
    const reg = await openFileRegistry(dir);
    const v1 = await reg.seed(baseDraft);
    const v2 = await reg.applyChange(v1.id, {
      kind: "set_suggested_model",
      skillId: "doc-summary",
      to: "claude-opus-4-8",
    });
    await reg.setActive(v2.id);

    const reopened = await ConfigRegistry.open(new FileConfigStore(dir));
    expect(reopened.getActiveId()).toBe(v2.id);
    expect(reopened.list().map((c) => c.id).sort()).toEqual([v1.id, v2.id].sort());
    expect(reopened.get(v2.id)?.parentId).toBe(v1.id);
    expect(Object.isFrozen(reopened.get(v1.id))).toBe(true);
  });

  it("preserves a Cloud-authored skill body across reopen, with no content-hash divergence", async () => {
    const reg = await openFileRegistry(dir);
    const v1 = await reg.seed(baseDraft);
    const v2 = await reg.applyChange(v1.id, {
      kind: "add_skill",
      skillId: "live-agent-handoff",
      name: "Live Agent Handoff",
      description: "Connect the user to a human support agent.",
      tags: ["human", "agent", "handoff"],
      instructions: "Route the user to a live human agent.",
    });

    const reopened = await ConfigRegistry.open(new FileConfigStore(dir));
    const got = reopened.get(v2.id)!;
    const added = got.skills.find((s) => s.skillId === "live-agent-handoff")!;
    expect(added.name).toBe("Live Agent Handoff");
    expect(added.tags).toEqual(["human", "agent", "handoff"]);
    expect(added.instructions).toBe("Route the user to a live human agent.");
    // The reloaded surface still hashes to its stored id — proves normalizeSkill carried the
    // body through (a body-stripping normalize would make this diverge).
    expect(
      contentHash({
        systemPrompt: got.systemPrompt,
        skills: got.skills,
        tools: got.tools,
        modelDefault: got.modelDefault,
      }),
    ).toBe(v2.id);
  });
});
