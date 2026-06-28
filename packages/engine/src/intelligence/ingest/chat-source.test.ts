import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HookChatTranscriptSource, parseTurns, isSafeSessionId } from "./chat-source";

describe("parseTurns", () => {
  it("parses {role,content,ts} lines, indexes them, and converts ts to epoch ms", () => {
    const raw = [
      JSON.stringify({ role: "user", content: "hi", ts: "2026-06-24T13:49:57.590Z" }),
      JSON.stringify({ role: "assistant", content: "hello" }),
    ].join("\n");
    const turns = parseTurns(raw);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ role: "user", content: "hi", index: 0 });
    expect(turns[0].ts).toBe(Date.parse("2026-06-24T13:49:57.590Z"));
    expect(turns[1]).toMatchObject({ role: "assistant", content: "hello", index: 1 });
    expect(turns[1].ts).toBeUndefined();
  });

  it("skips malformed lines and non-user/assistant roles without throwing", () => {
    const raw = [
      "{ not json",
      JSON.stringify({ role: "system", content: "ignored" }),
      JSON.stringify({ role: "user", content: "kept" }),
      "",
    ].join("\n");
    const turns = parseTurns(raw);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ role: "user", content: "kept", index: 0 });
  });
});

describe("HookChatTranscriptSource", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "ratel-chat-"));
    mkdirSync(join(dir, "claude-code"), { recursive: true });
    writeFileSync(
      join(dir, "state.json"),
      JSON.stringify({
        version: 1,
        sessions: {
          "sess-1": { sessionId: "sess-1", host: "claude-code", cwd: "/x", updatedAt: "2026-06-24T00:00:00Z" },
        },
      }),
    );
    writeFileSync(
      join(dir, "claude-code", "sess-1.jsonl"),
      [
        JSON.stringify({ role: "user", content: "do a thing", ts: "2026-06-24T13:00:00Z" }),
        JSON.stringify({ role: "assistant", content: "done" }),
      ].join("\n"),
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("lists sessions from state.json", () => {
    const src = new HookChatTranscriptSource(dir);
    const sessions = src.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ sessionId: "sess-1", host: "claude-code", cwd: "/x" });
  });

  it("reads turns for a known session, resolving its host from the index", () => {
    const src = new HookChatTranscriptSource(dir);
    const turns = src.turnsFor("sess-1");
    expect(turns.map((t) => t.content)).toEqual(["do a thing", "done"]);
  });

  it("returns [] for an unknown session and an empty list when state.json is absent", () => {
    expect(new HookChatTranscriptSource(dir).turnsFor("nope")).toEqual([]);
    const emptyDir = mkdtempSync(join(tmpdir(), "ratel-empty-"));
    expect(new HookChatTranscriptSource(emptyDir).listSessions()).toEqual([]);
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("detailFor returns metadata + turns for a known session, and null for an unknown one", () => {
    const src = new HookChatTranscriptSource(dir);
    const detail = src.detailFor("sess-1");
    expect(detail).not.toBeNull();
    expect(detail).toMatchObject({ sessionId: "sess-1", host: "claude-code", cwd: "/x" });
    expect(detail!.turns.map((t) => t.content)).toEqual(["do a thing", "done"]);
    expect(src.detailFor("nope")).toBeNull();
  });
});

describe("isSafeSessionId", () => {
  it("accepts normal session ids (uuids, slugs)", () => {
    expect(isSafeSessionId("9152b764-1a2b-4c3d-9e8f-000000000000")).toBe(true);
    expect(isSafeSessionId("sess-1")).toBe(true);
  });

  it("rejects path-traversal and separator attempts", () => {
    for (const bad of ["", "../etc/passwd", "a/b", "a\\b", "..", "with\0null"]) {
      expect(isSafeSessionId(bad)).toBe(false);
    }
  });
});
