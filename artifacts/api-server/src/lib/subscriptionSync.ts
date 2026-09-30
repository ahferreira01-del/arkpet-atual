// Maps verified Stripe webhook events onto the app's own `subscriptions` table.
// stripe-replit-sync mirrors raw Stripe data into the `stripe` schema, but the
// app keeps its own lifecycle state (trial/active/past_due/suspended/cancelled)
// which is what gates access and limits. This module is the bridge: the webhook
// remains the source of truth for those transitions.
import { db } from "@workspace/db";
import { BILLING_INTERVALS, INTERVAL_MONTHS, type BillingInterval } from "@workspace/db";
import {
  subscriptionsTable,
  plansTable,
  planPricesTable,
  planVersionsTable,
  planVersionPricesTable,
  customerCommercialConditionsTable,
} from "@workspace/db/schema";
import { eq, and, or, isNull, lte } from "drizzle-orm";
import { logCommercialAudit } from "../services/commercialAudit.js";
import { getUncachableStripeClient } from "./stripeClient.js";
import { resolveCatalogPlanPrice } from "../services/catalogPricing.js";
import { calculateEffectivePrice, resolveSaaSSubscriptionPrice } from "../services/pricingEngine.js";
import { reconcileBenefitCycleAdvancement } from "../services/commercialCampaigns.js";

export class UnknownStripePriceError extends Error {
  public stripePriceId: string;
  public code: string = "UNKNOWN_STRIPE_PRICE";

  constructor(priceId: string) {
    super(`Unknown Stripe price ID: ${priceId}`);
    this.name = "UnknownStripePriceError";
    this.stripePriceId = priceId;
  }
}

export interface ResolvedPlanByPrice {
  planId: number;
  interval: BillingInterval;
  isCustom?: boolean;
  conditionId?: number;
  planVersionId?: number;
  planVersionPriceId?: number;
  isGrandfathered?: boolean;
  priceBrl?: number;
}

// Shared downgrade detection: returns true if planId is cheaper than the
// creche's currently active plan and the current paid period has not yet ended.
async function isDowngradeScenario(
  appSub: AppSub,
  newPlanId: number,
): Promise<{ isDowngrade: boolean; currentPlan: { priceBrl: number } | null }> {
  const [currentPlan] = await db
    .select({ priceBrl: plansTable.priceBrl })
    .from(plansTable)
    .where(eq(plansTable.id, appSub.planId))
    .limit(1);

  const now = new Date();
  const hasActivePeriod =
    appSub.status === "active" &&
    appSub.currentPeriodEnd != null &&
    appSub.currentPeriodEnd > now;

  const [newPlan] = await db
    .select({ priceBrl: plansTable.priceBrl })
    .from(plansTable)
    .where(eq(plansTable.id, newPlanId))
    .limit(1);

  const isDowngrade = hasActivePeriod && !!newPlan && newPlan.priceBrl < (currentPlan?.priceBrl ?? 0);
  return { isDowngrade, currentPlan: currentPlan ?? null };
}

type AppStatus = "trial" | "active" | "past_due" | "suspended" | "cancelled";
type AppSub = typeof subscriptionsTable.$inferSelect;

// Stripe subscription.status -> app status. Returns null for transient states
// (e.g. "incomplete") where we should wait for a definitive event.
function mapStripeSubStatus(stripeStatus: string): AppStatus | null {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "unpaid":
    case "paused":
      return "suspended";
    case "canceled":
    case "incomplete_expired":
      return "cancelled";
    default:
      return null;
  }
}

// Basil moved current_period_end onto items; fall back to the top level.
function readPeriodEnd(sub: any): Date | null {
  const ts = sub?.items?.data?.[0]?.current_period_end ?? sub?.current_period_end ?? null;
  return typeof ts === "number" ? new Date(ts * 1000) : null;
}

function readPeriodStart(sub: any): Date | null {
  const ts = sub?.items?.data?.[0]?.current_period_start ?? sub?.current_period_start ?? null;
  return typeof ts === "number" ? new Date(ts * 1000) : null;
}

async function findAppSubscription(opts: {
  stripeSubscriptionId?: string | null;
  crecheId?: number;
  stripeCustomerId?: string | null;
}): Promise<AppSub | null> {
  if (opts.stripeSubscriptionId) {
    const [row] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.stripeSubscriptionId, opts.stripeSubscriptionId))
      .limit(1);
    if (row) return row;
  }
  if (opts.crecheId) {
    const [row] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.crecheId, opts.crecheId))
      .limit(1);
    if (row) return row;
  }
  if (opts.stripeCustomerId) {
    const [row] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.stripeCustomerId, opts.stripeCustomerId))
      .limit(1);
    if (row) return row;
  }
  return null;
}

