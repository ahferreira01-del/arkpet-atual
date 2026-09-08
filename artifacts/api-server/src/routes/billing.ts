import { Router } from "express";
import crypto from "crypto";
import { db } from "@workspace/db";
import {
  BILLING_INTERVALS,
  INTERVAL_MONTHS,
  INTERVAL_LABELS,
  computeIntervalPrice,
  type BillingInterval,
} from "@workspace/db";
import {
  plansTable,
  planPricesTable,
  subscriptionsTable,
  crechesTable,
  petsTable,
  commercialAgreementsTable,
  platformServiceRequestsTable,
} from "@workspace/db/schema";
import { eq, and, count, isNotNull, lte, desc, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate.js";
import { getUncachableStripeClient } from "../lib/stripeClient.js";
import { resolvePlanByPrice } from "../lib/subscriptionSync.js";
import { getAppBaseUrl } from "../lib/config.js";
import { sensitiveLimiter } from "../middlewares/rateLimit.js";
import {
  acceptProposal,
  declineProposal,
  CommercialProposalError,
} from "../services/commercialProposals.js";
import {
  requestAssistedImplementation,
  acceptImplementationQuote,
  createImplementationCheckoutSession,
  cancelImplementation,
  PlatformServiceError,
} from "../services/platformServices.js";
import {
  withCommercialOperationIdempotency,
  validateIdempotencyKey,
} from "../services/commercialOperationRequests.js";
import { COMMERCIAL_OPERATIONS } from "./commercial.js";

// Validates a redirect URL supplied by the client. Accepts only http/https URLs
// whose origin matches the app's own base URL or the request's Origin header.
// Rejects javascript:, data:, and any other potentially dangerous schemes.
function isSafeRedirectUrl(url: string, requestOrigin?: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const appOrigin = new URL(getAppBaseUrl()).origin;
    if (parsed.origin === appOrigin) return true;
    if (requestOrigin && parsed.origin === requestOrigin) return true;
    return false;
  } catch {
    return false;
  }
}

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

// GET /billing/subscription — current creche subscription + its plan + scheduled plan.
router.get("/subscription", async (req: AuthRequest, res) => {
  const crecheId = req.user?.crecheId;
  if (!crecheId) {
    res.status(400).json({ error: "Usuário não está associado a uma creche." });
    return;
  }

  const scheduledPlan = alias(plansTable, "scheduled_plan");

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
      scheduledPlanId: subscriptionsTable.scheduledPlanId,
      scheduledBillingInterval: subscriptionsTable.scheduledBillingInterval,
      scheduledPeriodEnd: subscriptionsTable.scheduledPeriodEnd,
      plan: {
        id: plansTable.id,
        name: plansTable.name,
        petLimit: plansTable.petLimit,
        priceBrl: plansTable.priceBrl,
        description: plansTable.description,
        stripePriceId: plansTable.stripePriceId,
      },
      scheduledPlanInfo: {
        id: scheduledPlan.id,
        name: scheduledPlan.name,
        petLimit: scheduledPlan.petLimit,
        priceBrl: scheduledPlan.priceBrl,
      },
    })
    .from(subscriptionsTable)
    .innerJoin(plansTable, eq(subscriptionsTable.planId, plansTable.id))
    .leftJoin(scheduledPlan, eq(subscriptionsTable.scheduledPlanId, scheduledPlan.id))
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

