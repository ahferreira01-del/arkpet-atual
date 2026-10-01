import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

const router = Router();

/**
 * Liveness Probe: Inexpensive, zero database dependency.
 * Proves the HTTP process is alive and accepting traffic.
 * Contract: LIVENESS_DB_DEPENDENCY = NO
 */
export function handleLivenessCheck(_req: Request, res: Response): void {
  res.status(200).json({ status: "ok" });
}

/**
 * Readiness Probe: Checks database connectivity with a strict timeout.
 * Zero external paid dependencies (no Stripe, no Resend).
 * Contract: READINESS_EXPENSIVE_EXTERNAL_DEPENDENCY = 0
 */
export async function handleReadinessCheck(
  _req: Request,
  res: Response,
  dbPool: any = pool
): Promise<void> {
  const timeoutMs = 2000;
  let timeoutHandle: NodeJS.Timeout;

  try {
    const queryPromise = dbPool.query("SELECT 1");
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error("Database readiness probe timed out")), timeoutMs);
    });

    await Promise.race([queryPromise, timeoutPromise]);
    clearTimeout(timeoutHandle!);

    res.status(200).json({
      status: "ok",
      checks: {
        database: "healthy",
      },
    });
  } catch (err) {
    clearTimeout(timeoutHandle!);
    // Safe technical logging without leaking credentials or raw driver strings
    // READINESS_RAW_DRIVER_ERROR_LOGGED = 0
    logger.warn("readiness_check_failed", {
      reason: "database_unavailable",
      errorCode: (err as any)?.code || "DATABASE_ERROR",
    });

    res.status(503).json({
      status: "unhealthy",
      checks: {
        database: "down",
      },
    });
  }
}

// ── Route Mounts ──
router.get("/health", handleLivenessCheck);
router.get("/healthz", handleLivenessCheck);
router.get("/ready", (req: Request, res: Response) => handleReadinessCheck(req, res));

export default router;
