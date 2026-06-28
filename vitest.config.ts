import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Engine + contract + sdk unit tests. Cloud (Next) has its own runner if needed.
    include: ["packages/**/*.test.ts"],
    environment: "node",
  },
});
