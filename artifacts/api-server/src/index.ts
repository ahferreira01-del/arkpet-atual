import app from "./app";
import { initializeDatabase, initStripe } from "./startup.js";
import { startScheduler, startMensalidadeScheduler, startScheduledPlanChangeApplicator, startPastDueSuspender, startReceiptCleanupJob, startExpiredOrderCanceller, startOutboxWorker, startTrialExpirationJob } from "./lib/scheduler.js";

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

const rawPort = process.env["PORT"] ?? "8080";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Schema provisioning must complete before accepting booking traffic to prevent
// requests from hitting tables that don't exist yet on a fresh deployment.
initializeDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
      startScheduler();
      startMensalidadeScheduler();
      startScheduledPlanChangeApplicator();
      startPastDueSuspender();
      startTrialExpirationJob();
      startReceiptCleanupJob();
      startExpiredOrderCanceller();
      startOutboxWorker();
      // Stripe init runs after DB so price seeding has the schema ready.
      initStripe().catch((err) => {
        console.error("[startup] Stripe init error (non-fatal):", err);
      });
    });
  })
  .catch((err) => {
    // DDL or critical DB failure: do not serve with a broken schema.
    // Terminate so the process supervisor / deploy health-check detects the failure.
    console.error("[startup] Falha crítica na inicialização — encerrando processo:", err);
    process.exit(1);
  });
