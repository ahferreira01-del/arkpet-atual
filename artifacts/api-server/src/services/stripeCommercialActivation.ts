import Stripe from "stripe";
import { db, BILLING_INTERVALS, stripeRecurringFor, type BillingInterval } from "@workspace/db";
import {
  customerCommercialConditionsTable,
  subscriptionsTable,
  plansTable,
  planPricesTable,
  commercialOperationRequestsTable,
  type CustomerCommercialCondition,
  type Subscription,
  type Plan,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { calculateEffectivePrice } from "./pricingEngine.js";
import { resolveCatalogPlanPrice, normalizeBillingInterval, CatalogPriceResolutionError } from "./catalogPricing.js";
import { logCommercialAudit } from "./commercialAudit.js";
import { getUncachableStripeClient } from "../lib/stripeClient.js";
import {
  CommercialOperationFencingLostError,
  renewCommercialOperationLease,
  type CommercialFencingToken,
} from "./commercialOperationRequests.js";

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
 * Validates logical cadence equivalence between ArkPet billingInterval and Stripe recurring config.
 * Fails closed if cadence does not match.
 */
export function validateCadenceEquivalence(
  interval: BillingInterval,
  recurring?: Stripe.Price.Recurring | null,
): { interval: "month" | "year"; interval_count: number } {
  if (!recurring || !recurring.interval) {
    throw new CommercialActivationError(
      "CADENCE_MISMATCH",
      `Preço do Stripe não é recorrente, mas o intervalo '${interval}' requer recorrência.`,
      422,
    );
  }

  const count = recurring.interval_count ?? 1;
  const stripeInt = recurring.interval;

  let isValid = false;
  switch (interval) {
    case "month":
      isValid = stripeInt === "month" && count === 1;
      break;
    case "quarter":
      isValid = stripeInt === "month" && count === 3;
      break;
    case "semester":
      isValid = stripeInt === "month" && count === 6;
      break;
    case "year":
      isValid = (stripeInt === "year" && count === 1) || (stripeInt === "month" && count === 12);
      break;
    default:
      isValid = false;
  }

  if (!isValid) {
    throw new CommercialActivationError(
      "CADENCE_MISMATCH",
      `Cadência do Stripe (${stripeInt} x${count}) não corresponde ao intervalo contratual do ArkPet '${interval}'.`,
      422,
    );
  }

  return { interval: stripeInt as "month" | "year", interval_count: count };
}

/**
 * Resolves the authoritative standard Stripe Price for a plan and billing interval,
 * retrieving it from Stripe and strictly validating cadence equivalence.
 */
export async function resolveStandardStripePrice(params: {
  targetPlan: Plan;
  interval: BillingInterval;
  standardPriceId?: string | null;
  stripeClient: Stripe;
  dbClient?: any;
}): Promise<{
  standardPriceId: string;
  standardPrice: Stripe.Price;
  cadence: { interval: "month" | "year"; interval_count: number };
}> {
  const dbClient = params.dbClient ?? db;

  let standardPriceId = params.standardPriceId;
  if (!standardPriceId) {
    if (typeof dbClient?.select === "function") {
      try {
        const rows = await dbClient
          .select({ stripePriceId: planPricesTable.stripePriceId })
          .from(planPricesTable)
          .where(and(eq(planPricesTable.planId, params.targetPlan.id), eq(planPricesTable.interval, params.interval)))
          .limit(1);
        if (Array.isArray(rows) && rows.length > 0) {
          standardPriceId = rows[0]?.stripePriceId;
        }
      } catch {
        // Fallback if dbClient mock chain was not set
      }
    }
  }

  // Strict interval resolution: only fall back to plansTable.stripePriceId if interval is 'month'
  if (!standardPriceId && params.interval === "month") {
    standardPriceId = params.targetPlan.stripePriceId;
  }

  if (!standardPriceId) {
    throw new CommercialActivationError(
      "STANDARD_STRIPE_PRICE_MISSING",
      `Preço padrão do Stripe não configurado para o plano '${params.targetPlan.name}' no período '${params.interval}'.`,
      422,
    );
  }

  let standardPrice: Stripe.Price;
  try {
    standardPrice = await params.stripeClient.prices.retrieve(standardPriceId);
  } catch (err: any) {
    throw new CommercialActivationError(
      "STANDARD_STRIPE_PRICE_RETRIEVAL_FAILED",
      `Falha ao consultar preço padrão '${standardPriceId}' no Stripe: ${err.message}`,
      422,
    );
  }

  const cadence = validateCadenceEquivalence(params.interval, standardPrice?.recurring);

  return { standardPriceId, standardPrice, cadence };
}

/**
 * Canonical metadata parser for commercial Stripe Prices.
 * Supports both canonical vocabulary ('fixed_amount', 'percentage') and legacy aliases.
 */
export function parseCommercialMetadata(metadata?: Stripe.Metadata | null): {
  crecheId?: number;
  conditionId?: number;
  planId?: number;
  overrideType?: "fixed_amount" | "percentage";
  billingInterval?: BillingInterval;
  effectiveAmountCents?: number;
} {
  if (!metadata) return {};
  let overrideType: "fixed_amount" | "percentage" | undefined;
  if (metadata.overrideType === "fixed_amount" || metadata.overrideType === "fixed_price") {
    overrideType = "fixed_amount";
  } else if (metadata.overrideType === "percentage" || metadata.overrideType === "percentage_discount") {
    overrideType = "percentage";
  }
  return {
    crecheId: metadata.crecheId ? Number(metadata.crecheId) : undefined,
    conditionId: metadata.conditionId ? Number(metadata.conditionId) : undefined,
    planId: metadata.planId ? Number(metadata.planId) : undefined,
    overrideType,
    billingInterval: metadata.billingInterval as BillingInterval | undefined,
    effectiveAmountCents: metadata.effectiveAmountCents ? Number(metadata.effectiveAmountCents) : undefined,
  };
}

/**
 * Resolves standard Stripe Price ID or creates an agreement/condition-scoped custom Stripe Price.
 * Clones the verified cadence of the standard Stripe Price.
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
  standardPriceId?: string | null;
  customStepKey?: string;
}): Promise<{ stripePriceId: string; isCustom: boolean }> {
  // 1. Custom Price: reuse if already generated on this condition (e.g. during a retry)
  if (params.condition.stripePriceId) {
    return { stripePriceId: params.condition.stripePriceId, isCustom: true };
  }

  const dbClient = params.dbClient ?? db;

  // 2. Authoritative standard Stripe Price resolution and cadence validation
  const { standardPriceId, standardPrice, cadence } = await resolveStandardStripePrice({
    targetPlan: params.targetPlan,
    interval: params.interval,
    standardPriceId: params.standardPriceId,
    stripeClient: params.stripeClient,
    dbClient,
  });

  const isStandardPrice =
    params.condition.pricingOverrideType === "none" ||
    params.effectivePriceCents === params.catalogPriceCents;

  if (isStandardPrice) {
    return { stripePriceId: standardPriceId, isCustom: false };
  }


  // 3. Resolve product ID from standard price or targetPlan
  const resolvedProductId =
    typeof standardPrice.product === "string"
      ? standardPrice.product
      : (standardPrice.product as any)?.id ?? params.targetPlan.stripeProductId;

  if (!resolvedProductId) {
    throw new CommercialActivationError(
      "MISSING_STRIPE_PRODUCT_ID",
      `ID do Produto Stripe não encontrado para o plano '${params.targetPlan.name}'.`,
      422,
    );
  }

  // 4. Create custom Price with deterministic step idempotency key
  const stepIdempotencyKey =
    params.customStepKey ?? `commercial:${params.condition.id}:create-custom-price`;

  const canonicalOverrideType =
    params.condition.pricingOverrideType === "fixed_amount" ? "fixed_amount" : "percentage";

  const createdPrice = await params.stripeClient.prices.create(
    {
      currency: standardPrice.currency || "brl",
      unit_amount: params.effectivePriceCents,
      recurring: {
        interval: cadence.interval,
        interval_count: cadence.interval_count,
      },
      product: resolvedProductId,
      metadata: {
        crecheId: String(params.crecheId),
        conditionId: String(params.condition.id),
        agreementId: params.condition.agreementId ? String(params.condition.agreementId) : "",
        planId: String(params.targetPlan.id),
        billingInterval: params.interval,
        overrideType: canonicalOverrideType,
        overrideValue: params.condition.pricingOverrideValue != null ? String(params.condition.pricingOverrideValue) : "",
        effectiveAmountCents: String(params.effectivePriceCents),
        scope: "agreement_scoped_commercial",
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

/**
 * Bounded Master Admin percentage repricing action.
 * Recalculates expected price for active percentage condition against current catalog,
 * creates an agreement-scoped custom Stripe Price with cloned cadence, updates subscription item,
 * and synchronizes condition state.
 */
export async function executePercentageReprice(params: {
  crecheId: number;
  conditionId: number;
  reason: string;
  actorId?: number;
  actorEmail?: string;
  dbClient?: any;
  stripeClient?: Stripe;
  fencingToken?: CommercialFencingToken;
}): Promise<{
  success: boolean;
  condition: CustomerCommercialCondition;
  newStripePriceId: string;
  expectedEffectivePriceCents: number;
  catalogPriceCents: number;
  message: string;
}> {
  const dbClient = params.dbClient ?? db;
  const stripe = params.stripeClient ?? (await getUncachableStripeClient());

  if (!params.reason || typeof params.reason !== "string" || params.reason.trim().length === 0) {
    throw new CommercialActivationError(
      "REASON_REQUIRED",
      "Justificativa obrigatória para reconciliação/reprecificação do Stripe.",
      400,
    );
  }

  // 1. Fetch condition and creche subscription
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
    throw new CommercialActivationError("CONDITION_NOT_FOUND", "Condição comercial não encontrada.", 404);
  }

  if (condition.status !== "active") {
    throw new CommercialActivationError(
      "INVALID_CONDITION_STATUS",
      `Apenas condições ativas podem ser reprecificadas no Stripe (status atual: '${condition.status}').`,
      422,
    );
  }

  if (condition.pricingOverrideType !== "percentage") {
    throw new CommercialActivationError(
      "NOT_PERCENTAGE_CONDITION",
      "Apenas condições com precificação percentual sofrem reprecificação dinâmica por mudança de catálogo.",
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
      "A creche não possui assinatura recorrente vinculada no Stripe.",
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
    throw new CommercialActivationError("PLAN_NOT_FOUND", `Plano #${targetPlanId} não encontrado.`, 404);
  }

  const interval: BillingInterval =
    (condition.snapshotBillingInterval ? normalizeBillingInterval(condition.snapshotBillingInterval) : null) ??
    (sub.billingInterval ? normalizeBillingInterval(sub.billingInterval) : null) ??
    "month";

  // Re-resolve current catalog price
  const resolvedCatalog = await resolveCatalogPlanPrice(targetPlan, interval, dbClient);

  // Recalculate effective price for percentage condition
  const calculation = calculateEffectivePrice({
    catalogPriceCents: resolvedCatalog.catalogPriceCents,
    pricingOverrideType: "percentage",
    pricingOverrideValue: condition.pricingOverrideValue ?? 0,
  });
  const expectedEffectivePriceCents = calculation.finalEffectivePriceCents;

  // Resolve standard Stripe price and validate cadence
  const { standardPrice, cadence } = await resolveStandardStripePrice({
    targetPlan,
    interval,
    stripeClient: stripe,
    dbClient,
  });

  const resolvedProductId =
    typeof standardPrice.product === "string"
      ? standardPrice.product
      : (standardPrice.product as any)?.id ?? targetPlan.stripeProductId;

  // Deterministic amount-scoped step idempotency key (Section 10)
  const priceStepKey = `commercial:${condition.id}:reprice:${expectedEffectivePriceCents}`;
  const subItemStepKey = `commercial:${condition.id}:reprice-sub-item:${expectedEffectivePriceCents}`;

  // Optional lease renewal before external Stripe step (Section 3)
  if (params.fencingToken) {
    await renewCommercialOperationLease(params.fencingToken, dbClient);
  }

  // Create new custom Stripe price for the updated amount
  const newPrice = await stripe.prices.create(
    {
      currency: standardPrice.currency || "brl",
      unit_amount: expectedEffectivePriceCents,
      recurring: {
        interval: cadence.interval,
        interval_count: cadence.interval_count,
      },
      product: resolvedProductId,
      metadata: {
        crecheId: String(params.crecheId),
        conditionId: String(condition.id),
        planId: String(targetPlan.id),
        billingInterval: interval,
        overrideType: "percentage",
        overrideValue: String(condition.pricingOverrideValue ?? 0),
        effectiveAmountCents: String(expectedEffectivePriceCents),
        scope: "agreement_scoped_commercial",
        action: "percentage_reprice",
        environment: process.env.NODE_ENV ?? "development",
        custom: "true",
      },
    },
    { idempotencyKey: priceStepKey },
  );

  // Identify subscription item
  const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
  const subscriptionItem = identifySubscriptionItem(stripeSub, targetPlan.stripeProductId);

  // Update subscription item on Stripe
  await stripe.subscriptions.update(
    sub.stripeSubscriptionId,
    {
      items: [
        {
          id: subscriptionItem.id,
          price: newPrice.id,
        },
      ],
      proration_behavior: "always_invoice",
      metadata: {
        crecheId: String(params.crecheId),
        conditionId: String(condition.id),
      },
    },
    { idempotencyKey: subItemStepKey },
  );

  // Business finalization fencing check (Section 2)
  if (params.fencingToken) {
    const [fenced] = await dbClient
      .select({ id: commercialOperationRequestsTable.id })
      .from(commercialOperationRequestsTable)
      .where(
        and(
          eq(commercialOperationRequestsTable.id, params.fencingToken.operationRequestId),
          eq(commercialOperationRequestsTable.status, "PROCESSING"),
          eq(commercialOperationRequestsTable.attemptCount, params.fencingToken.claimedAttemptCount),
        ),
      )
      .limit(1);

    if (!fenced) {
      throw new CommercialOperationFencingLostError(
        "A posse do lease desta operação foi perdida antes da finalização no banco de dados.",
      );
    }
  }

  // Update condition row: store new stripePriceId, restore syncStatus: 'synced', record lastSynchronizedAmountCents
  // Crucial: preserve snapshotBasePriceCents as the historical baseline from draft creation time
  const [updatedCondition] = await dbClient
    .update(customerCommercialConditionsTable)
    .set({
      stripePriceId: newPrice.id,
      syncStatus: "synced",
      lastSynchronizedAmountCents: expectedEffectivePriceCents,
      lastSyncError: null,
      updatedAt: new Date(),
    })
    .where(eq(customerCommercialConditionsTable.id, condition.id))
    .returning();

  // Audit synchronization
  await logCommercialAudit({
    targetCrecheId: params.crecheId,
    actorType: "user",
    actorId: params.actorId,
    actorRole: "master_admin",
    actorEmail: params.actorEmail,
    action: "commercial_percentage_reprice_synchronized",
    reason: params.reason.trim(),
    executionRequirement: "STRIPE_REQUIRED",
    executionStatus: "success",
    relatedConditionId: condition.id,
    beforeState: {
      previousStripePriceId: condition.stripePriceId,
      previousSnapshotBasePriceCents: condition.snapshotBasePriceCents,
      syncStatus: condition.syncStatus,
    },
    afterState: {
      newStripePriceId: newPrice.id,
      expectedEffectivePriceCents,
      catalogPriceCents: resolvedCatalog.catalogPriceCents,
      syncStatus: "synced",
    },
  });

  return {
    success: true,
    condition: updatedCondition ?? condition,
    newStripePriceId: newPrice.id,
    expectedEffectivePriceCents,
    catalogPriceCents: resolvedCatalog.catalogPriceCents,
    message: "Precificação percentual sincronizada com sucesso no gateway Stripe.",
  };
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
  fencingToken?: CommercialFencingToken;
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

  // Cross-Command Replay Check (Section 10):
  // If target condition was already successfully activated and synchronized (e.g. by a subsequent retry key),
  // replaying an earlier key recognizes the already-applied target and performs zero duplicate business execution.
  if (condition.status === "active" && condition.syncStatus === "synced" && condition.stripePriceId) {
    const [sub] = await dbClient
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.crecheId, params.crecheId))
      .limit(1);

    const targetPlanId = condition.planId ?? sub?.planId;
    let targetPlan: Plan | undefined;
    if (targetPlanId) {
      const [tp] = await dbClient
        .select()
        .from(plansTable)
        .where(eq(plansTable.id, targetPlanId))
        .limit(1);
      targetPlan = tp;
    }

    const interval: BillingInterval =
      (condition.snapshotBillingInterval ? normalizeBillingInterval(condition.snapshotBillingInterval) : null) ??
      (sub?.billingInterval ? normalizeBillingInterval(sub.billingInterval) : null) ??
      "month";

    let resolvedCatalog: any = { catalogPriceCents: condition.snapshotBasePriceCents ?? 0, stripePriceId: condition.stripePriceId };
    if (targetPlan) {
      try {
        resolvedCatalog = await resolveCatalogPlanPrice(targetPlan, interval, dbClient);
      } catch {
        // Use condition snapshot
      }
    }

    const calculation = calculateEffectivePrice({
      catalogPriceCents: resolvedCatalog.catalogPriceCents,
      pricingOverrideType: (condition.pricingOverrideType as any) ?? "none",
      pricingOverrideValue: condition.pricingOverrideValue ?? null,
    });

    return {
      success: true,
      replay: true,
      condition,
      subscription: sub!,
      stripePriceId: condition.stripePriceId,
      isCustomPrice: condition.stripePriceId !== resolvedCatalog.stripePriceId,
      effectivePriceCents: calculation.finalEffectivePriceCents,
      catalogPriceCents: resolvedCatalog.catalogPriceCents,
      message: "Condição comercial já se encontra ativada e sincronizada com sucesso.",
    };
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
  if (params.fencingToken) {
    await renewCommercialOperationLease(params.fencingToken, dbClient);
  }

  let stripePriceResult: { stripePriceId: string; isCustom: boolean };
  try {
    stripePriceResult = await resolveOrCreateStripePrice({
      condition,
      targetPlan,
      interval,
      effectivePriceCents,
      catalogPriceCents: resolvedCatalog.catalogPriceCents,
      standardPriceId: resolvedCatalog.stripePriceId,
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
    // 0. Business finalization fencing check (Section 2):
    // Prove that the operation claimant still owns the current attempt generation
    // before applying condition state, subscription pointer, audit, and lastSynchronizedAmount.
    if (params.fencingToken) {
      const [fenced] = await tx
        .select({ id: commercialOperationRequestsTable.id })
        .from(commercialOperationRequestsTable)
        .where(
          and(
            eq(commercialOperationRequestsTable.id, params.fencingToken.operationRequestId),
            eq(commercialOperationRequestsTable.status, "PROCESSING"),
            eq(commercialOperationRequestsTable.attemptCount, params.fencingToken.claimedAttemptCount),
          ),
        )
        .limit(1);

      if (!fenced) {
        throw new CommercialOperationFencingLostError(
          "A posse do lease desta operação foi perdida antes da finalização dos registros de ativação no banco de dados.",
        );
      }
    }

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
        lastSynchronizedAmountCents: effectivePriceCents,
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
  fencingToken?: CommercialFencingToken;
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