// GET /billing/saved-card — returns the card (brand + last4) saved on the active Stripe
// subscription for this creche, or null if none. Used to show the card in the plan-change
// dialog so the user can choose to reuse it or enter a different one.
router.get("/saved-card", requireRole("creche_admin"), async (req: AuthRequest, res) => {
  const crecheId = req.user?.crecheId;
  if (!crecheId) {
    res.status(400).json({ error: "Usuário não está associado a uma creche." });
    return;
  }

  const [sub] = await db
    .select({ stripeSubscriptionId: subscriptionsTable.stripeSubscriptionId })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.crecheId, crecheId))
    .limit(1);

  if (!sub?.stripeSubscriptionId) {
    res.json({ savedCard: null });
    return;
  }

  try {
    const stripe = await getUncachableStripeClient();
    const stripeSub = await stripe.subscriptions.retrieve(
      sub.stripeSubscriptionId,
      { expand: ["default_payment_method"] } as any,
    ) as any;
    const pm = stripeSub.default_payment_method;
    if (pm?.card) {
      res.json({
        savedCard: {
          brand: (pm.card.brand as string) ?? "card",
          last4: pm.card.last4 as string,
          expMonth: pm.card.exp_month as number,
          expYear: pm.card.exp_year as number,
        },
      });
      return;
    }
  } catch (err: any) {
    console.warn("[billing] Não foi possível buscar cartão salvo:", err?.message ?? err);
  }
  res.json({ savedCard: null });
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
// creche_admin only. Rate-limited to prevent Stripe session spam.
router.post("/checkout", sensitiveLimiter, requireRole("creche_admin"), async (req: AuthRequest, res) => {
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

  // When true, skips the direct-upgrade path and forces a full Stripe Checkout session,
  // allowing the user to enter a different card even if they already have one on file.
  const forceNewCard = req.body?.forceNewCard === true;

  // Frontend passes its own origin so the redirect works both in dev and production.
  // Validate that client-supplied URLs are same-origin (prevents open-redirect abuse).
  const requestOrigin = req.headers.origin as string | undefined;
  const rawSuccessUrl = typeof req.body?.successUrl === "string" ? req.body.successUrl : null;
  const rawCancelUrl = typeof req.body?.cancelUrl === "string" ? req.body.cancelUrl : null;
  const baseUrl = getAppBaseUrl();
  const successUrl =
    rawSuccessUrl && isSafeRedirectUrl(rawSuccessUrl, requestOrigin)
      ? rawSuccessUrl
      : `${baseUrl}/assinatura/sucesso`;
  const cancelUrl =
    rawCancelUrl && isSafeRedirectUrl(rawCancelUrl, requestOrigin)
      ? rawCancelUrl
      : `${baseUrl}/assinatura?cancelado=1`;

  const [plan] = await db
    .select()
    .from(plansTable)
    .where(and(eq(plansTable.id, planId), eq(plansTable.isActive, true)))
    .limit(1);
  if (!plan || plan.priceBrl === 0) {
    res.status(404).json({ error: "Plano não encontrado, inativo ou gratuito." });
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
      // Idempotency key tied to the creche prevents duplicate customers if the
      // endpoint is called concurrently (e.g. double-click, retry in flight).
      const customer = await stripe.customers.create(
        {
          name: creche?.name ?? `Creche ${crecheId}`,
          email: creche?.email ?? req.user?.email,
          metadata: { crecheId: String(crecheId) },
        },
        { idempotencyKey: `creche-customer-${crecheId}` },
      );
      customerId = customer.id;
      await db
        .update(subscriptionsTable)
        .set({ stripeCustomerId: customerId })
        .where(eq(subscriptionsTable.id, subscription.id));
    }

    const unitAmount = planPrice?.priceBrl ?? computeIntervalPrice(plan.priceBrl, interval);
    const priceId = planPrice?.stripePriceId ?? (interval === "month" ? plan.stripePriceId : null);

    // ── DIRECT UPGRADE via saved card ────────────────────────────────────────
    // If the customer already has an active Stripe subscription and is choosing
    // subscription mode with a valid price ID, update the subscription directly
    // instead of redirecting to Stripe Checkout. This reuses the saved card
    // transparently — no checkout redirect needed. Stripe applies proration
    // automatically (charges/credits the difference for the current period).
    if (
      paymentMode === "subscription" &&
      priceId &&
      !forceNewCard &&
      subscription.stripeSubscriptionId &&
      subscription.status === "active"
    ) {
      let stripeSub: any;
      try {
        stripeSub = await stripe.subscriptions.retrieve(
          subscription.stripeSubscriptionId,
          { expand: ["items"] } as any,
        );
      } catch (retrieveErr: any) {
        // Subscription may have been cancelled externally (e.g. user previously paid
        // via PIX and the old card sub was already cancelled). Fall through to a full
        // Stripe Checkout session instead of hard-erroring.
        const retrieveStatus = retrieveErr?.statusCode ?? retrieveErr?.raw?.statusCode;
        console.warn(
          `[billing] Não foi possível recuperar assinatura Stripe ${subscription.stripeSubscriptionId} ` +
          `(HTTP ${retrieveStatus ?? "?"}) — iniciando novo checkout. Erro: ${retrieveErr?.message ?? retrieveErr}`,
        );
        // Clear the stale subscription ID so the next request doesn't try again.
        await db
          .update(subscriptionsTable)
          .set({ stripeSubscriptionId: null })
          .where(eq(subscriptionsTable.crecheId, crecheId));
        // Fall through to the regular Stripe Checkout session below.
        // eslint-disable-next-line no-fallthrough
      }

      if (stripeSub) {
        // Subscription still exists: verify it's upgradeable (status != canceled).
        if (stripeSub.status === "canceled" || stripeSub.status === "incomplete_expired") {
          console.warn(`[billing] Assinatura ${subscription.stripeSubscriptionId} está ${stripeSub.status} — iniciando novo checkout.`);
          await db
            .update(subscriptionsTable)
            .set({ stripeSubscriptionId: null })
            .where(eq(subscriptionsTable.crecheId, crecheId));
          // Fall through to Checkout below (stripeSub = undefined would re-enter the block,
          // so we explicitly redirect here to avoid confusion).
          // Do nothing — let the code below create a new session.
        } else {
          const existingItemId = stripeSub?.items?.data?.[0]?.id;
          if (!existingItemId) {
            res.status(400).json({ error: "Assinatura Stripe sem itens. Tente via checkout." });
            return;
          }

          try {
            await stripe.subscriptions.update(subscription.stripeSubscriptionId!, {
              items: [{ id: existingItemId, price: priceId }],
              // always_invoice: creates and immediately charges a proration invoice on the
              // saved card. "create_prorations" only queues the amount for the next cycle —
              // the payment would never arrive until the renewal date.
              proration_behavior: "always_invoice",
              metadata: { crecheId: String(crecheId), planId: String(planId), interval },
            } as any);
          } catch (updateErr: any) {
            const stripeMsg = updateErr?.raw?.message ?? updateErr?.message ?? "Erro desconhecido";
            console.error(`[billing] Falha ao atualizar assinatura Stripe para crecheId=${crecheId}: ${stripeMsg}`);
            res.status(500).json({ error: `Não foi possível atualizar o plano: ${stripeMsg}` });
            return;
          }

          // Optimistically update the DB now; the webhook will confirm/correct later.
          let newPeriodEnd: Date | null = null;
          try {
            const updatedStripeSub = await stripe.subscriptions.retrieve(
              subscription.stripeSubscriptionId!,
            ) as any;
            newPeriodEnd = readPeriodEnd(updatedStripeSub);
          } catch {
            // Non-fatal: webhook will sync the period end.
          }

          await db
            .update(subscriptionsTable)
            .set({
              planId,
              billingInterval: interval,
              status: "active",
              pastDueSince: null,
              scheduledPlanId: null,
              scheduledBillingInterval: null,
              scheduledPeriodEnd: null,
              ...(newPeriodEnd ? { currentPeriodEnd: newPeriodEnd } : {}),
            })
            .where(eq(subscriptionsTable.crecheId, crecheId));

          console.log(`[billing] Direct upgrade via cartão salvo: crecheId=${crecheId} planId=${planId} interval=${interval}`);
          res.json({ directUpgrade: true });
          return;
        }
      }
    }

    let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;

    if (paymentMode === "subscription") {
      // ── CARTÃO RECORRENTE (novo cliente / primeiro checkout) ─────────────
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

      // Use automatic_payment_methods so o Stripe exibe os métodos disponíveis
      // na conta (Boleto, Cartão e PIX quando liberado pelo Stripe).
      // Não é preciso listar explicitamente — o Stripe decide com base no que
      // está ativo na conta. PIX aparecerá automaticamente quando aprovado.
      session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer: customerId,
        line_items: paymentLineItems,
        automatic_payment_methods: { enabled: true },
        payment_method_options: {
          boleto: { expires_after_days: 3 },
        },
        success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl,
        metadata: paymentMeta,
        payment_intent_data: { metadata: paymentMeta },
      } as any);
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

  let stripe: Awaited<ReturnType<typeof getUncachableStripeClient>>;
  try {
    stripe = await getUncachableStripeClient();
  } catch (err: any) {
    console.error("[billing/confirm] falha ao obter cliente Stripe:", err?.message ?? err);
    res.status(500).json({ error: "Serviço de pagamento indisponível. Tente novamente." });
    return;
  }

  let session: Awaited<ReturnType<typeof stripe.checkout.sessions.retrieve>>;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription", "line_items"],
    });
  } catch (err: any) {
    const stripeCode = err?.statusCode ?? err?.raw?.statusCode ?? "?";
    const stripeMsg = err?.raw?.message ?? err?.message ?? "Erro desconhecido";
    console.error(`[billing/confirm] Falha ao recuperar sessão ${sessionId} (HTTP ${stripeCode}): ${stripeMsg}`);
    // Return a soft error — the payment may still have gone through.
    // The webhook will activate the subscription if it was successful.
    res.status(400).json({ error: `Não foi possível verificar a sessão de pagamento: ${stripeMsg}` });
    return;
  }

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
    const newStripeSubId: string | null = stripeSubscription?.id ?? null;

    // Fetch the old stripeSubscriptionId before overwriting so we can cancel the
    // previous Stripe subscription if the user chose to pay with a different card
    // (forceNewCard=true creates a brand-new subscription that replaces the old one).
    const [prevSub] = await db
      .select({ stripeSubscriptionId: subscriptionsTable.stripeSubscriptionId })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.crecheId, crecheId))
      .limit(1);
    const oldStripeSubId = prevSub?.stripeSubscriptionId ?? null;

    await db
      .update(subscriptionsTable)
      .set({
        planId: resolved.planId,
        billingInterval: resolved.interval,
        status: "active",
        stripeCustomerId: typeof session.customer === "string" ? session.customer : undefined,
        stripeSubscriptionId: newStripeSubId ?? undefined,
        currentPeriodEnd: stripeSubscription ? readPeriodEnd(stripeSubscription) : undefined,
        pastDueSince: null,
      })
      .where(eq(subscriptionsTable.crecheId, crecheId));

    // Cancel the old subscription in Stripe when a new one replaced it.
    if (oldStripeSubId && newStripeSubId && oldStripeSubId !== newStripeSubId) {
      try {
        await stripe.subscriptions.cancel(oldStripeSubId);
        console.log(`[billing] Assinatura anterior cancelada: ${oldStripeSubId} → substituída por ${newStripeSubId}`);
      } catch (cancelErr: any) {
        console.warn(`[billing] Falha ao cancelar sub anterior ${oldStripeSubId}:`, cancelErr?.message ?? cancelErr);
      }
    }
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
    // Determine whether this is a downgrade while an active period still has time left.
    // If so, schedule the change for when the current period ends instead of switching now.
    const [currentSub] = await db
      .select({
        status: subscriptionsTable.status,
        currentPeriodEnd: subscriptionsTable.currentPeriodEnd,
        planId: subscriptionsTable.planId,
      })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.crecheId, crecheId))
      .limit(1);

    const [currentPlan] = await db
      .select({ priceBrl: plansTable.priceBrl })
      .from(plansTable)
      .where(eq(plansTable.id, currentSub?.planId ?? 0))
      .limit(1);

    const now = new Date();
    const hasActivePeriod =
      currentSub?.status === "active" &&
      currentSub.currentPeriodEnd != null &&
      currentSub.currentPeriodEnd > now;
    const isDowngrade = hasActivePeriod && plan.priceBrl < (currentPlan?.priceBrl ?? 0);

    if (isDowngrade) {
      // Keep current (higher) plan active; queue the cheaper plan for when it expires.
      // The new period starts from currentPeriodEnd and lasts interval months.
      const scheduledPeriodEnd = new Date(currentSub!.currentPeriodEnd!);
      scheduledPeriodEnd.setMonth(scheduledPeriodEnd.getMonth() + INTERVAL_MONTHS[interval]);

      await db
        .update(subscriptionsTable)
        .set({
          scheduledPlanId: planId,
          scheduledBillingInterval: interval,
          scheduledPeriodEnd,
          stripeCustomerId: typeof session.customer === "string" ? session.customer : undefined,
        })
        .where(eq(subscriptionsTable.crecheId, crecheId));

      console.log(`[billing] Downgrade agendado para crecheId=${crecheId}: planId=${planId} a partir de ${currentSub!.currentPeriodEnd!.toISOString()}`);
    } else {
      // Upgrade or first activation — apply immediately and clear any pending schedule.
      const periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() + INTERVAL_MONTHS[interval]);

      await db
        .update(subscriptionsTable)
        .set({
          planId,
          billingInterval: interval,
          status: "active",
          stripeCustomerId: typeof session.customer === "string" ? session.customer : undefined,
          stripeSubscriptionId: null, // PIX/Boleto: no Stripe subscription; must be null (not undefined) so Drizzle clears the field
          currentPeriodEnd: periodEnd,
          pastDueSince: null,
          scheduledPlanId: null,
          scheduledBillingInterval: null,
          scheduledPeriodEnd: null,
        })
        .where(eq(subscriptionsTable.crecheId, crecheId));
    }
  }

  res.json({ ok: true, pending: false });
});

