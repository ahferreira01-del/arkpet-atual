import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import router from "./routes";
import { WebhookHandlers } from "./lib/webhookHandlers.js";
import { getAppBaseUrl } from "./lib/config.js";
import { requestIdMiddleware } from "./middlewares/requestId.js";
import { requestLoggerMiddleware } from "./middlewares/requestLogger.js";
import { logger } from "./lib/logger.js";

const app: Express = express();

app.set("trust proxy", 1);

// ── Correlation & Request Observability Middlewares ─────────────────────────
app.use(requestIdMiddleware);
app.use(requestLoggerMiddleware);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
  },
}));

const allowedOrigins = (() => {
  const origins = new Set<string>();
  if (process.env.APP_URL) {
    try { origins.add(new URL(process.env.APP_URL).origin); } catch {}
  }
  const replitDomains = process.env.REPLIT_DOMAINS ?? "";
  for (const host of replitDomains.split(",").map((h) => h.trim()).filter(Boolean)) {
    origins.add(`https://${host}`);
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
  }
  return [...origins];
})();

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (origin.startsWith("http://localhost:")) return cb(null, true);
      if (allowedOrigins.some((o) => origin === o || origin.startsWith(o))) {
        return cb(null, true);
      }
      cb(new Error(`CORS: origin '${origin}' não permitido.`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  }),
);

app.use(compression({
  filter: (req: Request, res: Response) => {
    if (req.path === "/api/stripe/webhook") return false;
    return compression.filter(req, res);
  },
  level: 6,
}));

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
      logger.error("stripe_webhook_error", error, {
        requestId: (req as any).id,
      });
      res.status(400).json({ error: "Webhook processing error" });
    }
  },
);

app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true, limit: "12mb" }));

app.use("/api", router);

app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  const status: number = err.status ?? err.statusCode ?? 500;
  const requestId = (req as any).id;

  // 4xx errors are client errors — log as warn without stack trace
  if (status >= 400 && status < 500) {
    logger.warn("client_error", {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: status,
      messageSafe: err.message,
    });
    res.status(status).json({
      error: err.message,
      requestId,
    });
    return;
  }

  // 5xx unexpected errors: structured logging with requestId
  logger.error("unhandled_error", err, {
    requestId,
    method: req.method,
    path: req.path,
    statusCode: 500,
  });

  // Never leak stack trace, SQL, or internal filesystem paths to client
  res.status(500).json({
    error: "Erro interno do servidor",
    code: "INTERNAL_ERROR",
    requestId,
  });
});

export default app;
