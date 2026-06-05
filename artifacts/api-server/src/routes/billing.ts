import { Router } from "express";
import { db } from "@workspace/db";
import {
  BILLING_INTERVALS,
  INTERVAL_MONTHS,
  INTERVAL_LABELS,
  computeIntervalPrice,
  type BillingInterval,
} from "@workspace/db";
import { plansTable, planPricesTable, subscriptionsTable, crechesTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate.js";
import { getUncachableStripeClient } from "../lib/stripeClient.js";
import { getAppBaseUrl } from "../lib/config.js";

const INTERVAL_ORDER: Record<BillingInterval, number> = {
  month: 0,
  quarter: 1,
  semester: 2,
  year: 3,
};

const router = Router();

router.use(authenticate);

// GET /billing/plans — all active plans, each with its per-interval prices.
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
        // In payment mode every interval is always purchasable (amount comes
        // from the DB price or computed value — no Stripe price id needed).
        available: true,
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

// POST /billing/checkout { planId, interval } — create a Stripe Checkout
// session using mode="payment" so card, Boleto and PIX are all supported.
// The subscription lifecycle (period, expiry) is managed by this app; there is
// no Stripe subscription object. creche_admin only.
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
  if (!plan || plan.priceBrl === 0) {
    res.status(404).json({ error: "Plano não encontrado ou gratuito." });
    return;
  }

  const [planPrice] = await db
    .select()
    .from(planPricesTable)
    .where(and(eq(planPricesTable.planId, planId), eq(planPricesTable.interval, interval)))
    .limit(1);

  // Amount in BRL cents for this plan + interval.
  const unitAmount = planPrice?.priceBrl ?? computeIntervalPrice(plan.priceBrl, interval);

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
    const intervalLabel = INTERVAL_LABELS[interval];

    const session = await stripe.checkout.sessions.create({
      // mode=payment supports card + Boleto + PIX. Subscription lifecycle is
      // handled by this app (currentPeriodEnd) rather than Stripe subscriptions.
      mode: "payment",
      customer: customerId,
      line_items: [
        {
          price_data: {
            currency: "brl",
            unit_amount: unitAmount,
            product_data: {
              name: `ArkPet — Plano ${plan.name}`,
              description: `${intervalLabel} · até ${plan.petLimit} pets`,
              metadata: { planId: String(planId), interval },
            },
          },
          quantity: 1,
        },
      ],
      // card + boleto + pix — all three payment methods for Brazil.
      payment_method_types: ["card", "boleto", "pix"],
      payment_method_options: {
        // PIX QR code valid for 24 h.
        pix: { expires_after_seconds: 86400 },
        // Boleto expires after 3 business days.
        boleto: { expires_after_days: 3 },
      },
      success_url: `${baseUrl}/assinatura/sucesso?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/assinatura?cancelado=1`,
      // Metadata is embedded in the session AND the payment intent so the
      // webhook handler can activate the subscription for async PIX payments.
      metadata: { crecheId: String(crecheId), planId: String(planId), interval },
      payment_intent_data: {
        metadata: { crecheId: String(crecheId), planId: String(planId), interval },
      },
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
// the checkout session and activates the subscription if the payment is
// collected. For async methods (PIX, Boleto) payment_status may still be
// "unpaid" when the customer lands here; in that case we return { pending: true }
// and the webhook (payment_intent.succeeded) will activate when confirmed.
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
    expand: ["line_items"],
  });

  // Tenant isolation: the session must belong to the caller's creche.
  if (String(session.metadata?.crecheId) !== String(crecheId)) {
    res.status(403).json({ error: "Sessão não pertence a esta creche." });
    return;
  }

  // PIX and Boleto are asynchronous: Stripe redirects to success_url before the
  // payment is confirmed. Return { pending: true } so the UI can show a
  // "waiting for payment" message. The webhook will activate when paid.
  if (session.payment_status !== "paid") {
    res.json({ ok: true, pending: true });
    return;
  }

  // Resolve plan + interval from session metadata (set server-side on checkout).
  const planId = Number(session.metadata?.planId);
  const interval = session.metadata?.interval as BillingInterval;

  if (!planId || !BILLING_INTERVALS.includes(interval)) {
    res.status(400).json({ error: "Metadados da sessão inválidos." });
    return;
  }

  // Verify the plan still exists (also acts as an existence check).
  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, planId)).limit(1);
  if (!plan) {
    res.status(400).json({ error: "Plano não encontrado." });
    return;
  }

  // Security: verify the paid amount matches what we'd charge for this plan+interval.
  const [planPrice] = await db
    .select()
    .from(planPricesTable)
    .where(and(eq(planPricesTable.planId, planId), eq(planPricesTable.interval, interval)))
    .limit(1);

  const expectedAmount = planPrice?.priceBrl ?? computeIntervalPrice(plan.priceBrl, interval);
  const paidAmount = session.amount_total ?? 0;
  if (paidAmount !== expectedAmount) {
    console.error(`[billing] Amount mismatch: paid=${paidAmount} expected=${expectedAmount} plan=${planId} interval=${interval}`);
    res.status(400).json({ error: "Valor pago não corresponde ao plano selecionado." });
    return;
  }

  // Calculate the access period end from today + interval months.
  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + INTERVAL_MONTHS[interval]);

  await db
    .update(subscriptionsTable)
    .set({
      planId,
      billingInterval: interval,
      status: "active",
      stripeCustomerId: typeof session.customer === "string" ? session.customer : undefined,
      stripeSubscriptionId: undefined, // payment mode: no Stripe subscription
      currentPeriodEnd: periodEnd,
      pastDueSince: null,
    })
    .where(eq(subscriptionsTable.crecheId, crecheId));

  res.json({ ok: true, pending: false });
});

// POST /billing/portal — open the Stripe billing portal for self-service
// management (payment methods, receipts). creche_admin only.
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