// Resolves a Stripe price id to the app plan + billing interval it represents.
// Queries plan_version_prices across all version statuses (ACTIVE, SUPERSEDED, ARCHIVED),
// falls back to plan_prices, plans, and customer commercial conditions.
export async function resolvePlanByPrice(
  priceId?: string | null,
): Promise<ResolvedPlanByPrice | null> {
  if (!priceId) return null;

  // 1. Check plan_version_prices across all version statuses (TC-STP-01, TC-STP-02)
  try {
    const [pvpRow] = await db
      .select({
        versionPriceId: planVersionPricesTable.id,
        planVersionId: planVersionPricesTable.planVersionId,
        interval: planVersionPricesTable.interval,
        priceBrl: planVersionPricesTable.priceBrl,
        planId: planVersionsTable.planId,
        versionStatus: planVersionsTable.status,
      })
      .from(planVersionPricesTable)
      .innerJoin(
        planVersionsTable,
        eq(planVersionPricesTable.planVersionId, planVersionsTable.id),
      )
      .where(eq(planVersionPricesTable.stripePriceId, priceId))
      .limit(1);

    if (pvpRow) {
      const isGrandfathered =
        pvpRow.versionStatus === "SUPERSEDED" || pvpRow.versionStatus === "ARCHIVED";
      return {
        planId: pvpRow.planId,
        interval: pvpRow.interval as BillingInterval,
        planVersionId: pvpRow.planVersionId,
        planVersionPriceId: pvpRow.versionPriceId,
        isGrandfathered,
        priceBrl: pvpRow.priceBrl,
      };
    }
  } catch (err) {
    // If table query fails, continue to fallbacks
  }

  // 2. Fallback to planPricesTable
  const [pp] = await db
    .select({ planId: planPricesTable.planId, interval: planPricesTable.interval, priceBrl: planPricesTable.priceBrl })
    .from(planPricesTable)
    .where(eq(planPricesTable.stripePriceId, priceId))
    .limit(1);
  if (pp) {
    return {
      planId: pp.planId,
      interval: pp.interval as BillingInterval,
      priceBrl: pp.priceBrl,
      isGrandfathered: false,
    };
  }

  // 3. Fallback to plansTable
  const [plan] = await db
    .select({ id: plansTable.id, priceBrl: plansTable.priceBrl })
    .from(plansTable)
    .where(eq(plansTable.stripePriceId, priceId))
    .limit(1);
  if (plan) {
    return {
      planId: plan.id,
      interval: "month",
      priceBrl: plan.priceBrl,
      isGrandfathered: false,
    };
  }

  // 4. R36 agreement-scoped custom commercial condition check
  const [customCond] = await db
    .select()
    .from(customerCommercialConditionsTable)
    .where(eq(customerCommercialConditionsTable.stripePriceId, priceId))
    .limit(1);
  if (customCond && customCond.planId) {
    const interval: BillingInterval =
      (customCond.snapshotBillingInterval
        ? (customCond.snapshotBillingInterval as BillingInterval)
        : null) ?? "month";
    return {
      planId: customCond.planId,
      interval,
      isCustom: true,
      conditionId: customCond.id,
      priceBrl: customCond.lastSynchronizedAmountCents ?? customCond.snapshotBasePriceCents ?? 0,
      isGrandfathered: false,
    };
  }

  throw new UnknownStripePriceError(priceId);
}

// Order-safe commit. Stripe does NOT guarantee ordered webhook delivery (and
// retries can reorder), so we persist each event's `created` timestamp and skip
// any event older than the last one applied to this subscription. This prevents
// a delayed/stale event (e.g. an old invoice.paid arriving after a cancellation)
// from regressing the lifecycle state.
//
// The staleness comparison lives in the SQL WHERE clause (atomic compare-and-set)
// rather than an in-memory check, so concurrent webhook deliveries can't both
// pass a stale-read and clobber each other: only rows whose stored
// last_stripe_event_at is null or <= this event's timestamp are updated.
async function commit(appSub: AppSub, eventCreatedMs: number, updates: Record<string, unknown>) {
  if (eventCreatedMs <= 0) {
    // No usable timestamp — fall back to a plain update (best effort).
    await db.update(subscriptionsTable).set(updates).where(eq(subscriptionsTable.id, appSub.id));
    return;
  }
  const eventDate = new Date(eventCreatedMs);
  await db
    .update(subscriptionsTable)
    .set({ ...updates, lastStripeEventAt: eventDate })
    .where(
      and(
        eq(subscriptionsTable.id, appSub.id),
        or(
          isNull(subscriptionsTable.lastStripeEventAt),
          lte(subscriptionsTable.lastStripeEventAt, eventDate),
        ),
      ),
    );
}

