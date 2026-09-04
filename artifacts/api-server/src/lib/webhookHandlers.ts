// Stripe webhook handler. stripe-replit-sync validates the signature and mirrors
// raw data into the `stripe` schema; we then apply the same (now-verified) event
// to the app's own `subscriptions` lifecycle state.
import Stripe from "stripe";
import { getStripeSync, getStripeSecretKey } from "./stripeClient.js";
import { applyStripeEvent } from "./subscriptionSync.js";
import { applyFinancialStripeEvent } from "./financialSync.js";
import { claimGatewayEvent, finalizeGatewayEvent } from "../services/gatewayEvents.js";

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * Canonical dispatcher for verified Stripe events.
 * Applies subscription lifecycle updates and financial payment processing.
 * Reused identically by primary webhook ingestion and background recovery workers.
 */
export async function dispatchWebhookBusinessLogic(event: any): Promise<void> {
  await applyStripeEvent(event);
  await applyFinancialStripeEvent(event);
}

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        "STRIPE WEBHOOK ERROR: payload deve ser um Buffer. " +
          "Provavelmente express.json() rodou antes desta rota. " +
          "Registre a rota do webhook ANTES de app.use(express.json()).",
      );
    }

    let event: any;

    // Primary path: stripe-replit-sync verifies the signature AND mirrors the
    // raw Stripe data into the `stripe` schema for audit/reporting.
    let syncSucceeded = false;
    try {
      const sync = await getStripeSync();
      await sync.processWebhook(payload, signature);
      event = JSON.parse(payload.toString("utf8"));
      syncSucceeded = true;
    } catch (syncErr: any) {
      // stripe-replit-sync may fail in production bundles (file-path resolution
      // for migrations). Fall back to direct Stripe SDK signature verification so
      // lifecycle transitions still work even when sync is unavailable.
      console.warn(
        "[webhook] stripe-replit-sync processWebhook falhou, usando fallback direto:",
        syncErr?.message ?? syncErr,
      );
    }

    if (!syncSucceeded) {
      // Fallback: verify signature manually via Stripe SDK.
      // This still correctly rejects forged webhooks; it just doesn't mirror data
      // into the `stripe` schema (acceptable since the schema may not exist).
      if (!WEBHOOK_SECRET) {
        throw new Error("STRIPE_WEBHOOK_SECRET não configurado — impossível verificar assinatura do webhook.");
      }
      try {
        const secretKey = await getStripeSecretKey();
        const stripe = new Stripe(secretKey);
        event = stripe.webhooks.constructEvent(payload, signature, WEBHOOK_SECRET);
      } catch (verifyErr: any) {
        console.error("[webhook] Falha na verificação de assinatura (fallback):", verifyErr?.message ?? verifyErr);
        throw verifyErr; // propagate so route returns 400 and Stripe retries
      }
    }

    // Phase R36.C: Gateway Event Deduplication & Safety Claim
    const claim = await claimGatewayEvent(event, "stripe");
    if (!claim.shouldProcess) {
      console.log(`[webhook] Gateway event ${event?.id} (${event?.type}) skipped: ${claim.reason}`);
      return;
    }

    try {
      // Apply the lifecycle transition to the app subscription.
      // Errors propagate so the route returns non-2xx and Stripe retries.
      await dispatchWebhookBusinessLogic(event);
      await finalizeGatewayEvent(event.id, "processed", undefined, "stripe");
    } catch (err: any) {
      const isRetryable = !(err instanceof SyntaxError || (err as any)?.code === "INVALID_EVENT");
      await finalizeGatewayEvent(
        event.id,
        isRetryable ? "failed_retryable" : "failed_final",
        err instanceof Error ? err.message : String(err),
        "stripe",
      );
      throw err;
    }
  }
}
