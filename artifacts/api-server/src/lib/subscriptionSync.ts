// Maps verified Stripe webhook events onto the app's own `subscriptions` table.
// stripe-replit-sync mirrors raw Stripe data into the `stripe` schema, but the
// app keeps its own lifecycle state (trial/active/past_due/suspended/cancelled)
// which is what gates access and limits. This module is the bridge: the webhook
// remains the source of truth for those transitions.
import { db } from "@workspace/db";
import type { BillingInterval } from "@workspace/db";
import { subscriptionsTable, plansTable, planPricesTable } from "@workspace/db/schema";
import { eq, and, or, isNull, lte } from "drizzle-orm";

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
// Prefers plan_prices (multi-interval); falls back to the legacy monthly price
// stored on plans for older subscriptions.
export async function resolvePlanByPrice(
  priceId?: string | null,
): Promise<{ planId: number; interval: BillingInterval } | null> {
  if (!priceId) return null;
  const [pp] = await db
    .select({ planId: planPricesTable.planId, interval: planPricesTable.interval })
    .from(planPricesTable)
    .where(eq(planPricesTable.stripePriceId, priceId))
    .limit(1);
  if (pp) return { planId: pp.planId, interval: pp.interval as BillingInterval };

  const [plan] = await db
    .select({ id: plansTable.id })
    .from(plansTable)
    .where(eq(plansTable.stripePriceId, priceId))
    .limit(1);
  if (plan) return { planId: plan.id, interval: "month" };
  return null;
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

async function handleSubscriptionEvent(type: string, sub: any, eventCreatedMs: number): Promise<void> {
  const crecheId = Number(sub?.metadata?.crecheId) || undefined;
  const customerId = typeof sub?.customer === "string" ? sub.customer : sub?.customer?.id;
  const appSub = await findAppSubscription({
    stripeSubscriptionId: sub?.id,
    crecheId,
    stripeCustomerId: customerId,
  });
  if (!appSub) return;

  const status: AppStatus | null =
    type === "customer.subscription.deleted" ? "cancelled" : mapStripeSubStatus(sub?.status);
  if (!status) return;

  const updates: Record<string, unknown> = {
    status,
    stripeSubscriptionId: sub?.id ?? appSub.stripeSubscriptionId,
    stripeCustomerId: customerId ?? appSub.stripeCustomerId,
  };

  const resolved = await resolvePlanByPrice(sub?.items?.data?.[0]?.price?.id);
  if (resolved) {
    updates.planId = resolved.planId;
    updates.billingInterval = resolved.interval;
  }

  const periodEnd = readPeriodEnd(sub);
  if (periodEnd) updates.currentPeriodEnd = periodEnd;

  if (status === "past_due") {
    updates.pastDueSince = appSub.pastDueSince ?? new Date();
  } else if (status === "active") {
    updates.pastDueSince = null;
  }

  await commit(appSub, eventCreatedMs, updates);
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
  const periodEndTs = invoice?.lines?.data?.[0]?.period?.end;
  if (typeof periodEndTs === "number") updates.currentPeriodEnd = new Date(periodEndTs * 1000);
  await commit(appSub, eventCreatedMs, updates);
}

// Applies a single (already signature-verified) Stripe event to the app's
// subscription state. Idempotent and order-safe. Throws on DB failure so the
// webhook returns non-2xx and Stripe retries.
export async function applyStripeEvent(event: any): Promise<void> {
  const type: string = event?.type ?? "";
  const obj = event?.data?.object;
  if (!obj) return;
  const eventCreatedMs = typeof event?.created === "number" ? event.created * 1000 : 0;

  if (type.startsWith("customer.subscription.")) {
    await handleSubscriptionEvent(type, obj, eventCreatedMs);
  } else if (type === "invoice.payment_failed") {
    await handleInvoiceFailed(obj, eventCreatedMs);
  } else if (type === "invoice.paid" || type === "invoice.payment_succeeded") {
    await handleInvoicePaid(obj, eventCreatedMs);
  }
}
