/**
 * Invocation-error taxonomy (§3.2 signal 5).
 *
 * `GatewayError.error` is a single untyped string (e.g. "unknown_tool_id",
 * "needs_auth", "MCP error -32000: Connection closed", or a raw handler message).
 * Normalize it into an ownership-bearing category. Pure leaf — no deps.
 */

import type { ErrorCategory } from "../types";

export function classifyError(error: string | undefined | null): ErrorCategory {
  if (!error) return "other";
  const e = error.toLowerCase();

  if (e.includes("unknown_tool_id")) return "unknown_tool";
  if (e.includes("unknown_skill_id")) return "unknown_skill";
  if (e.includes("needs_auth") || e.includes("unauthorized") || e.includes("auth")) return "auth";
  // MCP -32000 is "Connection closed"; treat connection drops / timeouts together.
  if (e.includes("connection closed") || e.includes("-32000") || e.includes("timeout") || e.includes("timed out")) return "timeout";
  if (e.includes("schema") || e.includes("invalid argument") || e.includes("validation") || e.includes("invalid_params") || e.includes("-32602")) return "schema_reject";
  if (e.includes("empty") || e.includes("no result")) return "empty";
  if (e.includes("malformed") || e.includes("parse") || e.includes("not valid json")) return "malformed";
  if (e.includes("mcp error")) return "upstream";
  return "other";
}
