// Minimal Stripe webhook handler — delegates entirely to stripe-replit-sync,
// which validates the signature and syncs data into the `stripe` schema.
import { getStripeSync } from "./stripeClient.js";

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        "STRIPE WEBHOOK ERROR: payload deve ser um Buffer. " +
          "Provavelmente express.json() rodou antes desta rota. " +
          "Registre a rota do webhook ANTES de app.use(express.json()).",
      );
    }
    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);
  }
}
