import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * SDK-portability guard: the intelligence core must stay framework-free so it lifts
 * cleanly into the Ratel TS SDK. Nothing under lib/intelligence/** may import next/react.
 */
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const FORBIDDEN = [/from\s+["']next(\/|["'])/, /from\s+["']react(\/|["'])/, /from\s+["']next\/server["']/];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__fixtures__" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("intelligence core is framework-free", () => {
  it("imports neither next nor react anywhere under lib/intelligence", () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const src = readFileSync(file, "utf8");
      if (FORBIDDEN.some((re) => re.test(src))) offenders.push(file.replace(ROOT, ""));
    }
    expect(offenders).toEqual([]);
  });
});
