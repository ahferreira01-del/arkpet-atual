import app from "./app";
import { initializeDatabase, initStripe } from "./startup.js";
import { startScheduler, startMensalidadeScheduler, startScheduledPlanChangeApplicator, startPastDueSuspender, startReceiptCleanupJob, startExpiredOrderCanceller } from "./lib/scheduler.js";

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

// Open the port FIRST so the Replit health-check probe gets a 200 immediately.
// DB init and schedulers run after — a transient startup error must never
// prevent the port from opening (autoscale deploy would fail the promote step).
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);

  initializeDatabase()
    .then(() => {
      startScheduler();
      startMensalidadeScheduler();
      startScheduledPlanChangeApplicator();
      startPastDueSuspender();
      startReceiptCleanupJob();
      startExpiredOrderCanceller();
      // Stripe init runs after DB so price seeding has the schema ready.
      return initStripe();
    })
    .catch((err) => {
      console.error("[startup] Falha na inicialização (servidor continua ativo):", err);
    });
});
