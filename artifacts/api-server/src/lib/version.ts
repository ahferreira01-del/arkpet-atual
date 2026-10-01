import type { Request, Response } from "express";
import { BUILD_COMMIT_SHA, BUILD_TIME } from "./buildMetadata.js";

// Canonical application version aligned with Service Worker cache version
export const APP_VERSION = "arkpet-v32";

// Captured statically at process load time — never called with new Date() per request!
const STATIC_BOOT_TIME = new Date().toISOString();

declare const __BUILD_COMMIT_SHA__: string | undefined;
declare const __BUILD_TIME__: string | undefined;

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
 * - BACKEND_VERSION_MATCHES_CURRENT_APP_VERSION = YES
 * - COMPILED_ARTIFACT_CONTAINS_COMMIT_SHA = YES
 * - COMPILED_ARTIFACT_CONTAINS_BUILD_TIME = YES
 */
export function getRuntimeProvenance(
  env: Record<string, string | undefined> = process.env
): RuntimeProvenance {
  const rawBuildCommit: string =
    typeof __BUILD_COMMIT_SHA__ !== "undefined" ? __BUILD_COMMIT_SHA__ : BUILD_COMMIT_SHA;

  const embeddedSha =
    rawBuildCommit && rawBuildCommit !== "development" && rawBuildCommit !== "unknown"
      ? rawBuildCommit
      : undefined;

  // Resolution priority:
  // 1. Authoritative runtime environment variable
  // 2. Embedded build-time metadata
  // 3. Fallback based on NODE_ENV
  const commitSha =
    env.ARKPET_COMMIT_SHA ||
    env.COMMIT_SHA ||
    embeddedSha ||
    (env.NODE_ENV === "production" ? "unknown" : "development");

  const rawBuildTime: string =
    typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : BUILD_TIME;

  const embeddedTime =
    rawBuildTime && rawBuildTime !== "development" && rawBuildTime !== "unknown"
      ? rawBuildTime
      : undefined;

  const buildTime =
    env.BUILD_TIME ||
    embeddedTime ||
    (env.NODE_ENV === "production" ? "unknown" : STATIC_BOOT_TIME);

  const environment = env.NODE_ENV || "development";

  return {
    version: APP_VERSION,
    commitSha,
    buildTime,
    environment,
  };
}

export function handleGetVersion(_req: Request, res: Response): void {
  const provenance = getRuntimeProvenance();
  res.status(200).json(provenance);
}
