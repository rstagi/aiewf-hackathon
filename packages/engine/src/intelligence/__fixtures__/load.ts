import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Read a vendored real-telemetry fixture by filename (under ./ratel/). */
export function loadFixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./ratel/${name}`, import.meta.url)), "utf8");
}
