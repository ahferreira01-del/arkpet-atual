import type { Server } from "http";
import app from "./app";
import { pool } from "@workspace/db";
import { validateJwtConfig } from "./lib/auth.js";
import { initializeDatabase, initStripe } from "./startup.js";
import {
  startScheduler,
  startMensalidadeScheduler,
  startScheduledPlanChangeApplicator,
  startPastDueSuspender,
  startReceiptCleanupJob,
  startExpiredOrderCanceller,
  startOutboxWorker,
  startTrialExpirationJob,
  startGatewayEventRecoveryWorker,
  stopAllSchedulers,
} from "./lib/scheduler.js";

// Process-level backstop: a stray rejected promise or thrown error in async
// code (e.g. a transient DB/network hiccup) must NEVER silently crash the API
// and take every user's login down. Log it and keep serving; real bugs still
// surface in logs without an outage.
process.on("unhandledRejection", (reason) => {
  console.error("[process] unhandledRejection (kept alive):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[process] uncaughtException (kept alive):", err);
});

// Validate JWT configuration before boot (fails fast in production if missing)
try {
  validateJwtConfig();
} catch (configErr) {
  console.error("[startup] Configuration error:", configErr instanceof Error ? configErr.message : String(configErr));
  process.exit(1);
}

const rawPort = process.env["PORT"] ?? "8080";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/**
 * Creates an idempotent graceful shutdown handler.
 * Stops all background schedulers, drains active HTTP requests, closes the HTTP server, and terminates the DB pool cleanly.
 */
export function createGracefulShutdown(
  server: Server,
  dbPool: { end: () => Promise<void> } = pool,
  exitFn: (code: number) => void = (code) => process.exit(code),
  stopSchedulersFn: () => number = stopAllSchedulers
) {
  let isShuttingDown = false;

  return async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[shutdown] Received ${signal} — initiating graceful shutdown...`);

    // Stop all background schedulers first so no new cron ticks start during drain
    try {
      stopSchedulersFn();
    } catch (schedErr) {
      console.error("[shutdown] Error stopping schedulers:", schedErr);
    }

    // Safety timeout (10s) — forces termination if connections fail to drain
    const forceTimer = setTimeout(() => {
      console.error("[shutdown] Graceful shutdown timed out after 10s. Forcing exit.");
      exitFn(1);
    }, 10_000);
    if (forceTimer.unref) forceTimer.unref();

    server.close(async (err) => {
      if (err) {
        console.error("[shutdown] Error closing HTTP server:", err);
      } else {
        console.log("[shutdown] HTTP server closed — in-flight requests drained.");
      }

      try {
        await dbPool.end();
        console.log("[shutdown] Database pool terminated cleanly.");
      } catch (poolErr) {
        console.error("[shutdown] Error terminating database pool:", poolErr);
      }

      clearTimeout(forceTimer);
      console.log("[shutdown] Graceful shutdown completed.");
      exitFn(0);
    });
  };
}

// Schema provisioning must complete before accepting booking traffic to prevent
// requests from hitting tables that don't exist yet on a fresh deployment.
if (process.env.NODE_ENV !== "test") {
  initializeDatabase()
    .then(() => {
      const server: Server = app.listen(port, () => {
        console.log(`Server listening on port ${port}`);
        startScheduler();
        startMensalidadeScheduler();
        startScheduledPlanChangeApplicator();
        startPastDueSuspender();
        startTrialExpirationJob();
        startReceiptCleanupJob();
        startExpiredOrderCanceller();
        startOutboxWorker();
        startGatewayEventRecoveryWorker();
        // Stripe init runs after DB so price seeding has the schema ready.
        initStripe().catch((err) => {
          console.error("[startup] Stripe init error (non-fatal):", err);
        });
      });

      const shutdownHandler = createGracefulShutdown(server, pool);
      process.on("SIGTERM", () => shutdownHandler("SIGTERM"));
      process.on("SIGINT", () => shutdownHandler("SIGINT"));
    })
    .catch((err) => {
      // DDL or critical DB failure: do not serve with a broken schema.
      // Terminate so the process supervisor / deploy health-check detects the failure.
      console.error("[startup] Falha crítica na inicialização — encerrando processo:", err);
      process.exit(1);
    });
}