export async function handleSubscriptionEvent(
  type: string,
  sub: any,
  eventCreatedMs: number,
  stripeClient?: any,
): Promise<void> {
  const crecheId = Number(sub?.metadata?.crecheId) || undefined;
  const customerId = typeof sub?.customer === "string" ? sub.customer : sub?.customer?.id;
  const appSub = await findAppSubscription({
    stripeSubscriptionId: sub?.id,
    crecheId,
    stripeCustomerId: customerId,
  });
  if (!appSub) return;

  // Section 13: Treat webhook as reconciliation trigger.
  // Retrieve CURRENT Stripe Subscription state using the Stripe READ client
  // so stale out-of-order event snapshots cannot roll back or diverge state.
  let currentSub = sub;
  const subId = sub?.id ?? appSub.stripeSubscriptionId;
  const activeStripe = stripeClient ?? (await getUncachableStripeClient().catch(() => null));
  if (subId && activeStripe?.subscriptions?.retrieve) {
    try {
      const liveSub = await activeStripe.subscriptions.retrieve(subId, {
        expand: ["items.data.price"],
      });
      if (liveSub) {
        currentSub = liveSub;
      }
    } catch (err: any) {
      // Graceful fallback to event payload if Stripe read fails
    }
  }

  const status: AppStatus | null =
    type === "customer.subscription.deleted" ? "cancelled" : mapStripeSubStatus(currentSub?.status ?? sub?.status);
  if (!status) return;

  const updates: Record<string, unknown> = {
    status,
    stripeSubscriptionId: currentSub?.id ?? sub?.id ?? appSub.stripeSubscriptionId,
    stripeCustomerId: customerId ?? appSub.stripeCustomerId,
  };

  const currentItem = currentSub?.items?.data?.[0];
  const incomingPriceId = currentItem?.price?.id;
  const actualStripeAmountCents = currentItem?.price?.unit_amount;

  let resolved: ResolvedPlanByPrice | null = null;
  if (incomingPriceId) {
    try {
      resolved = await resolvePlanByPrice(incomingPriceId);
    } catch (err) {
      if (err instanceof UnknownStripePriceError) {
        resolved = null;
      } else {
        throw err;
      }
    }
  }

  if (resolved) {
    updates.planId = resolved.planId;
    updates.billingInterval = resolved.interval;
    if (resolved.planVersionId) {
      updates.planVersionId = resolved.planVersionId;
      updates.planVersionPriceId = resolved.planVersionPriceId ?? null;
      updates.contractedPriceCents = resolved.priceBrl ?? actualStripeAmountCents ?? null;
      updates.contractedStripePriceId = incomingPriceId;
    }
    if (resolved.isCustom && resolved.conditionId) {
      // Section 8: Check if active percentage condition has drifted from current catalog price
      let shouldMarkDivergent = false;
      if (appSub.activeConditionId && appSub.activeConditionId === resolved.conditionId) {
        const [activeCond] = await db
          .select()
          .from(customerCommercialConditionsTable)
          .where(eq(customerCommercialConditionsTable.id, appSub.activeConditionId))
          .limit(1);

        if (activeCond && activeCond.pricingOverrideType === "percentage") {
          const [planRow] = await db
            .select()
            .from(plansTable)
            .where(eq(plansTable.id, resolved.planId))
            .limit(1);

          if (planRow) {
            try {
              const currentCatalog = await resolveCatalogPlanPrice(planRow, resolved.interval, db);
              const expectedPricing = calculateEffectivePrice({
                catalogPriceCents: currentCatalog.catalogPriceCents,
                pricingOverrideType: "percentage",
                pricingOverrideValue: activeCond.pricingOverrideValue ?? 0,
              });
              if (
                typeof actualStripeAmountCents === "number" &&
                actualStripeAmountCents !== expectedPricing.finalEffectivePriceCents
              ) {
                shouldMarkDivergent = true;
              }
            } catch {
              // Ignore catalog resolution error in webhook
            }
          }
        }
      }

      if (shouldMarkDivergent) {
        await db
          .update(customerCommercialConditionsTable)
          .set({ syncStatus: "divergent", updatedAt: new Date() })
          .where(eq(customerCommercialConditionsTable.id, resolved.conditionId));
      } else {
        await db
          .update(customerCommercialConditionsTable)
          .set({
            syncStatus: "synced",
            ...(typeof actualStripeAmountCents === "number" ? { lastSynchronizedAmountCents: actualStripeAmountCents } : {}),
            lastSyncError: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(customerCommercialConditionsTable.id, resolved.conditionId),
              or(
                eq(customerCommercialConditionsTable.syncStatus, "sync_pending"),
                eq(customerCommercialConditionsTable.syncStatus, "divergent"),
              ),
            ),
          );
      }
    }
  } else if (incomingPriceId) {
    // Unknown price detected from external Stripe modification (Section 27)
    if (appSub.activeConditionId) {
      await db
        .update(customerCommercialConditionsTable)
        .set({ syncStatus: "divergent", updatedAt: new Date() })
        .where(eq(customerCommercialConditionsTable.id, appSub.activeConditionId));

      await logCommercialAudit({
        targetCrecheId: appSub.crecheId,
        actorType: "gateway",
        action: "commercial_stripe_divergence_detected",
        executionStatus: "divergent",
        relatedConditionId: appSub.activeConditionId,
        reason: `Preço desconhecido no Stripe ('${incomingPriceId}') não corresponde ao catálogo nem a nenhuma condição comercial aprovada.`,
        afterState: {
          divergentPriceId: incomingPriceId,
          syncStatus: "divergent",
        },
      });
    }
  }

  const periodEnd = readPeriodEnd(currentSub ?? sub);
  const periodStart = readPeriodStart(currentSub ?? sub);
  if (periodEnd) updates.currentPeriodEnd = periodEnd;

  if (status === "past_due") {
    updates.pastDueSince = appSub.pastDueSince ?? new Date();
  } else if (status === "active") {
    updates.pastDueSince = null;
  }

  await commit(appSub, eventCreatedMs, updates);

  // Reconcile commercial campaign cycle advancement and completion
  if (status === "active" && periodStart && periodEnd && subId && appSub.crecheId) {
    try {
      await reconcileBenefitCycleAdvancement({
        crecheId: appSub.crecheId,
        stripeSubscriptionId: subId,
        contractualPeriodStart: periodStart,
        contractualPeriodEnd: periodEnd,
        sourceReferenceId: sub?.id,
        dbClient: db,
        stripeClient: activeStripe ?? undefined,
      });
    } catch (err: any) {
      console.error(`[campaign] Failed to reconcile cycle advancement for creche ${appSub.crecheId}:`, err);
    }
  }
}

