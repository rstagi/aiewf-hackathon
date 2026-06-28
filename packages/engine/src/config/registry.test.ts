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
  it("prevents mutation of a frozen config", () => {
    const reg = openMemoryRegistry();
    const cfg = reg.seed(baseDraft);
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
  it("rewrites a skill description without mutating the parent", () => {
    const reg = openMemoryRegistry();
    const parent = reg.seed(baseDraft);
    const child = deriveChild(parent, {
      kind: "rewrite_skill_desc",
      skillId: "account-recovery",
      to: "Reset a forgotten password or recover a locked account.",
    });
    expect(child.skills[0].description).toContain("Reset a forgotten password");
    expect(parent.skills[0].description).toBe("Recover an account."); // parent untouched
  });

  it("sets a suggested model", () => {
    const reg = openMemoryRegistry();
    const parent = reg.seed(baseDraft);
    const child = deriveChild(parent, {
      kind: "set_suggested_model",
      skillId: "doc-summary",
      to: "claude-opus-4-8",
    });
    expect(child.skills[1].suggested_model).toBe("claude-opus-4-8");
    expect(parent.skills[1].suggested_model).toBeUndefined();
  });

  it("throws on an unknown skill", () => {
    const reg = openMemoryRegistry();
    const parent = reg.seed(baseDraft);
    expect(() =>
      deriveChild(parent, { kind: "rewrite_skill_desc", skillId: "nope", to: "x" }),
    ).toThrow(/not found/);
  });
});

describe("modelForSkill", () => {
  it("falls back to the default when no override", () => {
    const reg = openMemoryRegistry();
    const cfg = reg.seed(baseDraft);
    expect(modelForSkill(cfg, "account-recovery")).toBe("claude-haiku-4-5");
  });
  it("uses the override when present", () => {
    const reg = openMemoryRegistry();
    const parent = reg.seed(baseDraft);
    const child = reg.applyChange(parent.id, {
      kind: "set_suggested_model",
      skillId: "doc-summary",
      to: "claude-opus-4-8",
    });
    expect(modelForSkill(child, "doc-summary")).toBe("claude-opus-4-8");
  });
});

describe("ConfigRegistry", () => {
  it("seeds a genesis config as champion", () => {
    const reg = openMemoryRegistry();
    const cfg = reg.seed(baseDraft);
    expect(reg.getActiveId()).toBe(cfg.id);
    expect(reg.getActive()).toEqual(cfg);
    expect(cfg.parentId).toBeUndefined();
  });

  it("dedups identical surfaces to one snapshot", () => {
    const reg = openMemoryRegistry();
    const a = reg.register(baseDraft);
    const b = reg.register({ ...baseDraft });
    expect(a.id).toBe(b.id);
    expect(reg.list()).toHaveLength(1);
  });

  it("applyChange registers a child with parent lineage but does not promote it", () => {
    const reg = openMemoryRegistry();
    const v1 = reg.seed(baseDraft);
    const v2 = reg.applyChange(v1.id, {
      kind: "rewrite_skill_desc",
      skillId: "account-recovery",
      to: "Reset a forgotten password.",
    });
    expect(v2.parentId).toBe(v1.id);
    expect(v2.id).not.toBe(v1.id);
    expect(reg.getActiveId()).toBe(v1.id); // champion unchanged until promoted
  });

  it("promote then rollback is a reversible pointer flip", () => {
    const reg = openMemoryRegistry();
    const v1 = reg.seed(baseDraft);
    const v2 = reg.applyChange(v1.id, {
      kind: "set_suggested_model",
      skillId: "doc-summary",
      to: "claude-opus-4-8",
    });
    reg.setActive(v2.id);
    expect(reg.getActiveId()).toBe(v2.id);
    reg.setActive(v1.id); // rollback
    expect(reg.getActiveId()).toBe(v1.id);
  });

  it("a change that recreates an ancestor surface resolves back to the ancestor id", () => {
    const reg = openMemoryRegistry();
    const v1 = reg.seed(baseDraft);
    const v2 = reg.applyChange(v1.id, {
      kind: "rewrite_skill_desc",
      skillId: "account-recovery",
      to: "Reset a forgotten password.",
    });
    const back = reg.applyChange(v2.id, {
      kind: "rewrite_skill_desc",
      skillId: "account-recovery",
      to: "Recover an account.", // original text
    });
    expect(back.id).toBe(v1.id); // dedup collapse ⇒ rollback is free
  });

  it("throws when activating an unknown config", () => {
    const reg = openMemoryRegistry();
    expect(() => reg.setActive("cfg_deadbeef0000")).toThrow(/unknown config/);
  });

  it("builds root→leaf lineage", () => {
    const reg = openMemoryRegistry();
    const v1 = reg.seed(baseDraft);
    const v2 = reg.applyChange(v1.id, {
      kind: "rewrite_skill_desc",
      skillId: "account-recovery",
      to: "Reset a forgotten password.",
    });
    const v3 = reg.applyChange(v2.id, {
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

  it("round-trips snapshots and the active pointer across reopen", () => {
    const reg = openFileRegistry(dir);
    const v1 = reg.seed(baseDraft);
    const v2 = reg.applyChange(v1.id, {
      kind: "set_suggested_model",
      skillId: "doc-summary",
      to: "claude-opus-4-8",
    });
    reg.setActive(v2.id);

    const reopened = new ConfigRegistry(new FileConfigStore(dir));
    expect(reopened.getActiveId()).toBe(v2.id);
    expect(reopened.list().map((c) => c.id).sort()).toEqual([v1.id, v2.id].sort());
    expect(reopened.get(v2.id)?.parentId).toBe(v1.id);
    expect(Object.isFrozen(reopened.get(v1.id))).toBe(true);
  });
});
