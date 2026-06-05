import { Router } from "express";
import { db } from "@workspace/db";
import { BILLING_INTERVALS, type BillingInterval } from "@workspace/db";
import { plansTable, planPricesTable, subscriptionsTable, crechesTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate.js";
import { getUncachableStripeClient } from "../lib/stripeClient.js";
import { resolvePlanByPrice } from "../lib/subscriptionSync.js";
import { getAppBaseUrl } from "../lib/config.js";

const INTERVAL_ORDER: Record<BillingInterval, number> = {
  month: 0,
  quarter: 1,
  semester: 2,
  year: 3,
};

const router = Router();

router.use(authenticate);

// Reads the subscription period end defensively: the Basil API moved
// current_period_end onto subscription items, but older payloads keep it at the
// top level.
function readPeriodEnd(subscription: any): Date | null {
  const ts =
    subscription?.items?.data?.[0]?.current_period_end ??
    subscription?.current_period_end ??
    null;
  return typeof ts === "number" ? new Date(ts * 1000) : null;
}

// GET /billing/plans — all active plans, each with its per-interval prices.
// `priceBrl` on the plan stays the monthly base; `prices` lists every interval
// (with discount %) and whether it is purchasable (`available`).
router.get("/plans", async (_req: AuthRequest, res) => {
  const plans = await db
    .select()
    .from(plansTable)
    .where(eq(plansTable.isActive, true))
    .orderBy(plansTable.priceBrl);

  const prices = await db
    .select()
    .from(planPricesTable)
    .where(eq(planPricesTable.isActive, true));

  const byPlan = new Map<number, typeof prices>();
  for (const p of prices) {
    const arr = byPlan.get(p.planId) ?? [];
    arr.push(p);
    byPlan.set(p.planId, arr);
  }

  const result = plans.map((plan) => ({
    ...plan,
    prices: (byPlan.get(plan.id) ?? [])
      .map((pp) => ({
        interval: pp.interval,
        priceBrl: pp.priceBrl,
        discountPct: pp.discountPct,
        available: pp.stripePriceId != null,
      }))
      .sort(
        (a, b) =>
          INTERVAL_ORDER[a.interval as BillingInterval] - INTERVAL_ORDER[b.interval as BillingInterval],
      ),
  }));

  res.json(result);
});

// GET /billing/subscription — current creche subscription + its plan.
router.get("/subscription", async (req: AuthRequest, res) => {
  const crecheId = req.user?.crecheId;
  if (!crecheId) {
    res.status(400).json({ error: "Usuário não está associado a uma creche." });
    return;
  }
  const [row] = await db
    .select({
      id: subscriptionsTable.id,
      crecheId: subscriptionsTable.crecheId,
      planId: subscriptionsTable.planId,
      status: subscriptionsTable.status,
      billingInterval: subscriptionsTable.billingInterval,
      trialEndsAt: subscriptionsTable.trialEndsAt,
      currentPeriodEnd: subscriptionsTable.currentPeriodEnd,
      pastDueSince: subscriptionsTable.pastDueSince,
      stripeSubscriptionId: subscriptionsTable.stripeSubscriptionId,
      stripeCustomerId: subscriptionsTable.stripeCustomerId,
      plan: {
        id: plansTable.id,
        name: plansTable.name,
        petLimit: plansTable.petLimit,
        priceBrl: plansTable.priceBrl,
        description: plansTable.description,
        stripePriceId: plansTable.stripePriceId,
      },
    })
    .from(subscriptionsTable)
    .innerJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
    .where(eq(subscriptionsTable.crecheId, crecheId))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Assinatura não encontrada." });
    return;
  }
  res.json(row);
});

