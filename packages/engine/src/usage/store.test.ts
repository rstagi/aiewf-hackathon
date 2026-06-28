import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtendedTraceEnvelope, Proposal } from "@sia/contract";
import { FileUsageStore, MemoryUsageStore } from "./store";
import { FileProposalStore, MemoryProposalStore } from "../proposals/store";

const env = (overrides: Partial<ExtendedTraceEnvelope> = {}): ExtendedTraceEnvelope =>
  ({
    v: 1,
    ts: 1000,
    session_id: "sess-1",
    type: "search",
    query: "reset my account password",
    origin: "agent",
    top_k: 5,
    hits: [{ tool_id: "account-recovery", score: 2.5 }],
    took_ms: 1,
    configId: "cfg_abc",
    arm: "champion",
    ...overrides,
  }) as ExtendedTraceEnvelope;

const proposal = (overrides: Partial<Proposal> = {}): Proposal => ({
  id: "prop-1",
  intentLabel: "reset password account",
  queries: ["reset my account password", "recover my account password"],
  route: "improve-existing",
  rationale: "account-recovery is a near-miss; sharpen its description.",
  change: { kind: "rewrite_skill_desc", skillId: "account-recovery", to: "Reset a forgotten password." },
  status: "proposed",
  createdAt: 1000,
  ...overrides,
});

describe("UsageStore (Memory + File)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sia-usage-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("MemoryUsageStore round-trips appended envelopes", async () => {
    const store = new MemoryUsageStore();
    await store.append([env(), env({ type: "invoke_start", tool_id: "doc-summary" } as Partial<ExtendedTraceEnvelope>)]);
    expect(await store.load()).toHaveLength(2);
  });

  it("FileUsageStore appends across calls and preserves camelCase attribution", async () => {
    const store = new FileUsageStore(join(dir, "usage.jsonl"));
    await store.append([env()]);
    await store.append([env({ ts: 2000 })]);
    const loaded = await store.load();
    expect(loaded).toHaveLength(2);
    expect(loaded[0].configId).toBe("cfg_abc");
    expect(loaded[0].arm).toBe("champion");
  });

  it("FileUsageStore.load on a missing file is empty; empty append is a no-op", async () => {
    const store = new FileUsageStore(join(dir, "none.jsonl"));
    expect(await store.load()).toEqual([]);
    await store.append([]);
    expect(await store.load()).toEqual([]);
  });
});

describe("ProposalStore (Memory + File)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sia-prop-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  for (const make of [
    () => new MemoryProposalStore(),
    () => new FileProposalStore(join(mkdtempSync(join(tmpdir(), "sia-prop-f-")), "proposals.json")),
  ]) {
    it(`${make().constructor.name}: save → list/get → setStatus`, async () => {
      const store = make();
      await store.save(proposal());
      await store.save(proposal({ id: "prop-2", route: "create-new" }));
      expect(await store.list()).toHaveLength(2);
      expect((await store.get("prop-1"))?.route).toBe("improve-existing");

      await store.save(proposal({ rationale: "updated" })); // replace, not duplicate
      expect(await store.list()).toHaveLength(2);
      expect((await store.get("prop-1"))?.rationale).toBe("updated");

      await store.setStatus("prop-1", "applied");
      expect((await store.get("prop-1"))?.status).toBe("applied");
      await expect(store.setStatus("nope", "applied")).rejects.toThrow(/unknown proposal/);
    });
  }
});
