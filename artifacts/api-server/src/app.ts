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
// Allow requests from all Replit-managed domains for this repl (dev preview,
// production .replit.app, and any custom domain configured by the user), plus
// an explicit APP_URL if set. REPLIT_DOMAINS is a comma-separated list of all
// public hostnames Replit assigns to the repl — it covers both dev and prod.
const allowedOrigins = (() => {
  const origins = new Set<string>();

  // APP_URL takes priority (custom production domain).
  if (process.env.APP_URL) {
    try { origins.add(new URL(process.env.APP_URL).origin); } catch {}
  }

  // REPLIT_DOMAINS covers all Replit-managed hostnames (dev + prod).
  // Format: "foo.replit.dev,foo.replit.app" or a single value.
  const replitDomains = process.env.REPLIT_DOMAINS ?? "";
  for (const host of replitDomains.split(",").map((h) => h.trim()).filter(Boolean)) {
    origins.add(`https://${host}`);
  }

  // Explicit dev domain fallback for local dev where REPLIT_DOMAINS may differ.
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
      console.warn(`[cors] origin bloqueado: ${origin} — permitidos: ${allowedOrigins.join(", ")}`);
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
