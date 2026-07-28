/**
 * Vitest config for pure unit tests that do NOT need a running API server.
 * Run with: pnpm vitest run --config vitest.unit.config.ts
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    fileParallelism: false,
    // No globalSetup — these tests are self-contained and do not need a live DB
    // or API server.
    include: ["src/__tests__/**/*.unit.test.ts"],
    reporters: ["verbose"],
  },
});
