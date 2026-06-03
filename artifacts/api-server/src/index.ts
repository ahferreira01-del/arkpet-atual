import app from "./app";
import { initializeDatabase, initStripe } from "./startup.js";
import { startScheduler, startMensalidadeScheduler } from "./lib/scheduler.js";

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

initializeDatabase().then(async () => {
  await initStripe();
  startScheduler();
  startMensalidadeScheduler();
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}).catch((err) => {
  console.error("[startup] Falha na inicialização:", err);
  process.exit(1);
});
