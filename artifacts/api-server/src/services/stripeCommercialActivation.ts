import Stripe from "stripe";
import { db, BILLING_INTERVALS, stripeRecurringFor, type BillingInterval } from "@workspace/db";
import {
  customerCommercialConditionsTable,
  subscriptionsTable,
  plansTable,
  planPricesTable,
  type CustomerCommercialCondition,
  type Subscription,
  type Plan,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { calculateEffectivePrice } from "./pricingEngine.js";
import { resolveCatalogPlanPrice, normalizeBillingInterval, CatalogPriceResolutionError } from "./catalogPricing.js";
import { logCommercialAudit } from "./commercialAudit.js";
import { getUncachableStripeClient } from "../lib/stripeClient.js";

export const ACTIVATION_TIMING_MODES = {
  EFFECTIVE_NOW_PRORATE: "EFFECTIVE_NOW_PRORATE",
  EFFECTIVE_NOW_NO_PRORATION: "EFFECTIVE_NOW_NO_PRORATION",
} as const;
export type ActivationTimingMode = (typeof ACTIVATION_TIMING_MODES)[keyof typeof ACTIVATION_TIMING_MODES];

export class CommercialActivationError extends Error {
  public code: string;
  public statusCode: number;

  constructor(code: string, message: string, statusCode: number = 422) {
    super(message);
    this.name = "CommercialActivationError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function mapProrationBehavior(mode: ActivationTimingMode): "always_invoice" | "none" {
  switch (mode) {
    case ACTIVATION_TIMING_MODES.EFFECTIVE_NOW_PRORATE:
      return "always_invoice";
    case ACTIVATION_TIMING_MODES.EFFECTIVE_NOW_NO_PRORATION:
      return "none";
    default:
      throw new CommercialActivationError(
        "UNSUPPORTED_PRORATION_MODE",
        `Modo de ativação '${mode}' não suportado no Slice 3. Modos suportados: EFFECTIVE_NOW_PRORATE, EFFECTIVE_NOW_NO_PRORATION.`,
        400,
      );
  }
}

/**
 * Identifies the single SaaS recurring subscription item to update on a Stripe subscription.
 * Fails closed if 0 or multiple ambiguous items exist.
 */
export function identifySubscriptionItem(
  stripeSubscription: Stripe.Subscription,
  targetPlanStripeProductId?: string | null,
): Stripe.SubscriptionItem {
  const items = stripeSubscription.items?.data ?? [];
  if (items.length === 0) {
    throw new CommercialActivationError(
      "RECONCILIATION_REQUIRED",
      "Assinatura Stripe sem itens recorrentes cadastrados. Reconciliação manual necessária.",
      422,
    );
  }
  if (items.length === 1) {
    return items[0];
  }

  // Multiple items: filter by product if targetPlanStripeProductId is provided
  if (targetPlanStripeProductId) {
    const matching = items.filter((it) => {
      const prodId = typeof it.price?.product === "string" ? it.price.product : (it.price?.product as any)?.id;
      return prodId === targetPlanStripeProductId;
    });
    if (matching.length === 1) {
      return matching[0];
    }
  }

  throw new CommercialActivationError(
    "AMBIGUOUS_SUBSCRIPTION_ITEMS",
    "Múltiplos itens recorrentes identificados na assinatura Stripe. Falha de segurança para evitar duplicidade.",
    422,
  );
}

/**
 * Resolves standard Stripe Price ID or creates an agreement/condition-scoped custom Stripe Price.
 */
export async function resolveOrCreateStripePrice(params: {
  condition: CustomerCommercialCondition;
  targetPlan: Plan;
  interval: BillingInterval;
  effectivePriceCents: number;
  catalogPriceCents: number;
  crecheId: number;
  stripeClient: Stripe;
  dbClient?: any;
}): Promise<{ stripePriceId: string; isCustom: boolean }> {
  const dbClient = params.dbClient ?? db;

  // 1. If effective price matches catalog base (or override is 'none'), use standard Stripe Price
  const isStandardPrice =
    params.condition.pricingOverrideType === "none" ||
    params.effectivePriceCents === params.catalogPriceCents;

  if (isStandardPrice) {
    // Find standard price for plan + interval
    const [pp] = await dbClient
      .select({ stripePriceId: planPricesTable.stripePriceId })
      .from(planPricesTable)
      .where(and(eq(planPricesTable.planId, params.targetPlan.id), eq(planPricesTable.interval, params.interval)))
      .limit(1);

    const standardPriceId = pp?.stripePriceId ?? (params.interval === "month" ? params.targetPlan.stripePriceId : null);
    if (!standardPriceId) {
      throw new CommercialActivationError(
        "STANDARD_STRIPE_PRICE_NOT_CONFIGURED",
        `Preço padrão do Stripe não configurado para o plano '${params.targetPlan.name}' no período '${params.interval}'.`,
        422,
      );
    }
    return { stripePriceId: standardPriceId, isCustom: false };
  }

  // 2. Custom Price: reuse if already generated on this condition (e.g. during a retry)
  if (params.condition.stripePriceId) {
    return { stripePriceId: params.condition.stripePriceId, isCustom: true };
  }

  // 3. Resolve verified Stripe Product ID
  let productId = params.targetPlan.stripeProductId;
  if (!productId) {
    // Try to resolve from standard Stripe price
    const [pp] = await dbClient
      .select({ stripePriceId: planPricesTable.stripePriceId })
      .from(planPricesTable)
      .where(and(eq(planPricesTable.planId, params.targetPlan.id), eq(planPricesTable.interval, params.interval)))
      .limit(1);

    const fallbackPriceId = pp?.stripePriceId ?? params.targetPlan.stripePriceId;
    if (fallbackPriceId) {
      try {
        const fetchedPrice = await params.stripeClient.prices.retrieve(fallbackPriceId);
        const resolvedProd = typeof fetchedPrice.product === "string" ? fetchedPrice.product : (fetchedPrice.product as any)?.id;
        if (resolvedProd) {
          productId = resolvedProd;
          // Cache verified product id
          await dbClient
            .update(plansTable)
            .set({ stripeProductId: resolvedProd })
            .where(eq(plansTable.id, params.targetPlan.id));
        }
      } catch (err: any) {
        console.warn(`[commercial] Failed to retrieve standard price ${fallbackPriceId}:`, err.message);
      }
    }
  }

  if (!productId) {
    throw new CommercialActivationError(
      "MISSING_STRIPE_PRODUCT_ID",
      `ID do Produto Stripe não encontrado para o plano '${params.targetPlan.name}'.`,
      422,
    );
  }

  // 4. Create custom Price with condition-scoped deterministic idempotency key
  const stepIdempotencyKey = `commercial:${params.condition.id}:create-custom-price`;
  const createdPrice = await params.stripeClient.prices.create(
    {
      currency: "brl",
      unit_amount: params.effectivePriceCents,
      recurring: stripeRecurringFor(params.interval),
      product: productId,
      metadata: {
        crecheId: String(params.crecheId),
        conditionId: String(params.condition.id),
        agreementId: params.condition.agreementId ? String(params.condition.agreementId) : "",
        planId: String(params.targetPlan.id),
        environment: process.env.NODE_ENV ?? "development",
        custom: "true",
      },
    },
    {
      idempotencyKey: stepIdempotencyKey,
    },
  );

  // Persist custom stripePriceId on condition row immediately for crash recovery
  await dbClient
    .update(customerCommercialConditionsTable)
    .set({ stripePriceId: createdPrice.id, updatedAt: new Date() })
    .where(eq(customerCommercialConditionsTable.id, params.condition.id));

  return { stripePriceId: createdPrice.id, isCustom: true };
}

export interface CommercialActivationResult {
  success: boolean;
  replay?: boolean;
  condition: CustomerCommercialCondition;
  subscription: Subscription;
  stripePriceId: string;
  isCustomPrice: boolean;
  effectivePriceCents: number;
  catalogPriceCents: number;
  message: string;
}

/**
 * Executes two-phase commercial condition activation against Stripe.
 */
export async function executeStripeCommercialActivation(params: {
  crecheId: number;
  conditionId: number;
  prorationMode: ActivationTimingMode;
  reason: string;
  idempotencyKey: string;
  requestFingerprint?: string;
  actorId?: number;
  actorEmail?: string;
  dbClient?: any;
  stripeClient?: Stripe;
}): Promise<CommercialActivationResult> {
  const dbClient = params.dbClient ?? db;
  const stripe = params.stripeClient ?? (await getUncachableStripeClient());

  if (!params.reason || typeof params.reason !== "string" || params.reason.trim().length === 0) {
    throw new CommercialActivationError(
      "REASON_REQUIRED",
      "Justificativa obrigatória para ativação comercial no gateway.",
      400,
    );
  }

  const prorationBehavior = mapProrationBehavior(params.prorationMode);

  // 1. Fetch condition & subscription
  const [condition] = await dbClient
    .select()
    .from(customerCommercialConditionsTable)
    .where(
      and(
        eq(customerCommercialConditionsTable.id, params.conditionId),
        eq(customerCommercialConditionsTable.crecheId, params.crecheId),
      ),
    )
    .limit(1);

  if (!condition) {
    throw new CommercialActivationError(
      "CONDITION_NOT_FOUND",
      `Proposta comercial #${params.conditionId} para a creche #${params.crecheId} não encontrada.`,
      404,
    );
  }

  // Eligibility checks (Section 6)
  if (condition.status !== "draft" && condition.status !== "activation_failed" && condition.status !== "pending_activation") {
    throw new CommercialActivationError(
      "INVALID_CONDITION_STATUS",
      `Apenas propostas em rascunho ou com falha prévia podem ser ativadas. Status atual: '${condition.status}'.`,
      422,
    );
  }

  if (condition.executionRequirement !== "STRIPE_REQUIRED") {
    throw new CommercialActivationError(
      "NOT_STRIPE_REQUIRED",
      `Esta proposta não requer ativação recorrente no Stripe (requisito: '${condition.executionRequirement}').`,
      422,
    );
  }

  const [sub] = await dbClient
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.crecheId, params.crecheId))
    .limit(1);

  if (!sub || !sub.stripeSubscriptionId) {
    throw new CommercialActivationError(
      "STRIPE_RECURRING_SUBSCRIPTION_REQUIRED",
      "Esta conta não possui uma assinatura recorrente Stripe vinculada e não pode receber ativação automática de preço neste momento.",
      422,
    );
  }

  const targetPlanId = condition.planId ?? sub.planId;
  const [targetPlan] = await dbClient
    .select()
    .from(plansTable)
    .where(eq(plansTable.id, targetPlanId))
    .limit(1);

  if (!targetPlan) {
    throw new CommercialActivationError(
      "PLAN_NOT_FOUND",
      `Plano alvo #${targetPlanId} não encontrado no catálogo.`,
      404,
    );
  }

  const interval: BillingInterval =
    (condition.snapshotBillingInterval ? normalizeBillingInterval(condition.snapshotBillingInterval) : null) ??
    (sub.billingInterval ? normalizeBillingInterval(sub.billingInterval) : null) ??
    "month";

  // Re-resolve authoritative catalog price (Section 11)
  let resolvedCatalog;
  try {
    resolvedCatalog = await resolveCatalogPlanPrice(targetPlan, interval, dbClient);
  } catch (err: any) {
    if (err instanceof CatalogPriceResolutionError) {
      throw new CommercialActivationError("CATALOG_PRICE_MISSING", err.message, 422);
    }
    throw err;
  }

  // Calculate effective price (Section 12)
  const calculation = calculateEffectivePrice({
    catalogPriceCents: resolvedCatalog.catalogPriceCents,
    pricingOverrideType: (condition.pricingOverrideType as any) ?? "none",
    pricingOverrideValue: condition.pricingOverrideValue ?? null,
  });

  const effectivePriceCents = calculation.finalEffectivePriceCents;

  // --------------------------------------------------------------------------
  // DB Transaction 1 (Pre-Stripe Transition)
  // --------------------------------------------------------------------------
  await dbClient.transaction(async (tx: any) => {
    await tx
      .update(customerCommercialConditionsTable)
      .set({
        status: "pending_activation",
        syncStatus: "sync_pending",
        reason: params.reason.trim(),
        idempotencyKey: params.idempotencyKey,
        idempotencyOperation: "ACTIVATE_PRICE_CONDITION",
        requestFingerprint: params.requestFingerprint ?? null,
        updatedAt: new Date(),
      })
      .where(eq(customerCommercialConditionsTable.id, condition.id));

    await logCommercialAudit(
      {
        targetCrecheId: params.crecheId,
        actorType: "user",
        actorId: params.actorId,
        actorRole: "master_admin",
        actorEmail: params.actorEmail,
        action: "stripe_commercial_activation_initiated",
        reason: params.reason.trim(),
        executionRequirement: "STRIPE_REQUIRED",
        executionStatus: "pending",
        relatedConditionId: condition.id,
        beforeState: { status: condition.status, syncStatus: condition.syncStatus },
        afterState: {
          status: "pending_activation",
          syncStatus: "sync_pending",
          planId: targetPlan.id,
          billingInterval: interval,
          catalogPriceCents: resolvedCatalog.catalogPriceCents,
          effectivePriceCents,
          prorationMode: params.prorationMode,
        },
      },
      tx,
    );
  });

  // --------------------------------------------------------------------------
  // External Stripe Execution
  // --------------------------------------------------------------------------
  let stripePriceResult: { stripePriceId: string; isCustom: boolean };
  try {
    stripePriceResult = await resolveOrCreateStripePrice({
      condition,
      targetPlan,
      interval,
      effectivePriceCents,
      catalogPriceCents: resolvedCatalog.catalogPriceCents,
      crecheId: params.crecheId,
      stripeClient: stripe,
      dbClient,
    });

    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    const subscriptionItem = identifySubscriptionItem(stripeSub, targetPlan.stripeProductId);

    // Crash recovery check: if subscription item already points to target price, skip update
    if (subscriptionItem.price?.id !== stripePriceResult.stripePriceId) {
      const subUpdateIdempotencyKey = `commercial:${condition.id}:update-sub-item`;
      await stripe.subscriptions.update(
        sub.stripeSubscriptionId,
        {
          items: [
            {
              id: subscriptionItem.id,
              price: stripePriceResult.stripePriceId,
            },
          ],
          proration_behavior: prorationBehavior,
          metadata: {
            crecheId: String(params.crecheId),
            conditionId: String(condition.id),
          },
        },
        {
          idempotencyKey: subUpdateIdempotencyKey,
        },
      );
    }
  } catch (stripeErr: any) {
    // Failure Transition (Section 19, 22)
    const errorMsg = stripeErr.message || "Erro desconhecido ao comunicar com Stripe.";
    await dbClient.transaction(async (tx: any) => {
      await tx
        .update(customerCommercialConditionsTable)
        .set({
          status: "activation_failed",
          syncStatus: "sync_failed",
          lastSyncError: errorMsg,
          updatedAt: new Date(),
        })
        .where(eq(customerCommercialConditionsTable.id, condition.id));

      await logCommercialAudit(
        {
          targetCrecheId: params.crecheId,
          actorType: "user",
          actorId: params.actorId,
          actorRole: "master_admin",
          actorEmail: params.actorEmail,
          action: "stripe_commercial_activation_failed",
          reason: params.reason.trim(),
          executionRequirement: "STRIPE_REQUIRED",
          executionStatus: "failed",
          relatedConditionId: condition.id,
          afterState: {
            status: "activation_failed",
            syncStatus: "sync_failed",
            lastSyncError: errorMsg,
          },
        },
        tx,
      );
    });

    throw new CommercialActivationError(
      "STRIPE_EXECUTION_FAILED",
      `Falha na ativação junto ao Stripe: ${errorMsg}`,
      502,
    );
  }

  // --------------------------------------------------------------------------
  // DB Transaction 2 (Post-Stripe Success Transition)
  // --------------------------------------------------------------------------
  let updatedCondition: CustomerCommercialCondition;
  let updatedSubscription: Subscription;

  await dbClient.transaction(async (tx: any) => {
    // 1. Find and supersede previous active condition
    const [currentActive] = await tx
      .select()
      .from(customerCommercialConditionsTable)
      .where(
        and(
          eq(customerCommercialConditionsTable.crecheId, params.crecheId),
          eq(customerCommercialConditionsTable.status, "active"),
        ),
      )
      .limit(1);

    const now = new Date();

    if (currentActive && currentActive.id !== condition.id) {
      await tx
        .update(customerCommercialConditionsTable)
        .set({ status: "superseded", updatedAt: now })
        .where(eq(customerCommercialConditionsTable.id, currentActive.id));
    }

    // 2. Activate target condition
    const [activated] = await tx
      .update(customerCommercialConditionsTable)
      .set({
        status: "active",
        syncStatus: "synced",
        stripePriceId: stripePriceResult.stripePriceId,
        predecessorId: currentActive?.id ?? condition.predecessorId ?? null,
        snapshotBillingInterval: interval,
        snapshotBasePriceCents: resolvedCatalog.catalogPriceCents,
        lastSyncError: null,
        validFrom: now,
        updatedAt: now,
      })
      .where(eq(customerCommercialConditionsTable.id, condition.id))
      .returning();

    updatedCondition = activated;

    // 3. Update subscription pointer
    const [subUpdated] = await tx
      .update(subscriptionsTable)
      .set({
        activeConditionId: condition.id,
        planId: targetPlan.id,
        billingInterval: interval,
      })
      .where(eq(subscriptionsTable.id, sub.id))
      .returning();

    updatedSubscription = subUpdated;

    // 4. Audit success
    await logCommercialAudit(
      {
        targetCrecheId: params.crecheId,
        actorType: "user",
        actorId: params.actorId,
        actorRole: "master_admin",
        actorEmail: params.actorEmail,
        action: "stripe_commercial_activation_completed",
        reason: params.reason.trim(),
        executionRequirement: "STRIPE_REQUIRED",
        executionStatus: "success",
        relatedConditionId: condition.id,
        afterState: {
          status: "active",
          syncStatus: "synced",
          stripePriceId: stripePriceResult.stripePriceId,
          effectivePriceCents,
          catalogPriceCents: resolvedCatalog.catalogPriceCents,
        },
      },
      tx,
    );
  });

  return {
    success: true,
    condition: updatedCondition!,
    subscription: updatedSubscription!,
    stripePriceId: stripePriceResult.stripePriceId,
    isCustomPrice: stripePriceResult.isCustom,
    effectivePriceCents,
    catalogPriceCents: resolvedCatalog.catalogPriceCents,
    message: "Condição comercial ativada no Stripe e sincronizada com sucesso.",
  };
}

