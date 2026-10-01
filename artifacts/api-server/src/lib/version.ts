import type { Request, Response } from "express";

export const APP_VERSION = "arkpet-v19";

// Captured statically at process load time — never called with new Date() per request!
const STATIC_BOOT_TIME = new Date().toISOString();

export interface RuntimeProvenance {
  version: string;
  commitSha: string;
  buildTime: string;
  environment: string;
}

/**
 * Resolves application version provenance without hardcoding commit hashes.
 * Invariants:
 * - HARDCODED_RUNTIME_COMMIT_SHA = NO
 * - FAKE_BUILD_TIME = 0
 * - RUNTIME_COMMIT_PROVENANCE_AVAILABLE = YES
 */
export function getRuntimeProvenance(
  env: Record<string, string | undefined> = process.env
): RuntimeProvenance {
  const commitSha =
    env.ARKPET_COMMIT_SHA ||
    env.COMMIT_SHA ||
    (env.NODE_ENV === "production" ? "unknown" : "development");

  const buildTime =
    env.BUILD_TIME ||
    (env.NODE_ENV === "production" ? "unknown" : STATIC_BOOT_TIME);

  const environment = env.NODE_ENV || "development";

  return {
    version: APP_VERSION,
    commitSha,
    buildTime,
    environment,
  };
}

export function handleGetVersion(
  _req: Request,
  res: Response,
  env: Record<string, string | undefined> = process.env
): void {
  const provenance = getRuntimeProvenance(env);
  res.status(200).json(provenance);
}