async function handleInvoiceFailed(invoice: any, eventCreatedMs: number): Promise<void> {
  const subId = typeof invoice?.subscription === "string" ? invoice.subscription : invoice?.subscription?.id;
  const customerId = typeof invoice?.customer === "string" ? invoice.customer : invoice?.customer?.id;
  if (!subId) return; // one-off invoices don't affect the subscription lifecycle
  const appSub = await findAppSubscription({ stripeSubscriptionId: subId, stripeCustomerId: customerId });
  if (!appSub || appSub.status === "cancelled") return;
  await commit(appSub, eventCreatedMs, {
    status: "past_due",
    pastDueSince: appSub.pastDueSince ?? new Date(),
  });
}

async function handleInvoicePaid(invoice: any, eventCreatedMs: number): Promise<void> {
  const subId = typeof invoice?.subscription === "string" ? invoice.subscription : invoice?.subscription?.id;
  const customerId = typeof invoice?.customer === "string" ? invoice.customer : invoice?.customer?.id;
  if (!subId) return; // ignore non-subscription invoices
  const appSub = await findAppSubscription({ stripeSubscriptionId: subId, stripeCustomerId: customerId });
  if (!appSub) return;
  const updates: Record<string, unknown> = {
    status: "active",
    pastDueSince: null,
    stripeSubscriptionId: appSub.stripeSubscriptionId ?? subId,
  };
  const periodStartTs = invoice?.lines?.data?.[0]?.period?.start;
  const periodEndTs = invoice?.lines?.data?.[0]?.period?.end;
  if (typeof periodEndTs === "number") updates.currentPeriodEnd = new Date(periodEndTs * 1000);
  await commit(appSub, eventCreatedMs, updates);

  if (typeof periodStartTs === "number" && typeof periodEndTs === "number" && appSub.crecheId) {
    try {
      await reconcileBenefitCycleAdvancement({
        crecheId: appSub.crecheId,
        stripeSubscriptionId: subId,
        contractualPeriodStart: new Date(periodStartTs * 1000),
        contractualPeriodEnd: new Date(periodEndTs * 1000),
        sourceReferenceId: invoice?.id,
        dbClient: db,
      });
    } catch (err: any) {
      console.error(`[campaign] Failed to reconcile cycle advancement from invoice for creche ${appSub.crecheId}:`, err);
    }
  }
}

