import { openFileRegistry, type ConfigRegistry } from "@sia/engine";
import { SEED_CONFIG_DRAFT } from "@sia/seed";
import { REGISTRY_DIR } from "./paths";

// Module-level singleton: Next route handlers share module scope within a server
// process, so GET /api/config/active and the dashboard both see the same seeded
// genesis config. Guard against re-seeding on hot-reload by checking getActiveId().
let registry: ConfigRegistry | undefined;

export function getRegistry(): ConfigRegistry {
  if (!registry) {
    const reg = openFileRegistry(REGISTRY_DIR);
    if (reg.getActiveId() === undefined) {
      // Mint genesis + make it champion. Deterministic id: cfg_abd14cd40fc3.
      reg.seed(SEED_CONFIG_DRAFT);
    }
    registry = reg;
  }
  return registry;
}
