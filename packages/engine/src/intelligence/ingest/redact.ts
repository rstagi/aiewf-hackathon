/**
 * Secret redaction for turn content, ported verbatim from the ratel capture hook
 * (`capture-chat.mjs`). The ratel chat channel scrubs credentials at capture time, so anything
 * read from it is already safe. Claude Code's own transcripts (see `claude-code-source.ts`) are
 * RAW, so when we use them as the analysis source we must apply the same scrubbing BEFORE turns
 * are sent to an external judge/extractor (Anthropic, the HF Flow-Judge endpoint). The local
 * `/chat` debug view stays raw — it never leaves localhost.
 *
 * Order matters: structured/labelled patterns run before the broad token patterns. Also caps
 * very long turns (matching the hook's 16k limit) so a giant paste can't bloat a model call.
 *
 * Framework-free: pure string transforms, no I/O.
 */

const MAX_CONTENT = 16000;

const REDACTIONS: { re: RegExp; to: string }[] = [
  // PEM private key blocks (any key type) — collapse the whole block.
  {
    re: /-----BEGIN (?:[A-Z0-9 ]*)PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]*)PRIVATE KEY-----/g,
    to: "[REDACTED_PRIVATE_KEY]",
  },
  // JWTs (three base64url segments).
  { re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, to: "[REDACTED_JWT]" },
  // URL / connection-string userinfo: scheme://user:password@host — scrub the password component.
  { re: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:@/]+):[^\s@/]+@/gi, to: "$1$2:[REDACTED]@" },
  // OpenAI-style keys.
  { re: /\b(sk-[A-Za-z0-9_-]{16,})\b/g, to: "[REDACTED]" },
  // Bearer tokens.
  { re: /\b(Bearer)\s+[A-Za-z0-9._-]{12,}/gi, to: "$1 [REDACTED]" },
  // Slack tokens.
  { re: /\b(xox[baprs]-[A-Za-z0-9-]{8,})\b/g, to: "[REDACTED]" },
  // GitHub tokens.
  { re: /\b(gh[pousr]_[A-Za-z0-9]{20,})\b/g, to: "[REDACTED]" },
  // AWS access key ids.
  { re: /\bAKIA[0-9A-Z]{16}\b/g, to: "[REDACTED_AWS_KEY]" },
  // Google API keys.
  { re: /\bAIza[0-9A-Za-z\-_]{35}\b/g, to: "[REDACTED_GOOGLE_KEY]" },
  // aws_secret_access_key assignments (=, :, or =>), quoted or bare.
  { re: /\b(aws_secret_access_key)(\s*[:=]>?\s*)(['"]?)[^\s'"]+\3/gi, to: "$1$2$3[REDACTED]$3" },
  // Generic credential assignments (password/passwd/secret/token/api_key) — QUOTED value first so a
  // value containing spaces is consumed up to its closing quote, then the bare (whitespace-stopped) form.
  { re: /\b(password|passwd|secret|token|api[_-]?key)(\s*[:=]>?\s*)(['"])[^\n]*?\3/gi, to: "$1$2$3[REDACTED]$3" },
  { re: /\b(password|passwd|secret|token|api[_-]?key)(\s*[:=]>?\s*)[^\s'"]+/gi, to: "$1$2[REDACTED]" },
];

/**
 * Scrub credentials, THEN truncate over-long content. Order matters: redacting first means a secret
 * (e.g. a PEM block) that straddles the MAX_CONTENT boundary is still matched as a whole and removed
 * before the cut, rather than leaking its un-terminated head. The regexes are linear, so running them
 * on the full input is safe.
 */
export function redactContent(text: string): string {
  let out = text;
  for (const { re, to } of REDACTIONS) out = out.replace(re, to);
  return out.length > MAX_CONTENT ? `${out.slice(0, MAX_CONTENT)}[TRUNCATED]` : out;
}
