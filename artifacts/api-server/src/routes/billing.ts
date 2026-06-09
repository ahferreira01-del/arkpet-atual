import { Router } from "express";
import { db } from "@workspace/db";
import {
  BILLING_INTERVALS,
  INTERVAL_MONTHS,
  INTERVAL_LABELS,
  computeIntervalPrice,
  type BillingInterval,
} from "@workspace/db";
import { plansTable, planPricesTable, subscriptionsTable, crechesTable, petsTable } from "@workspace/db/schema";
import { eq, and, count } from "drizzle-orm";
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

// Reads the subscription period end defensively: Stripe moved current_period_end
// onto subscription items in newer API versions; fall back to the top level.
function readPeriodEnd(subscription: any): Date | null {
  const ts =
    subscription?.items?.data?.[0]?.current_period_end ??
    subscription?.current_period_end ??
    null;
  return typeof ts === "number" ? new Date(ts * 1000) : null;
}

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
        // available=true for PIX/Boleto always (payment mode uses price_data).
        // For subscription mode (card), a Stripe price id must exist.
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

  const [petCountRow] = await db
    .select({ total: count() })
    .from(petsTable)
    .where(eq(petsTable.crecheId, crecheId));

  res.json({ ...row, petCount: petCountRow?.total ?? 0 });
});

// POST /billing/checkout { planId, interval, paymentMode }
//
// paymentMode="subscription" (default) — card-only, Stripe manages recurring.
//   Uses mode="subscription" + Stripe price id. The customer's card is charged
//   automatically each period with no action required.
//
// paymentMode="payment" — PIX + Boleto + card (one-time).
//   Uses mode="payment" + price_data. The subscription period is calculated by
//   this app (today + interval months). The customer must renew manually.
//
// creche_admin only.
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

  const paymentMode = (req.body?.paymentMode ?? "subscription") as "subscription" | "payment";
  if (!["subscription", "payment"].includes(paymentMode)) {
    res.status(400).json({ error: "paymentMode inválido." });
    return;
  }

  // Frontend passes its own origin so the redirect works both in dev and production.
  const clientSuccessUrl = typeof req.body?.successUrl === "string" ? req.body.successUrl : null;
  const clientCancelUrl = typeof req.body?.cancelUrl === "string" ? req.body.cancelUrl : null;
  const baseUrl = getAppBaseUrl();
  const successUrl = clientSuccessUrl ?? `${baseUrl}/assinatura/sucesso`;
  const cancelUrl = clientCancelUrl ?? `${baseUrl}/assinatura?cancelado=1`;

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

  // Subscription mode requires a stored Stripe price id.
  if (paymentMode === "subscription") {
    const priceId = planPrice?.stripePriceId ?? (interval === "month" ? plan.stripePriceId : null);
    if (!priceId) {
      res.status(400).json({ error: "Este plano não está disponível para assinatura recorrente neste período." });
      return;
    }
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
    const unitAmount = planPrice?.priceBrl ?? computeIntervalPrice(plan.priceBrl, interval);
    const priceId = planPrice?.stripePriceId ?? (interval === "month" ? plan.stripePriceId : null);

    let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;

    if (paymentMode === "subscription") {
      // ── CARTÃO RECORRENTE ────────────────────────────────────────────────
      // Stripe manages the recurring billing automatically. The customer only
      // needs to enter card details once; charges happen every period.
      session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId!, quantity: 1 }],
        payment_method_types: ["card"],
        success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl,
        metadata: { crecheId: String(crecheId), planId: String(planId), interval, paymentMode },
        subscription_data: {
          metadata: { crecheId: String(crecheId), planId: String(planId), interval },
        },
      });
    } else {
      // ── PIX / BOLETO / CARTÃO AVULSO ────────────────────────────────────
      // One-time payment. The subscription period (today + interval months) is
      // managed by this app. The customer must renew manually when it expires.
      const paymentLineItems = [
        {
          price_data: {
            currency: "brl",
            unit_amount: unitAmount,
            product_data: {
              name: `ArkPet — Plano ${plan.name}`,
              description: `${INTERVAL_LABELS[interval]} · até ${plan.petLimit} pets`,
              metadata: { planId: String(planId), interval },
            },
          },
          quantity: 1,
        },
      ];
      const paymentMeta = { crecheId: String(crecheId), planId: String(planId), interval, paymentMode };

      // Try PIX + Boleto + Card first; fall back to Boleto + Card if PIX is
      // not enabled on this Stripe account (common in test/sandbox environments).
      try {
        session = await stripe.checkout.sessions.create({
          mode: "payment",
          customer: customerId,
          line_items: paymentLineItems,
          payment_method_types: ["pix", "boleto", "card"],
          payment_method_options: {
            pix: { expires_after_seconds: 86400 },
            boleto: { expires_after_days: 3 },
          },
          success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: cancelUrl,
          metadata: paymentMeta,
          payment_intent_data: { metadata: paymentMeta },
        });
      } catch (pixErr: any) {
        const msg: string = pixErr?.raw?.message ?? pixErr?.message ?? "";
        if (msg.toLowerCase().includes("pix")) {
          console.warn("[billing] PIX não disponível nesta conta Stripe — tentando Boleto + Card.");
          session = await stripe.checkout.sessions.create({
            mode: "payment",
            customer: customerId,
            line_items: paymentLineItems,
            payment_method_types: ["boleto", "card"],
            payment_method_options: { boleto: { expires_after_days: 3 } },
            success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: cancelUrl,
            metadata: paymentMeta,
            payment_intent_data: { metadata: paymentMeta },
          });
        } else {
          throw pixErr;
        }
      }
    }

    res.json({ url: session.url });
  } catch (err: any) {
    const stripeMsg = err?.raw?.message ?? err?.message ?? "Erro desconhecido";
    const stripeCode = err?.raw?.code ?? err?.code ?? err?.statusCode ?? "?";
    console.error(`[billing] Stripe checkout error (code=${stripeCode}):`, stripeMsg);
    res.status(500).json({ error: `Erro ao criar sessão de pagamento: ${stripeMsg}` });
  }
});