// Handles payment_intent.succeeded for PIX and Boleto (mode=payment checkout).
// Reads crecheId / planId / interval from the payment intent metadata set by
// the checkout endpoint and activates the subscription for the contracted period.
//
// Applies the same downgrade scheduling logic as POST /billing/confirm: if the
// new plan is cheaper and the current period is still running, the switch is
// scheduled for when the current period ends instead of applied immediately.
// This prevents a webhook arriving after a scheduled downgrade from overwriting
// the still-active (more expensive) plan prematurely.
async function handlePaymentIntentSucceeded(pi: any, eventCreatedMs: number): Promise<void> {
  const meta = pi?.metadata ?? {};
  const crecheId = Number(meta.crecheId);
  const planId = Number(meta.planId);
  const interval = meta.interval as BillingInterval;

  // If metadata is missing this is not an ArkPet PIX/Boleto payment — skip.
  if (!crecheId || !planId || !BILLING_INTERVALS.includes(interval)) return;

  const appSub = await findAppSubscription({ crecheId });
  if (!appSub) return;

  const customerId = typeof pi?.customer === "string" ? pi.customer : null;

  // Detect downgrade: if the new plan is cheaper and the current period still
  // has time left, schedule the change instead of applying immediately.
  const { isDowngrade } = await isDowngradeScenario(appSub, planId);

  if (isDowngrade) {
    // Keep the current (higher) plan active; queue the cheaper plan for when it expires.
    // Under R38.B, scheduled_period_end = currentPeriodEnd (the effective execution boundary).
    const targetPricing = await resolveSaaSSubscriptionPrice({
      crecheId,
      planId,
      interval,
      referenceDate: appSub.currentPeriodEnd,
    }).catch(() => null);

    await commit(appSub, eventCreatedMs, {
      scheduledPlanId: planId,
      scheduledPlanVersionId: targetPricing?.planVersionId ?? null,
      scheduledPlanVersionPriceId: targetPricing?.planVersionPriceId ?? null,
      scheduledPriceCents: targetPricing?.finalPriceCents ?? null,
      scheduledStripePriceId: targetPricing?.stripePriceId ?? null,
      scheduledBillingInterval: interval,
      scheduledPeriodEnd: appSub.currentPeriodEnd,
      stripeCustomerId: customerId ?? appSub.stripeCustomerId,
    });

    console.log(`[billing] PIX/Boleto downgrade agendado: creche=${crecheId} plano=${planId} intervalo=${interval} a partir de ${appSub.currentPeriodEnd!.toISOString()}`);
  } else {
    // Upgrade or first activation — calculate access window and apply now.
    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + INTERVAL_MONTHS[interval]);

    await commit(appSub, eventCreatedMs, {
      planId,
      billingInterval: interval,
      status: "active",
      stripeCustomerId: customerId ?? appSub.stripeCustomerId,
      stripeSubscriptionId: null, // payment mode: no Stripe subscription
      currentPeriodEnd: periodEnd,
      pastDueSince: null,
      scheduledPlanId: null,
      scheduledBillingInterval: null,
      scheduledPeriodEnd: null,
    });

    console.log(`[billing] PIX/Boleto ativado: creche=${crecheId} plano=${planId} intervalo=${interval} até=${periodEnd.toISOString()}`);
  }
}

// Applies a single (already signature-verified) Stripe event to the app's
// subscription state. Idempotent and order-safe. Throws on DB failure so the
// webhook returns non-2xx and Stripe retries.
export async function applyStripeEvent(event: any, stripeClient?: any): Promise<void> {
  const type: string = event?.type ?? "";
  const obj = event?.data?.object;
  if (!obj) return;
  const eventCreatedMs = typeof event?.created === "number" ? event.created * 1000 : 0;

  if (type.startsWith("customer.subscription.")) {
    await handleSubscriptionEvent(type, obj, eventCreatedMs, stripeClient);
  } else if (type === "invoice.payment_failed") {
    await handleInvoiceFailed(obj, eventCreatedMs);
  } else if (type === "invoice.paid" || type === "invoice.payment_succeeded") {
    await handleInvoicePaid(obj, eventCreatedMs);
  } else if (type === "payment_intent.succeeded") {
    await handlePaymentIntentSucceeded(obj, eventCreatedMs);
  }
}
