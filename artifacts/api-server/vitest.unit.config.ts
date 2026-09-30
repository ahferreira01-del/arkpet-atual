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
    env: {
      // Deliberately non-connectable sentinel endpoint for safe offline unit tests (R36.D Correction 12)
      DATABASE_URL: process.env.DATABASE_URL || "postgresql://sentinel-do-not-connect:0/unreachable_db",
      VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || "BFtestVapidPublicKeyForUnitTestingPurposesOnly123456789=",
      VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || "testVapidPrivateKey123=",
    },
  },
});