// POST /billing/checkout { planId } — create a Stripe Checkout session for the
// selected plan. creche_admin only.
router.post("/checkout", requireRole("creche_admin"), async (req: AuthRequest, res) => {
  const crecheId = req.user?.crecheId;
  if (!crecheId) {
    res.status(400).json({ error: "Usuário não está associado a uma creche." });
    return;
  }

  const planId = Number(req.body?.planId);
  if (!Number.isInteger(planId)) {
    res.status(400).json({ error: "planId inválido." });
    return;
  }

  const interval = (req.body?.interval ?? "month") as BillingInterval;
  if (!BILLING_INTERVALS.includes(interval)) {
    res.status(400).json({ error: "Período de cobrança inválido." });
    return;
  }

  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, planId)).limit(1);
  if (!plan) {
    res.status(404).json({ error: "Plano não encontrado." });
    return;
  }

  const [planPrice] = await db
    .select()
    .from(planPricesTable)
    .where(and(eq(planPricesTable.planId, planId), eq(planPricesTable.interval, interval)))
    .limit(1);

  // Resolve the Stripe price for the chosen interval. For monthly, fall back to
  // the legacy plans.stripePriceId so an incomplete plan_prices backfill never
  // takes monthly checkout offline during rollout.
  const priceId =
    planPrice?.stripePriceId ?? (interval === "month" ? plan.stripePriceId : null);
  if (!priceId) {
    res.status(400).json({ error: "Este plano não está disponível para assinatura paga neste período." });
    return;
  }

  const [subscription] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.crecheId, crecheId))
    .limit(1);
  if (!subscription) {
    res.status(404).json({ error: "Assinatura da creche não encontrada." });
    return;
  }

  const [creche] = await db.select().from(crechesTable).where(eq(crechesTable.id, crecheId)).limit(1);

  let stripe: Awaited<ReturnType<typeof getUncachableStripeClient>>;
  try {
    stripe = await getUncachableStripeClient();
  } catch (err: any) {
    console.error("[billing] falha ao obter cliente Stripe:", err?.message ?? err);
    res.status(500).json({ error: "Serviço de pagamento indisponível. Tente novamente." });
    return;
  }

  // Reuse the existing Stripe customer or create one for this creche (tenant).
  let customerId = subscription.stripeCustomerId;
  try {
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: creche?.name ?? `Creche ${crecheId}`,
        email: creche?.email ?? req.user?.email,
        metadata: { crecheId: String(crecheId) },
      });
      customerId = customer.id;
      await db
        .update(subscriptionsTable)
        .set({ stripeCustomerId: customerId })
        .where(eq(subscriptionsTable.id, subscription.id));
    }

    const baseUrl = getAppBaseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // Card + Boleto are the payment methods supported for subscriptions in Brazil.
      // PIX is one-time only (no recurring support in Stripe) so it is excluded here.
      payment_method_types: ["card", "boleto"],
      success_url: `${baseUrl}/assinatura/sucesso?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/assinatura?cancelado=1`,
      metadata: { crecheId: String(crecheId), planId: String(planId), interval },
      subscription_data: { metadata: { crecheId: String(crecheId), planId: String(planId), interval } },
    });

    res.json({ url: session.url });
  } catch (err: any) {
    const stripeMsg = err?.raw?.message ?? err?.message ?? "Erro desconhecido";
    const stripeCode = err?.raw?.code ?? err?.code ?? err?.statusCode ?? "?";
    console.error(`[billing] Stripe checkout error (code=${stripeCode}):`, stripeMsg);
    res.status(500).json({ error: `Erro ao criar sessão de pagamento: ${stripeMsg}` });
  }
});

// POST /billing/confirm { sessionId } — called from the success page. Verifies
// the checkout session and flips the app subscription to active immediately for
// good UX. The webhook remains the source of truth for lifecycle changes.
router.post("/confirm", requireRole("creche_admin"), async (req: AuthRequest, res) => {
  const crecheId = req.user?.crecheId;
  if (!crecheId) {
    res.status(400).json({ error: "Usuário não está associado a uma creche." });
    return;
  }

  const sessionId = String(req.body?.sessionId ?? "");
  if (!sessionId) {
    res.status(400).json({ error: "sessionId é obrigatório." });
    return;
  }

  const stripe = await getUncachableStripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["subscription", "line_items"],
  });

  // Tenant isolation: the session must belong to the caller's creche.
  if (String(session.metadata?.crecheId) !== String(crecheId)) {
    res.status(403).json({ error: "Sessão não pertence a esta creche." });
    return;
  }

  // Money gate: only activate once Stripe confirms the payment was actually
  // collected. The webhook remains the source of truth for later lifecycle.
  if (session.payment_status !== "paid") {
    res.status(402).json({ error: "Pagamento ainda não confirmado." });
    return;
  }

  // Derive the plan from the price actually purchased — never trust the
  // client-controllable metadata planId for what the customer is entitled to.
  const purchasedPriceId = session.line_items?.data?.[0]?.price?.id;
  if (!purchasedPriceId) {
    res.status(400).json({ error: "Não foi possível identificar o plano da sessão." });
    return;
  }
  const resolved = await resolvePlanByPrice(purchasedPriceId);
  if (!resolved) {
    res.status(400).json({ error: "Plano correspondente não encontrado." });
    return;
  }

  const stripeSubscription = session.subscription as any;

  await db
    .update(subscriptionsTable)
    .set({
      planId: resolved.planId,
      billingInterval: resolved.interval,
      status: "active",
      stripeCustomerId: typeof session.customer === "string" ? session.customer : undefined,
      stripeSubscriptionId: stripeSubscription?.id ?? undefined,
      currentPeriodEnd: stripeSubscription ? readPeriodEnd(stripeSubscription) : undefined,
      pastDueSince: null,
    })
    .where(eq(subscriptionsTable.crecheId, crecheId));

  res.json({ ok: true });
});

// POST /billing/portal — open the Stripe billing portal for self-service
// management (cancel, update payment method). creche_admin only.
router.post("/portal", requireRole("creche_admin"), async (req: AuthRequest, res) => {
  const crecheId = req.user?.crecheId;
  if (!crecheId) {
    res.status(400).json({ error: "Usuário não está associado a uma creche." });
    return;
  }

  const [subscription] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.crecheId, crecheId))
    .limit(1);

  if (!subscription?.stripeCustomerId) {
    res.status(400).json({ error: "Nenhuma assinatura paga ativa para gerenciar." });
    return;
  }

  const stripe = await getUncachableStripeClient();
  const portal = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: `${getAppBaseUrl()}/assinatura`,
  });

  res.json({ url: portal.url });
});

export default router;
