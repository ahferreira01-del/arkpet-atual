import express, { type Express } from "express";
import cors from "cors";
import router from "./routes";
import { WebhookHandlers } from "./lib/webhookHandlers.js";

const app: Express = express();

// Replit runs the app behind a reverse proxy; trust the first hop so
// express-rate-limit can read the real client IP from X-Forwarded-For.
app.set("trust proxy", 1);

app.use(cors());

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