// DELETE /billing/scheduled — cancel a pending plan change.
router.delete("/scheduled", requireRole("creche_admin"), async (req: AuthRequest, res) => {
  const crecheId = req.user?.crecheId;
  if (!crecheId) {
    res.status(400).json({ error: "Usuário não está associado a uma creche." });
    return;
  }
  await db
    .update(subscriptionsTable)
    .set({ scheduledPlanId: null, scheduledBillingInterval: null, scheduledPeriodEnd: null })
    .where(eq(subscriptionsTable.crecheId, crecheId));
  res.json({ ok: true });
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

// ==========================================================
// CUSTOMER COMMERCIAL PROPOSALS (Phase R36.G)
// ==========================================================

router.get("/proposals", requireRole("creche_admin"), async (req: AuthRequest, res) => {
  const crecheId = req.user?.crecheId;
  if (!crecheId) {
    res.status(400).json({ error: "Usuário não está associado a uma creche." });
    return;
  }

  try {
    const proposals = await db
      .select()
      .from(commercialAgreementsTable)
      .where(
        and(
          eq(commercialAgreementsTable.crecheId, crecheId),
          eq(commercialAgreementsTable.type, "commercial_proposal"),
          sql`${commercialAgreementsTable.status} IN ('sent', 'accepted', 'declined', 'expired', 'superseded')`,
        ),
      )
      .orderBy(desc(commercialAgreementsTable.createdAt));

    // Customer-safe mapping (never expose internal Stripe IDs or internal condition IDs)
    const customerSafeProposals = proposals.map((p) => {
      const snapshot = (p.snapshotJson as any) ?? {};
      return {
        id: p.id,
        title: p.title,
        status: p.status,
        activationStatus: p.activationStatus,
        sentAt: p.sentAt,
        acceptedAt: p.acceptedAt,
        declinedAt: p.declinedAt,
        validUntil: p.validUntil,
        notes: p.notes,
        terms: {
          planName: snapshot.planName ?? null,
          billingInterval: snapshot.billingInterval ?? null,
          displayedEffectivePriceCents: snapshot.displayedEffectivePriceCents ?? snapshot.catalogPriceCents ?? null,
          entitlementPetLimit: snapshot.entitlementPetLimit ?? null,
          prorationMode: snapshot.prorationMode ?? null,
        },
      };
    });

    res.json(customerSafeProposals);
  } catch (err: any) {
    res.status(500).json({ error: "LIST_PROPOSALS_ERROR", message: err.message });
  }
});

router.get("/proposals/:id", requireRole("creche_admin"), async (req: AuthRequest, res) => {
  const crecheId = req.user?.crecheId;
  if (!crecheId) {
    res.status(400).json({ error: "Usuário não está associado a uma creche." });
    return;
  }

  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }

  try {
    const [p] = await db
      .select()
      .from(commercialAgreementsTable)
      .where(
        and(
          eq(commercialAgreementsTable.id, id),
          eq(commercialAgreementsTable.crecheId, crecheId),
          eq(commercialAgreementsTable.type, "commercial_proposal"),
        ),
      )
      .limit(1);

    if (!p) {
      res.status(404).json({ error: "PROPOSAL_NOT_FOUND", message: "Proposta não encontrada." });
      return;
    }

    const snapshot = ((p as any).termsSnapshot ?? p.snapshotJson as any) ?? {};
    res.json({
      id: p.id,
      title: p.title,
      status: p.status,
      activationStatus: p.activationStatus,
      sentAt: p.sentAt,
      acceptedAt: p.acceptedAt,
      declinedAt: p.declinedAt,
      validUntil: p.validUntil,
      notes: p.notes,
      terms: {
        planName: snapshot.planName ?? null,
        billingInterval: snapshot.billingInterval ?? null,
        displayedEffectivePriceCents: snapshot.displayedEffectivePriceCents ?? snapshot.catalogPriceCents ?? null,
        entitlementPetLimit: snapshot.entitlementPetLimit ?? null,
        prorationMode: snapshot.prorationMode ?? null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: "GET_PROPOSAL_ERROR", message: err.message });
  }
});

router.post("/proposals/:id/accept", requireRole("creche_admin"), async (req: AuthRequest, res) => {
  const crecheId = req.user?.crecheId;
  if (!crecheId) {
    res.status(400).json({ error: "Usuário não está associado a uma creche." });
    return;
  }

  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }

  let idempotencyKey: string;
  try {
    const rawKey = (req.headers["x-idempotency-key"] as string) || (req.header("X-Idempotency-Key") as string) || null;
    idempotencyKey = rawKey ? validateIdempotencyKey(rawKey) : crypto.randomUUID();
  } catch (err: any) {
    res.status(400).json({ error: "idempotency_key_invalid", message: err.message });
    return;
  }

  const executeAction = async (tx?: any) => {
    return await acceptProposal({
      id,
      crecheId,
      userId: req.user!.id,
      userEmail: req.user?.email,
      dbClient: tx,
    });
  };

  try {
    if (idempotencyKey) {
      validateIdempotencyKey(idempotencyKey);
      const result = await withCommercialOperationIdempotency({
        crecheId,
        operation: COMMERCIAL_OPERATIONS.ACCEPT_PROPOSAL,
        idempotencyKey,
        payload: { id, crecheId },
        resourceType: "commercial_agreement",
        isDbOnly: false,
        execute: async (tx) => {
          const acceptRes = await executeAction(tx);
          return { statusCode: 200, data: acceptRes, resourceId: acceptRes.agreement.id };
        },
      });
      res.status(result.statusCode).json({
        ...((result.data as any) ?? {}),
        ...(result.replayed ? { replay: true } : {}),
      });
      return;
    }

    const acceptRes = await executeAction();
    res.json(acceptRes);
  } catch (err: any) {
    if (err instanceof CommercialProposalError) {
      res.status(err.statusCode).json({ error: err.code, code: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "ACCEPT_PROPOSAL_ERROR", message: err.message });
  }
});

router.post("/proposals/:id/decline", requireRole("creche_admin"), async (req: AuthRequest, res) => {
  const crecheId = req.user?.crecheId;
  if (!crecheId) {
    res.status(400).json({ error: "Usuário não está associado a uma creche." });
    return;
  }

  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }

  const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : null;
  let idempotencyKey: string;
  try {
    const rawKey = (req.headers["x-idempotency-key"] as string) || (req.header("X-Idempotency-Key") as string) || null;
    idempotencyKey = rawKey ? validateIdempotencyKey(rawKey) : crypto.randomUUID();
  } catch (err: any) {
    res.status(400).json({ error: "idempotency_key_invalid", message: err.message });
    return;
  }

  const executeAction = async (tx?: any) => {
    return await declineProposal({
      id,
      crecheId,
      userId: req.user!.id,
      userEmail: req.user?.email,
      reason,
      dbClient: tx,
    });
  };

  try {
    if (idempotencyKey) {
      validateIdempotencyKey(idempotencyKey);
      const result = await withCommercialOperationIdempotency({
        crecheId,
        operation: COMMERCIAL_OPERATIONS.DECLINE_PROPOSAL,
        idempotencyKey,
        payload: { id, crecheId, reason },
        resourceType: "commercial_agreement",
        isDbOnly: true,
        execute: async (tx) => {
          const declined = await executeAction(tx);
          return { statusCode: 200, data: declined, resourceId: declined.id };
        },
      });
      res.status(result.statusCode).json({
        ...(result.data as Record<string, unknown>),
        ...(result.replayed ? { replay: true } : {}),
      });
      return;
    }

    const declined = await executeAction();
    res.json(declined);
  } catch (err: any) {
    if (err instanceof CommercialProposalError) {
      res.status(err.statusCode).json({ error: err.code, code: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "DECLINE_PROPOSAL_ERROR", message: err.message });
  }
});

// ==========================================================
// CUSTOMER PLATFORM SERVICES (Phase R36.G: Assisted Implementation)
// ==========================================================

router.get("/platform-services", requireRole("creche_admin"), async (req: AuthRequest, res) => {
  const crecheId = req.user?.crecheId;
  if (!crecheId) {
    res.status(400).json({ error: "Usuário não está associado a uma creche." });
    return;
  }

  try {
    const requests = await db
      .select()
      .from(platformServiceRequestsTable)
      .where(eq(platformServiceRequestsTable.crecheId, crecheId))
      .orderBy(desc(platformServiceRequestsTable.createdAt));

    res.json(requests);
  } catch (err: any) {
    res.status(500).json({ error: "LIST_PLATFORM_SERVICES_ERROR", message: err.message });
  }
});

router.post("/platform-services/request", requireRole("creche_admin"), async (req: AuthRequest, res) => {
  const crecheId = req.user?.crecheId;
  if (!crecheId) {
    res.status(400).json({ error: "Usuário não está associado a uma creche." });
    return;
  }

  const { customerNotes } = req.body;
  let idempotencyKey: string;
  try {
    const rawKey = (req.headers["x-idempotency-key"] as string) || (req.header("X-Idempotency-Key") as string) || null;
    idempotencyKey = rawKey ? validateIdempotencyKey(rawKey) : crypto.randomUUID();
  } catch (err: any) {
    res.status(400).json({ error: "idempotency_key_invalid", message: err.message });
    return;
  }

  const executeAction = async (tx?: any) => {
    return await requestAssistedImplementation({
      crecheId,
      userId: req.user!.id,
      userEmail: req.user?.email,
      customerNotes,
      dbClient: tx,
    });
  };

  try {
    if (idempotencyKey) {
      validateIdempotencyKey(idempotencyKey);
      const result = await withCommercialOperationIdempotency({
        crecheId,
        operation: COMMERCIAL_OPERATIONS.REQUEST_ASSISTED_IMPLEMENTATION,
        idempotencyKey,
        payload: { crecheId, customerNotes },
        resourceType: "platform_service_request",
        isDbOnly: true,
        execute: async (tx) => {
          const created = await executeAction(tx);
          return { statusCode: 201, data: created, resourceId: created.id };
        },
      });
      res.status(result.statusCode).json({
        ...(result.data as Record<string, unknown>),
        ...(result.replayed ? { replay: true } : {}),
      });
      return;
    }

    const created = await executeAction();
    res.status(201).json(created);
  } catch (err: any) {
    if (err instanceof PlatformServiceError) {
      res.status(err.statusCode).json({ error: err.code, code: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "REQUEST_IMPLEMENTATION_ERROR", message: err.message });
  }
});

router.post("/platform-services/:id/accept-quote", requireRole("creche_admin"), async (req: AuthRequest, res) => {
  const crecheId = req.user?.crecheId;
  if (!crecheId) {
    res.status(400).json({ error: "Usuário não está associado a uma creche." });
    return;
  }

  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }

  let idempotencyKey: string;
  try {
    const rawKey = (req.headers["x-idempotency-key"] as string) || (req.header("X-Idempotency-Key") as string) || null;
    idempotencyKey = rawKey ? validateIdempotencyKey(rawKey) : crypto.randomUUID();
  } catch (err: any) {
    res.status(400).json({ error: "idempotency_key_invalid", message: err.message });
    return;
  }

  const executeAction = async (tx?: any) => {
    return await acceptImplementationQuote({
      id,
      crecheId,
      userId: req.user!.id,
      userEmail: req.user?.email,
      dbClient: tx,
    });
  };

  try {
    if (idempotencyKey) {
      validateIdempotencyKey(idempotencyKey);
      const result = await withCommercialOperationIdempotency({
        crecheId,
        operation: COMMERCIAL_OPERATIONS.ACCEPT_IMPLEMENTATION_QUOTE,
        idempotencyKey,
        payload: { id, crecheId },
        resourceType: "platform_service_request",
        isDbOnly: true,
        execute: async (tx) => {
          const accepted = await executeAction(tx);
          return { statusCode: 200, data: accepted, resourceId: accepted.id };
        },
      });
      res.status(result.statusCode).json({
        ...(result.data as Record<string, unknown>),
        ...(result.replayed ? { replay: true } : {}),
      });
      return;
    }

    const accepted = await executeAction();
    res.json(accepted);
  } catch (err: any) {
    if (err instanceof PlatformServiceError) {
      res.status(err.statusCode).json({ error: err.code, code: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "ACCEPT_QUOTE_ERROR", message: err.message });
  }
});

router.post("/platform-services/:id/create-checkout-session", requireRole("creche_admin"), async (req: AuthRequest, res) => {
  const crecheId = req.user?.crecheId;
  if (!crecheId) {
    res.status(400).json({ error: "Usuário não está associado a uma creche." });
    return;
  }

  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }

  const appBaseUrl = getAppBaseUrl();
  const successUrl = req.body.successUrl || `${appBaseUrl}/assinatura?impl_session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = req.body.cancelUrl || `${appBaseUrl}/assinatura`;
  let idempotencyAttemptKey: string;
  try {
    const rawKey = (req.headers["x-idempotency-key"] as string) || (req.header("X-Idempotency-Key") as string) || req.body.idempotencyAttemptKey || null;
    idempotencyAttemptKey = rawKey ? validateIdempotencyKey(rawKey) : crypto.randomUUID();
  } catch (err: any) {
    res.status(400).json({ error: "idempotency_key_invalid", message: err.message });
    return;
  }

  const executeAction = async (tx?: any) => {
    return await createImplementationCheckoutSession({
      id,
      crecheId,
      userId: req.user!.id,
      successUrl,
      cancelUrl,
      idempotencyAttemptKey,
      dbClient: tx,
    });
  };

  try {
    if (idempotencyAttemptKey) {
      validateIdempotencyKey(idempotencyAttemptKey);
      const result = await withCommercialOperationIdempotency({
        crecheId,
        operation: COMMERCIAL_OPERATIONS.CREATE_IMPLEMENTATION_PAYMENT,
        idempotencyKey: idempotencyAttemptKey,
        payload: { id, crecheId },
        resourceType: "platform_service_request",
        isDbOnly: false,
        execute: async (tx) => {
          const sessionResult = await executeAction(tx);
          return { statusCode: 200, data: sessionResult, resourceId: id };
        },
      });
      res.status(result.statusCode).json({
        ...(result.data as Record<string, unknown>),
        ...(result.replayed ? { replay: true } : {}),
      });
      return;
    }

    const sessionResult = await executeAction();
    res.json(sessionResult);
  } catch (err: any) {
    if (err instanceof PlatformServiceError) {
      res.status(err.statusCode).json({ error: err.code, code: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "CREATE_CHECKOUT_ERROR", message: err.message });
  }
});

router.post("/platform-services/:id/cancel", requireRole("creche_admin"), async (req: AuthRequest, res) => {
  const crecheId = req.user?.crecheId;
  if (!crecheId) {
    res.status(400).json({ error: "Usuário não está associado a uma creche." });
    return;
  }

  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }

  const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "Cancelamento solicitado pelo cliente";
  let idempotencyKey: string;
  try {
    const rawKey = (req.headers["x-idempotency-key"] as string) || (req.header("X-Idempotency-Key") as string) || null;
    idempotencyKey = rawKey ? validateIdempotencyKey(rawKey) : crypto.randomUUID();
  } catch (err: any) {
    res.status(400).json({ error: "idempotency_key_invalid", message: err.message });
    return;
  }

  const executeAction = async (tx?: any) => {
    return await cancelImplementation({
      id,
      crecheId,
      actorRole: "creche_admin",
      actorId: req.user!.id,
      actorEmail: req.user?.email,
      reason,
      dbClient: tx,
    });
  };

  try {
    if (idempotencyKey) {
      validateIdempotencyKey(idempotencyKey);
      const result = await withCommercialOperationIdempotency({
        crecheId,
        operation: COMMERCIAL_OPERATIONS.CANCEL_IMPLEMENTATION,
        idempotencyKey,
        payload: { id, crecheId, reason },
        resourceType: "platform_service_request",
        isDbOnly: false,
        execute: async (tx) => {
          const cancelled = await executeAction(tx);
          return { statusCode: 200, data: cancelled, resourceId: cancelled.id };
        },
      });
      res.status(result.statusCode).json({
        ...(result.data as Record<string, unknown>),
        ...(result.replayed ? { replay: true } : {}),
      });
      return;
    }

    const cancelled = await executeAction();
    res.json(cancelled);
  } catch (err: any) {
    if (err instanceof PlatformServiceError) {
      res.status(err.statusCode).json({ error: err.code, code: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "CANCEL_SERVICE_ERROR", message: err.message });
  }
});

// ─── Commercial Notifications for Creche Admin (R36.H) ───────────────────────

router.get(
  "/commercial-notifications",
  authenticate,
  requireRole("creche_admin"),
  async (req: AuthRequest, res) => {
    try {
      const crecheId = req.user!.crecheId!;
      const userId = req.user!.id;
      const { getCommercialNotificationsForUser } = await import("../services/commercialOutbox.js");
      const notifications = await getCommercialNotificationsForUser(userId, crecheId, "creche_admin");
      const unreadCount = notifications.filter((n) => !n.readAt).length;

      res.json({
        notifications,
        unreadCount,
      });
    } catch (err: any) {
      res.status(500).json({ error: "LIST_COMMERCIAL_NOTIFICATIONS_ERROR", message: err.message });
    }
  },
);

router.post(
  "/commercial-notifications/:id/read",
  authenticate,
  requireRole("creche_admin"),
  async (req: AuthRequest, res) => {
    try {
      const crecheId = req.user!.crecheId!;
      const userId = req.user!.id;
      const id = Number(req.params.id);
      if (!id || Number.isNaN(id)) {
        res.status(400).json({ error: "ID inválido." });
        return;
      }

      const { markCommercialNotificationAsRead } = await import("../services/commercialOutbox.js");
      const updated = await markCommercialNotificationAsRead(id, userId, crecheId);
      if (!updated) {
        res.status(404).json({ error: "NOTIFICATION_NOT_FOUND", message: "Notificação não encontrada." });
        return;
      }

      res.json({ success: true, notification: updated });
    } catch (err: any) {
      res.status(500).json({ error: "MARK_READ_ERROR", message: err.message });
    }
  },
);

router.post(
  "/commercial-notifications/read-all",
  authenticate,
  requireRole("creche_admin"),
  async (req: AuthRequest, res) => {
    try {
      const crecheId = req.user!.crecheId!;
      const userId = req.user!.id;
      const { markAllCommercialNotificationsAsRead } = await import("../services/commercialOutbox.js");
      const count = await markAllCommercialNotificationsAsRead(userId, crecheId);

      res.json({ success: true, markedCount: count });
    } catch (err: any) {
      res.status(500).json({ error: "MARK_ALL_READ_ERROR", message: err.message });
    }
  },
);

export default router;
