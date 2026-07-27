import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Single shared creche is registered in globalSetup; run files sequentially
    // to avoid hitting the sensitiveLimiter (10 req/hour) and DB contention.
    fileParallelism: false,
    globalSetup: ["src/__tests__/global-setup.ts"],
    include: ["src/__tests__/**/*.test.ts"],
    reporters: ["verbose"],
  },
});
