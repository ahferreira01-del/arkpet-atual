/**
 * Shared test-setup helper.
 *
 * The single test creche is registered once in global-setup.ts and injected
 * into every test file via vitest's provide/inject mechanism, so we never hit
 * the sensitiveLimiter (max 10 register-creche/hour/IP).
 */
import { inject } from "vitest";

export interface TestContext {
  token: string;
  userId: number;
  crecheId: number;
  email: string;
  password: string;
}

/**
 * Returns the shared E2E test context injected by global-setup.ts.
 * Call this inside beforeAll() in each test file.
 */
export function getSharedCtx(): TestContext {
  const ctx = inject("e2eCtx") as TestContext | undefined;
  if (!ctx) {
    throw new Error(
      "[setup] e2eCtx not injected. Make sure vitest.config.ts has globalSetup pointing to global-setup.ts.",
    );
  }
  return ctx;
}