// POST /billing/confirm { sessionId } — called from the success page.
// Handles both subscription mode (card) and payment mode (PIX/Boleto).
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

  if (String(session.metadata?.crecheId) !== String(crecheId)) {
    res.status(403).json({ error: "Sessão não pertence a esta creche." });
    return;
  }

  // PIX and Boleto are async: redirect happens before bank confirmation.
  // Return { pending: true } so the UI shows a "waiting" message.
  // The webhook payment_intent.succeeded will activate the subscription later.
  if (session.payment_status !== "paid") {
    res.json({ ok: true, pending: true });
    return;
  }

  if (session.mode === "subscription") {
    // ── CARTÃO RECORRENTE ────────────────────────────────────────────────
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
  } else {
    // ── PIX / BOLETO / CARTÃO AVULSO ────────────────────────────────────
    const planId = Number(session.metadata?.planId);
    const interval = session.metadata?.interval as BillingInterval;
    if (!planId || !BILLING_INTERVALS.includes(interval)) {
      res.status(400).json({ error: "Metadados da sessão inválidos." });
      return;
    }
    const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, planId)).limit(1);
    if (!plan) {
      res.status(400).json({ error: "Plano não encontrado." });
      return;
    }
    // Security: verify the paid amount matches what we'd charge for this plan.
    const [planPrice] = await db
      .select()
      .from(planPricesTable)
      .where(and(eq(planPricesTable.planId, planId), eq(planPricesTable.interval, interval)))
      .limit(1);
    const expectedAmount = planPrice?.priceBrl ?? computeIntervalPrice(plan.priceBrl, interval);
    const paidAmount = session.amount_total ?? 0;
    if (paidAmount !== expectedAmount) {
      console.error(`[billing] Amount mismatch: paid=${paidAmount} expected=${expectedAmount}`);
      res.status(400).json({ error: "Valor pago não corresponde ao plano selecionado." });
      return;
    }
    const periodEnd = new Date();
    periodEnd.setMonth(periodEnd.getMonth() + INTERVAL_MONTHS[interval]);
    await db
      .update(subscriptionsTable)
      .set({
        planId,
        billingInterval: interval,
        status: "active",
        stripeCustomerId: typeof session.customer === "string" ? session.customer : undefined,
        stripeSubscriptionId: undefined,
        currentPeriodEnd: periodEnd,
        pastDueSince: null,
      })
      .where(eq(subscriptionsTable.crecheId, crecheId));
  }

  res.json({ ok: true, pending: false });
});

// POST /billing/portal — Stripe billing portal for self-service management.
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