/**
 * Retries activation for a condition in activation_failed or pending_activation state.
 */
export async function retryStripeCommercialActivation(params: {
  crecheId: number;
  conditionId: number;
  reason: string;
  idempotencyKey: string;
  prorationMode?: ActivationTimingMode;
  actorId?: number;
  actorEmail?: string;
  dbClient?: any;
  stripeClient?: Stripe;
}): Promise<CommercialActivationResult> {
  const mode = params.prorationMode ?? ACTIVATION_TIMING_MODES.EFFECTIVE_NOW_PRORATE;
  return executeStripeCommercialActivation({
    ...params,
    prorationMode: mode,
  });
}

/**
 * Administratively abandons a condition in activation_failed or draft state.
 */
export async function abandonCommercialCondition(params: {
  crecheId: number;
  conditionId: number;
  reason: string;
  actorId?: number;
  actorEmail?: string;
  dbClient?: any;
}): Promise<{ success: boolean; condition: CustomerCommercialCondition }> {
  const dbClient = params.dbClient ?? db;

  if (!params.reason || typeof params.reason !== "string" || params.reason.trim().length === 0) {
    throw new CommercialActivationError(
      "REASON_REQUIRED",
      "Justificativa obrigatória para abandono de proposta comercial.",
      400,
    );
  }

  const [condition] = await dbClient
    .select()
    .from(customerCommercialConditionsTable)
    .where(
      and(
        eq(customerCommercialConditionsTable.id, params.conditionId),
        eq(customerCommercialConditionsTable.crecheId, params.crecheId),
      ),
    )
    .limit(1);

  if (!condition) {
    throw new CommercialActivationError(
      "CONDITION_NOT_FOUND",
      `Proposta comercial #${params.conditionId} não encontrada.`,
      404,
    );
  }

  if (condition.status !== "draft" && condition.status !== "activation_failed") {
    throw new CommercialActivationError(
      "INVALID_STATUS_FOR_ABANDON",
      `Apenas propostas em rascunho ou com falha podem ser abandonadas. Status atual: '${condition.status}'.`,
      422,
    );
  }

  const [abandoned] = await dbClient
    .update(customerCommercialConditionsTable)
    .set({
      status: "abandoned",
      syncStatus: "sync_failed",
      updatedAt: new Date(),
    })
    .where(eq(customerCommercialConditionsTable.id, params.conditionId))
    .returning();

  await logCommercialAudit({
    targetCrecheId: params.crecheId,
    actorType: "user",
    actorId: params.actorId,
    actorRole: "master_admin",
    actorEmail: params.actorEmail,
    action: "commercial_condition_abandoned",
    reason: params.reason.trim(),
    relatedConditionId: params.conditionId,
    afterState: { status: "abandoned", syncStatus: "sync_failed" },
  });

  return { success: true, condition: abandoned };
}
