import app from "./app";
import { initializeDatabase, initStripe } from "./startup.js";
import { startScheduler, startMensalidadeScheduler, startScheduledPlanChangeApplicator, startPastDueSuspender, startReceiptCleanupJob } from "./lib/scheduler.js";

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

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}


const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

initializeDatabase().then(() => {
  startScheduler();
  startMensalidadeScheduler();
  startScheduledPlanChangeApplicator();
  startPastDueSuspender();
  startReceiptCleanupJob();
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    // Stripe init (product/price seeding + sync) runs after the server is
    // already serving requests so it never blocks the health check.
    initStripe().catch((err) =>
      console.error("[startup] Falha ao inicializar Stripe:", err),
    );
  });
}).catch((err) => {
  console.error("[startup] Falha na inicialização:", err);
  process.exit(1);
});
