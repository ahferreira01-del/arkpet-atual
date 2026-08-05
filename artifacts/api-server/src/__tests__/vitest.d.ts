/**
 * Augments Vitest's ProvidedContext so that `inject("e2eCtx")` is typed
 * correctly and the TS2345 "never" error in helpers/setup.ts is resolved.
 */
import type { TestContext } from "./helpers/setup.js";

declare module "vitest" {
  export interface ProvidedContext {
    e2eCtx: TestContext;
  }
}
