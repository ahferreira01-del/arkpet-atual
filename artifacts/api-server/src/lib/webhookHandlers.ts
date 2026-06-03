// Stripe webhook handler. stripe-replit-sync validates the signature and mirrors
// raw data into the `stripe` schema; we then apply the same (now-verified) event
// to the app's own `subscriptions` lifecycle state.
import { getStripeSync } from "./stripeClient.js";
import { applyStripeEvent } from "./subscriptionSync.js";

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
    // Verifies the signature and syncs the `stripe` schema. Throws on bad sig.
    await sync.processWebhook(payload, signature);

    // Signature is verified above, so parsing the raw payload is safe. Apply the
    // lifecycle transition to the app subscription. Errors propagate so the route
    // returns non-2xx and Stripe retries the delivery.
    const event = JSON.parse(payload.toString("utf8"));
    await applyStripeEvent(event);
  }
}
