import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import router from "./routes";
import { WebhookHandlers } from "./lib/webhookHandlers.js";
import { getAppBaseUrl } from "./lib/config.js";

const app: Express = express();

// Replit runs the app behind a reverse proxy; trust the first hop so
// express-rate-limit can read the real client IP from X-Forwarded-For.
app.set("trust proxy", 1);

// ── Security headers ─────────────────────────────────────────────────────────
// helmet sets safe defaults: X-Content-Type-Options, X-Frame-Options,
// Strict-Transport-Security, Referrer-Policy, etc.
// contentSecurityPolicy is disabled because the API serves only JSON; CSP is
// handled by the Vite PWA (which has its own meta tags).
app.use(helmet({ contentSecurityPolicy: false }));

// ── CORS ─────────────────────────────────────────────────────────────────────
// Allow requests only from the app's own origin (dev Replit domain or the
// APP_URL set in production). The Stripe webhook and any same-origin requests
// use raw Buffer / no-CORS paths and are unaffected.
const allowedOrigins = (() => {
  const origins = new Set<string>();
  try { origins.add(new URL(getAppBaseUrl()).origin); } catch {}
  // Also allow the bare Replit dev domain in case the port suffix differs.
  if (process.env.REPLIT_DEV_DOMAIN) {
    origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
  }
  return [...origins];
})();

app.use(
  cors({
    origin: (origin, cb) => {
      // Allow requests with no Origin header (curl, server-to-server, Postman).
      if (!origin) return cb(null, true);
      if (allowedOrigins.some((o) => origin === o || origin.startsWith(o))) {
        return cb(null, true);
      }
      cb(new Error(`CORS: origin '${origin}' não permitido.`));
    },
    credentials: true,
  }),
);

// Stripe webhook MUST be registered before express.json(): stripe-replit-sync
// needs the raw request body (Buffer) to verify the signature.
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature" });
      return;
    }
    try {
      const sig = Array.isArray(signature) ? signature[0] : signature;
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (error) {
      console.error("[stripe] webhook error:", error);
      res.status(400).json({ error: "Webhook processing error" });
    }
  },
);

app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true, limit: "12mb" }));

app.use("/api", router);

export default app;
