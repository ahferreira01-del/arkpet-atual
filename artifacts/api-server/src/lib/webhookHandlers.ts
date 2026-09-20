// Stripe webhook handler. stripe-replit-sync validates the signature and mirrors
// raw data into the `stripe` schema; we then apply the same (now-verified) event
// to the app's own `subscriptions` lifecycle state.
import Stripe from "stripe";
import { getStripeSync, getStripeSecretKey } from "./stripeClient.js";
import { applyStripeEvent } from "./subscriptionSync.js";
import { applyFinancialStripeEvent } from "./financialSync.js";
import { claimGatewayEvent, finalizeGatewayEvent } from "../services/gatewayEvents.js";
import { handlePlatformServicePaymentWebhook } from "../services/platformServices.js";

import { db } from "@workspace/db";
import { billingWebhookErrorsTable } from "@workspace/db/schema";
import { sql } from "drizzle-orm";
import { UnknownStripePriceError } from "./subscriptionSync.js";

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * Canonical dispatcher for verified Stripe events.
 * Applies subscription lifecycle updates and financial payment processing.
 * Reused identically by primary webhook ingestion and background recovery workers.
 */
export async function dispatchWebhookBusinessLogic(event: any): Promise<void> {
  // Phase R36.G: Platform services webhook routing (Corrections 18 & 19)
  // ASSISTED_IMPLEMENTATION checkout event terminates platform-service webhook branch.
  // It must NOT continue into tenant invoices or daycare billing handlers.
  if (
    event.type === "checkout.session.completed" &&
    event.data?.object?.metadata?.serviceType === "ASSISTED_IMPLEMENTATION"
  ) {
    await handlePlatformServicePaymentWebhook(event.data.object);
    return;
  }

  await applyStripeEvent(event);
  await applyFinancialStripeEvent(event);
}

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<any> {
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
      return { statusCode: 200, skipped: true, reason: claim.reason };
    }

    try {
      // Apply the lifecycle transition to the app subscription.
      await dispatchWebhookBusinessLogic(event);
      await finalizeGatewayEvent(event.id, "processed", undefined, "stripe");
      return { statusCode: 200, received: true };
    } catch (err: any) {
      // TC-STP-03 & TC-STP-13: Catch unmapped Stripe Price IDs, insert/upsert into billing_webhook_errors table
      if (err instanceof UnknownStripePriceError || err?.code === "UNKNOWN_STRIPE_PRICE") {
        const stripePriceId = (err as any).stripePriceId ?? event.data?.object?.items?.data?.[0]?.price?.id ?? null;
        const customerId = typeof event.data?.object?.customer === "string" ? event.data.object.customer : event.data?.object?.customer?.id ?? null;
        const subId = typeof event.data?.object?.subscription === "string" ? event.data.object.subscription : event.data?.object?.id ?? null;

        await db
          .insert(billingWebhookErrorsTable)
          .values({
            eventId: event.id,
            eventType: event.type,
            stripePriceId,
            stripeSubscriptionId: subId,
            customerId,
            rawPayload: event,
            errorCode: "UNKNOWN_STRIPE_PRICE",
            errorMessage: err.message,
            status: "PENDING_RECONCILIATION",
            attemptCount: 0,
            retryCount: 0,
            lastSeenAt: new Date(),
          })
          .onConflictDoUpdate({
            target: billingWebhookErrorsTable.eventId,
            set: {
              retryCount: sql`${billingWebhookErrorsTable.retryCount} + 1`,
              lastSeenAt: sql`NOW()`,
            },
          });

        await finalizeGatewayEvent(
          event.id,
          "ignored",
          "Unknown Stripe price ID logged to billing_webhook_errors for administrative reconciliation.",
          "stripe",
        );

        return { statusCode: 202, received: true, status: "pending_reconciliation" };
      }

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
