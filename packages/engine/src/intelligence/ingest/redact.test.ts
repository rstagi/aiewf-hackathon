import { describe, expect, it } from "vitest";
import { redactContent } from "./redact";

describe("redactContent", () => {
  it("scrubs common credential shapes before content leaves the machine", () => {
    expect(redactContent("key sk-abcdefghijklmnop1234")).toContain("[REDACTED]");
    expect(redactContent("Authorization: Bearer abcdefghijkl123456")).toContain("Bearer [REDACTED]");
    expect(redactContent('password = "hunter2hunter2"')).toContain("[REDACTED]");
    expect(redactContent("ghp_0123456789012345678901")).toContain("[REDACTED]");
  });

  it("leaves ordinary prose untouched", () => {
    const t = "Done. Pulled the Granola conversation and added it to the Convo Tracker.";
    expect(redactContent(t)).toBe(t);
  });

  it("caps very long content so a giant paste can't bloat a model call", () => {
    const out = redactContent("x".repeat(20000));
    expect(out.length).toBeLessThan(16100);
    expect(out.endsWith("[TRUNCATED]")).toBe(true);
  });

  it("scrubs the password in a connection-string / URL userinfo", () => {
    const out = redactContent("postgres://admin:s3cr3tPassw0rd@db.internal:5432/app");
    expect(out).toContain("admin:[REDACTED]@");
    expect(out).not.toContain("s3cr3tPassw0rd");
  });

  it("scrubs a quoted credential value that contains spaces", () => {
    const out = redactContent('secret = "correct horse battery staple"');
    expect(out).not.toContain("correct horse battery staple");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts BEFORE truncating, so a PEM key straddling the 16k cut can't leak its head", () => {
    const key = `-----BEGIN PRIVATE KEY-----\n${"A".repeat(400)}\n-----END PRIVATE KEY-----`;
    const out = redactContent("x".repeat(15900) + key); // BEGIN sits before 16k, END after it
    expect(out).toContain("[REDACTED_PRIVATE_KEY]");
    expect(out).not.toContain("BEGIN PRIVATE KEY");
  });
});
