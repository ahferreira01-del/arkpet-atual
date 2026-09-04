import { Router, type Response } from "express";
import crypto from "crypto";
import { db, BILLING_INTERVALS, type BillingInterval } from "@workspace/db";
import {
  crechesTable,
  subscriptionsTable,
  plansTable,
  customerCommercialConditionsTable,
} from "@workspace/db/schema";
import { eq, and, or, desc } from "drizzle-orm";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate.js";
import { countActivePetsForCreche } from "../middlewares/checkPetLimit.js";
import {
  calculateEffectivePrice,
  PricingEngineError,
} from "../services/pricingEngine.js";
import {
  resolveActiveCommercialCondition,
  transitionActiveCondition,
  validatePricingOverride,
  assertConditionFullSnapshot,
  CommercialConditionIntegrityError,
} from "../services/commercialConditions.js";
import { logCommercialAudit, CommercialAuditError } from "../services/commercialAudit.js";
import {
  resolveCatalogPlanPrice,
  normalizeBillingInterval,
  CatalogPriceResolutionError,
  type ResolvedCatalogPlanPrice,
} from "../services/catalogPricing.js";
import {
  ACTIVATION_TIMING_MODES,
  type ActivationTimingMode,
  executeStripeCommercialActivation,
  retryStripeCommercialActivation,
  abandonCommercialCondition,
  executePercentageReprice,
  CommercialActivationError,
} from "../services/stripeCommercialActivation.js";
import {
  withCommercialOperationIdempotency,
  validateIdempotencyKey,
  computeRequestFingerprint,
  CommercialIdempotencyConflictError,
  CommercialOperationInProgressError,
  CommercialOperationFailedFinalError,
} from "../services/commercialOperationRequests.js";

export const COMMERCIAL_OPERATIONS = {
  PET_LIMIT_OVERRIDE: "PET_LIMIT_OVERRIDE",
  DRAFT_PRICE_CONDITION: "DRAFT_PRICE_CONDITION",
  ACTIVATE_PRICE_CONDITION: "ACTIVATE_PRICE_CONDITION",
  RETRY_PRICE_ACTIVATION: "RETRY_PRICE_ACTIVATION",
  ABANDON_PRICE_CONDITION: "ABANDON_PRICE_CONDITION",
  REPRICE_PERCENTAGE_CONDITION: "REPRICE_PERCENTAGE_CONDITION",
} as const;
export type CommercialOperation = (typeof COMMERCIAL_OPERATIONS)[keyof typeof COMMERCIAL_OPERATIONS];

export const commercialRouter = Router({ mergeParams: true });

commercialRouter.use(authenticate);
commercialRouter.use(requireRole("master_admin"));

/**
 * GET /api/creches/:crecheId/commercial/support
 * Authoritative read model for Master Admin Support Console.
 */
commercialRouter.get("/support", async (req: AuthRequest, res: Response): Promise<void> => {
  const crecheId = Number(req.params.crecheId);
  if (!crecheId || Number.isNaN(crecheId)) {
    res.status(400).json({ error: "Creche inválida." });
    return;
  }

  const [creche] = await db
    .select()
    .from(crechesTable)
    .where(eq(crechesTable.id, crecheId))
    .limit(1);

  if (!creche) {
    res.status(404).json({ error: "Creche não encontrada." });
    return;
  }

  const [sub] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.crecheId, crecheId))
    .limit(1);

  let plan = null;
  let resolvedCatalog: ResolvedCatalogPlanPrice | null = null;
  const interval: BillingInterval =
    (sub?.billingInterval ? normalizeBillingInterval(sub.billingInterval) : null) ?? "month";

  if (sub?.planId) {
    const [p] = await db.select().from(plansTable).where(eq(plansTable.id, sub.planId)).limit(1);
    plan = p ?? null;
    if (plan) {
      try {
        resolvedCatalog = await resolveCatalogPlanPrice(plan, interval, db);
      } catch (err: any) {
        if (err instanceof CatalogPriceResolutionError) {
          res.status(422).json({
            error: "catalog_price_missing",
            message: err.message,
          });
          return;
        }
        throw err;
      }
    }
  }

  const activePetCount = await countActivePetsForCreche(crecheId, db);

  let activeCondition = null;
  let conditionIntegrityError: string | null = null;

  if (sub?.activeConditionId) {
    try {
      activeCondition = await resolveActiveCommercialCondition(crecheId, sub.activeConditionId, db);
    } catch (err) {
      if (err instanceof CommercialConditionIntegrityError) {
        conditionIntegrityError = err.message;
      } else {
        throw err;
      }
    }
  }

  // Active pricing calculation
  let pricing = null;
  if (resolvedCatalog) {
    pricing = calculateEffectivePrice({
      catalogPriceCents: resolvedCatalog.catalogPriceCents,
      pricingOverrideType: (activeCondition?.pricingOverrideType as any) ?? "none",
      pricingOverrideValue: activeCondition?.pricingOverrideValue ?? null,
      validFrom: activeCondition?.validFrom ?? null,
      validUntil: activeCondition?.validUntil ?? null,
    });
  }

  // Effective pet limit calculation
  const effectivePetLimit = activeCondition?.entitlementPetLimit ?? plan?.petLimit ?? null;

  // Query latest proposal condition (draft, pending_activation, or activation_failed)
  const [latestDraft] = await db
    .select()
    .from(customerCommercialConditionsTable)
    .where(
      and(
        eq(customerCommercialConditionsTable.crecheId, crecheId),
        or(
          eq(customerCommercialConditionsTable.status, "draft"),
          eq(customerCommercialConditionsTable.status, "pending_activation"),
          eq(customerCommercialConditionsTable.status, "activation_failed"),
        ),
      ),
    )
    .orderBy(desc(customerCommercialConditionsTable.createdAt))
    .limit(1);

  let commercialStripeStatus: "SYNCHRONIZED" | "PENDING" | "FAILED" | "DIVERGENT" | null = null;
  let percentageRepriceNotice: {
    required: boolean;
    expectedEffectivePriceCents: number;
    actualStripeAmountCents: number;
    lastSynchronizedAmountCents: number | null;
    message: string;
  } | null = null;

  if (sub?.stripeSubscriptionId) {
    if (activeCondition?.syncStatus === "divergent" || latestDraft?.syncStatus === "divergent") {
      commercialStripeStatus = "DIVERGENT";
    } else if (latestDraft?.status === "pending_activation" || latestDraft?.syncStatus === "sync_pending") {
      commercialStripeStatus = "PENDING";
    } else if (latestDraft?.status === "activation_failed" || latestDraft?.syncStatus === "sync_failed") {
      commercialStripeStatus = "FAILED";
    } else {
      commercialStripeStatus = "SYNCHRONIZED";
    }

    // Section 8 & R36.E1.1: Check for percentage condition drift against last known-good synchronized Stripe amount
    if (activeCondition && activeCondition.pricingOverrideType === "percentage" && resolvedCatalog && pricing) {
      const expectedAmount = pricing.finalEffectivePriceCents;
      const lastSyncedAmount = activeCondition.lastSynchronizedAmountCents;

      if (lastSyncedAmount === null || lastSyncedAmount === undefined) {
        // Unknown / unconfirmed sync state: mark divergent (no fallback to historical snapshot)
        commercialStripeStatus = "DIVERGENT";
        percentageRepriceNotice = {
          required: true,
          expectedEffectivePriceCents: expectedAmount,
          actualStripeAmountCents: expectedAmount,
          lastSynchronizedAmountCents: null as any,
          message: "Estado de sincronização Stripe indefinido ou não confirmado.",
        };
      } else if (lastSyncedAmount !== expectedAmount || activeCondition.syncStatus === "divergent") {
        commercialStripeStatus = "DIVERGENT";
        percentageRepriceNotice = {
          required: true,
          expectedEffectivePriceCents: expectedAmount,
          actualStripeAmountCents: lastSyncedAmount,
          lastSynchronizedAmountCents: lastSyncedAmount,
          message: "Valor Stripe desatualizado. O catálogo foi alterado após a última sincronização desta condição percentual.",
        };
      }
    }
  }
  const canActivateStripe = Boolean(sub?.stripeSubscriptionId);

  let draftPricing = null;
  let statusNotice = "Ainda não aplicado / aguardando etapa Stripe";
  if (latestDraft) {
    if (latestDraft.status === "activation_failed") {
      statusNotice = latestDraft.lastSyncError
        ? `Falha na ativação: ${latestDraft.lastSyncError}`
        : "Falha na ativação junto ao gateway Stripe / aguardando nova tentativa ou abandono";
    } else if (latestDraft.status === "pending_activation") {
      statusNotice = "Ativação Stripe em processamento...";
    }

    const draftPlanId = latestDraft.planId ?? sub?.planId;
    const draftInterval: BillingInterval =
      (latestDraft.snapshotBillingInterval
        ? normalizeBillingInterval(latestDraft.snapshotBillingInterval)
        : null) ?? interval;

    if (draftPlanId) {
      try {
        const draftTarget = plan && draftPlanId === plan.id ? plan : draftPlanId;
        const draftResolved = await resolveCatalogPlanPrice(draftTarget, draftInterval, db);
        draftPricing = calculateEffectivePrice({
          catalogPriceCents: draftResolved.catalogPriceCents,
          pricingOverrideType: (latestDraft.pricingOverrideType as any) ?? "none",
          pricingOverrideValue: latestDraft.pricingOverrideValue ?? null,
          validFrom: latestDraft.validFrom ?? null,
          validUntil: latestDraft.validUntil ?? null,
        });
      } catch {
        // If draft catalog resolution fails (e.g. unconfigured plan), draftPricing remains null
      }
    }
  }

  res.json({
    creche: {
      id: creche.id,
      name: creche.name,
      email: creche.email,
      status: creche.status,
    },
    subscriptionState: sub ? "PROVISIONED" : "NOT_PROVISIONED",
    subscription: sub
      ? {
          id: sub.id,
          status: sub.status,
          planId: sub.planId,
          billingInterval: interval,
          currentPeriodEnd: sub.currentPeriodEnd,
          trialEndsAt: sub.trialEndsAt,
          hasStripeCustomer: Boolean(sub.stripeCustomerId),
          hasStripeSubscription: Boolean(sub.stripeSubscriptionId),
        }
      : null,
    plan: plan && resolvedCatalog
      ? {
          id: plan.id,
          name: plan.name,
          priceCents: resolvedCatalog.catalogPriceCents,
          petLimit: plan.petLimit,
          billingInterval: interval,
        }
      : null,
    activeCondition: activeCondition ?? null,
    conditionIntegrityError,
    pricing,
    limits: {
      activePetCount,
      effectivePetLimit,
      catalogPetLimit: plan?.petLimit ?? null,
      isCustomLimit: Boolean(activeCondition?.entitlementPetLimit),
    },
    draftCondition: latestDraft
      ? {
          condition: latestDraft,
          proposedPricing: draftPricing,
          statusNotice,
        }
      : null,
    commercialStripeStatus,
    percentageRepriceNotice,
    canActivateStripe,
  });
});

/**
 * POST /api/creches/:crecheId/commercial/preview-price
 * Pure simulation endpoint for pricing / limit overrides.
 */
commercialRouter.post("/preview-price", async (req: AuthRequest, res: Response): Promise<void> => {
  const crecheId = Number(req.params.crecheId);
  const { planId, pricingOverrideType, pricingOverrideValue, entitlementPetLimit, billingInterval: rawInterval } = req.body;

  let targetPlanId = planId ? Number(planId) : null;
  let interval: BillingInterval = "month";

  if (rawInterval !== undefined && rawInterval !== null) {
    const normalized = normalizeBillingInterval(rawInterval);
    if (!normalized) {
      res.status(400).json({
        error: "invalid_billing_interval",
        message: `Período de cobrança inválido '${rawInterval}'. Períodos suportados: ${BILLING_INTERVALS.join(", ")}.`,
      });
      return;
    }
    interval = normalized;
  }

  if (!targetPlanId) {
    const [sub] = await db
      .select({ planId: subscriptionsTable.planId, billingInterval: subscriptionsTable.billingInterval })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.crecheId, crecheId))
      .limit(1);

    targetPlanId = sub?.planId ?? null;
    if ((rawInterval === undefined || rawInterval === null) && sub?.billingInterval) {
      const normalizedSub = normalizeBillingInterval(sub.billingInterval);
      if (normalizedSub) {
        interval = normalizedSub;
      }
    }
  }

  if (!targetPlanId) {
    res.status(400).json({ error: "Plano alvo não especificado ou creche sem assinatura." });
    return;
  }

  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, targetPlanId)).limit(1);
  if (!plan) {
    res.status(404).json({ error: "Plano não encontrado." });
    return;
  }

  try {
    validatePricingOverride(pricingOverrideType, pricingOverrideValue);

    let resolvedCatalog: ResolvedCatalogPlanPrice;
    try {
      resolvedCatalog = await resolveCatalogPlanPrice(plan, interval, db);
    } catch (err: any) {
      if (err instanceof CatalogPriceResolutionError) {
        res.status(422).json({ error: "catalog_price_missing", message: err.message });
        return;
      }
      throw err;
    }

    const planPriceCents = resolvedCatalog.catalogPriceCents;

    const calculation = calculateEffectivePrice({
      catalogPriceCents: planPriceCents,
      pricingOverrideType: pricingOverrideType ?? "none",
      pricingOverrideValue: pricingOverrideValue ?? null,
    });

    const activePetCount = await countActivePetsForCreche(crecheId, db);
    const proposedPetLimit =
      typeof entitlementPetLimit === "number" && entitlementPetLimit > 0
        ? entitlementPetLimit
        : plan.petLimit;

    const discountPercentage =
      planPriceCents > 0
        ? Math.round((calculation.overrideDiscountCents / planPriceCents) * 10000) / 100
        : 0;

    res.json({
      billingInterval: interval,
      catalogPriceCents: planPriceCents,
      currentEffectivePriceCents: planPriceCents,
      proposedEffectivePriceCents: calculation.finalEffectivePriceCents,
      absoluteDifferenceCents: calculation.overrideDiscountCents,
      discountPercentage,
      appliedOverrideType: calculation.appliedOverrideType,
      currentPetLimit: plan.petLimit,
      proposedPetLimit,
      activePetCount,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/creches/:crecheId/commercial/pet-limit-override
 * ARKPET_ONLY activation for customer-specific pet limit.
 */
commercialRouter.post("/pet-limit-override", async (req: AuthRequest, res: Response): Promise<void> => {
  const crecheId = Number(req.params.crecheId);
  const { entitlementPetLimit, reason, confirmLowering } = req.body;

  let idempotencyKey: string;
  try {
    idempotencyKey = validateIdempotencyKey(req.header("X-Idempotency-Key"));
  } catch (err: any) {
    res.status(400).json({ error: "idempotency_key_invalid", message: err.message });
    return;
  }

  if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
    res.status(400).json({
      error: "reason_required",
      message: "Justificativa obrigatória para alteração de limite de pets por administrador master.",
    });
    return;
  }

  if (
    typeof entitlementPetLimit !== "number" ||
    !Number.isInteger(entitlementPetLimit) ||
    entitlementPetLimit <= 0
  ) {
    res.status(400).json({
      error: "invalid_pet_limit",
      message: "O novo limite de pets deve ser um número inteiro positivo.",
    });
    return;
  }

  const [creche] = await db.select().from(crechesTable).where(eq(crechesTable.id, crecheId)).limit(1);
  if (!creche) {
    res.status(404).json({ error: "Creche não encontrada." });
    return;
  }

  const [sub] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.crecheId, crecheId))
    .limit(1);

  const activePetCount = await countActivePetsForCreche(crecheId, db);

  // Pre-claim confirmation check (Correction #5 & #6):
  // If confirmation is required, return HTTP 409 WITHOUT claiming commercial_operation_requests (zero mutation)
  if (entitlementPetLimit < activePetCount && confirmLowering !== true) {
    res.status(409).json({
      error: "active_pets_exceed_limit",
      confirmationRequired: true,
      activePetCount,
      requestedLimit: entitlementPetLimit,
      message: `O limite solicitado (${entitlementPetLimit}) é inferior ao total atual de pets ativos (${activePetCount}). Confirmação explícita necessária para prosseguir.`,
    });
    return;
  }

  const operation = COMMERCIAL_OPERATIONS.PET_LIMIT_OVERRIDE;
  const payload = {
    crecheId,
    operation,
    entitlementPetLimit,
    reason: reason.trim(),
  };

  try {
    const result = await withCommercialOperationIdempotency({
      crecheId,
      operation,
      idempotencyKey,
      payload,
      resourceType: "customer_commercial_condition",
      isDbOnly: true,
      execute: async (tx) => {
        // Fetch current active condition (if any) to create full successor snapshot
        let currentActive = null;
        if (sub?.activeConditionId) {
          currentActive = await resolveActiveCommercialCondition(crecheId, sub.activeConditionId, tx);
        }

        const successorPlanId = currentActive?.planId ?? sub?.planId ?? null;
        const currentInterval: BillingInterval =
          sub?.billingInterval && BILLING_INTERVALS.includes(sub.billingInterval as BillingInterval)
            ? (sub.billingInterval as BillingInterval)
            : "month";

        const snapshotBillingInterval = currentActive?.snapshotBillingInterval ?? currentInterval;
        const snapshotBasePriceCents = currentActive?.snapshotBasePriceCents ?? null;

        const successorSnapshot = {
          crecheId,
          planId: successorPlanId,
          pricingOverrideType: currentActive?.pricingOverrideType ?? "none",
          pricingOverrideValue: currentActive?.pricingOverrideValue ?? null,
          entitlementPetLimit,
          snapshotBillingInterval: currentInterval,
          snapshotBasePriceCents,
          lastSynchronizedAmountCents: currentActive?.lastSynchronizedAmountCents ?? null,
          validFrom: new Date(),
          validUntil: currentActive?.validUntil ?? null,
          status: "draft", // created as draft, then atomically activated
          executionRequirement: "ARKPET_ONLY",
          syncStatus: "synced", // ARKPET_ONLY changes require zero Stripe calls
          reason: reason.trim(),
          idempotencyKey,
          idempotencyOperation: operation,
          requestFingerprint: computeRequestFingerprint(payload),
        };

        assertConditionFullSnapshot(successorSnapshot as any);

        const [inserted] = await tx
          .insert(customerCommercialConditionsTable)
          .values(successorSnapshot as any)
          .returning();

        const transitionResult = await transitionActiveCondition(crecheId, inserted.id, tx);

        const [activatedCondition] = await tx
          .select()
          .from(customerCommercialConditionsTable)
          .where(eq(customerCommercialConditionsTable.id, inserted.id))
          .limit(1);

        await logCommercialAudit(
          {
            targetCrecheId: crecheId,
            actorType: "user",
            actorId: req.user?.id,
            actorRole: req.user?.role,
            actorEmail: req.user?.email,
            action: "pet_limit_override",
            reason: reason.trim(),
            requiresReason: true,
            beforeState: {
              petLimit: currentActive?.entitlementPetLimit ?? null,
              conditionId: currentActive?.id ?? null,
            },
            afterState: {
              petLimit: entitlementPetLimit,
              conditionId: inserted.id,
            },
            executionRequirement: "ARKPET_ONLY",
            executionStatus: "SUCCESS",
            relatedConditionId: inserted.id,
          },
          tx,
        );

        return {
          statusCode: 201,
          data: {
            success: true,
            condition: activatedCondition,
            previousConditionId: transitionResult.previousConditionId,
            message: `Limite de pets ajustado para ${entitlementPetLimit} com sucesso.`,
          },
          resourceId: activatedCondition.id,
        };
      },
    });

    res.status(result.statusCode).json({
      ...result.data,
      ...(result.replayed ? { replay: true } : {}),
    });
  } catch (err: any) {
    if (
      err instanceof CommercialIdempotencyConflictError ||
      err instanceof CommercialOperationInProgressError ||
      err instanceof CommercialOperationFailedFinalError
    ) {
      res.status(err.statusCode).json({
        error: err.code === "IDEMPOTENCY_CONFLICT" ? "idempotency_conflict" : err.code,
        code: err.code,
        message: err.message,
      });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR", message: err.message || "Erro interno." });
  }
});

/**
 * POST /api/creches/:crecheId/commercial/draft-condition
 * Prepares and saves a commercial condition draft without activating recurring billing.
 */
commercialRouter.post("/draft-condition", async (req: AuthRequest, res: Response): Promise<void> => {
  const crecheId = Number(req.params.crecheId);
  const { planId, pricingOverrideType, pricingOverrideValue, entitlementPetLimit, reason, billingInterval: rawInterval } = req.body;

  let idempotencyKey: string;
  try {
    idempotencyKey = validateIdempotencyKey(req.header("X-Idempotency-Key"));
  } catch (err: any) {
    res.status(400).json({ error: "idempotency_key_invalid", message: err.message });
    return;
  }

  if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
    res.status(400).json({
      error: "reason_required",
      message: "Justificativa obrigatória para criação de proposta comercial.",
    });
    return;
  }

  const [creche] = await db.select().from(crechesTable).where(eq(crechesTable.id, crecheId)).limit(1);
  if (!creche) {
    res.status(404).json({ error: "Creche não encontrada." });
    return;
  }

  const [sub] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.crecheId, crecheId))
    .limit(1);

  const targetPlanId = planId ? Number(planId) : sub?.planId ?? null;

  try {
    validatePricingOverride(pricingOverrideType, pricingOverrideValue);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
    return;
  }

  if (
    entitlementPetLimit !== undefined &&
    entitlementPetLimit !== null &&
    (!Number.isInteger(entitlementPetLimit) || entitlementPetLimit <= 0)
  ) {
    res.status(400).json({ error: "entitlementPetLimit deve ser um número inteiro positivo." });
    return;
  }

  let draftInterval: BillingInterval = "month";
  if (rawInterval !== undefined && rawInterval !== null) {
    const normalized = normalizeBillingInterval(rawInterval);
    if (!normalized) {
      res.status(400).json({
        error: "invalid_billing_interval",
        message: `Período de cobrança inválido '${rawInterval}'. Períodos suportados: ${BILLING_INTERVALS.join(", ")}.`,
      });
      return;
    }
    draftInterval = normalized;
  } else if (sub?.billingInterval) {
    const normalizedSub = normalizeBillingInterval(sub.billingInterval);
    if (normalizedSub) {
      draftInterval = normalizedSub;
    }
  }

  const operation = COMMERCIAL_OPERATIONS.DRAFT_PRICE_CONDITION;
  const payload = {
    crecheId,
    operation,
    targetPlanId,
    pricingOverrideType,
    pricingOverrideValue,
    entitlementPetLimit: entitlementPetLimit ?? null,
    reason: reason.trim(),
    ...(rawInterval ? { billingInterval: rawInterval } : {}),
  };

  try {
    const result = await withCommercialOperationIdempotency({
      crecheId,
      operation,
      idempotencyKey,
      payload,
      resourceType: "customer_commercial_condition",
      isDbOnly: true,
      execute: async (tx) => {
        // Resolve authoritative catalog price for snapshotting
        let resolvedCatalog: ResolvedCatalogPlanPrice | null = null;
        if (targetPlanId) {
          resolvedCatalog = await resolveCatalogPlanPrice(targetPlanId, draftInterval, tx);
        }

        // Determine executionRequirement: if pricing override is set, Stripe synchronization is required
        const hasPricingOverride = pricingOverrideType && pricingOverrideType !== "none";
        const executionRequirement = hasPricingOverride ? "STRIPE_REQUIRED" : "ARKPET_ONLY";
        const syncStatus = hasPricingOverride ? "not_started" : "synced";

        const draftCondition = {
          crecheId,
          planId: targetPlanId,
          pricingOverrideType: pricingOverrideType ?? "none",
          pricingOverrideValue: pricingOverrideValue ?? null,
          entitlementPetLimit: entitlementPetLimit ?? null,
          snapshotBillingInterval: draftInterval,
          snapshotBasePriceCents: resolvedCatalog?.catalogPriceCents ?? null,
          lastSynchronizedAmountCents: null,
          validFrom: new Date(),
          status: "draft",
          executionRequirement,
          syncStatus,
          reason: reason.trim(),
          idempotencyKey,
          idempotencyOperation: operation,
          requestFingerprint: computeRequestFingerprint(payload),
        };

        assertConditionFullSnapshot(draftCondition as any);

        const [row] = await tx
          .insert(customerCommercialConditionsTable)
          .values(draftCondition as any)
          .returning();

        await logCommercialAudit(
          {
            targetCrecheId: crecheId,
            actorType: "user",
            actorId: req.user?.id,
            actorRole: req.user?.role,
            actorEmail: req.user?.email,
            action: "commercial_condition_draft_created",
            reason: reason.trim(),
            requiresReason: true,
            afterState: {
              conditionId: row.id,
              pricingOverrideType: row.pricingOverrideType,
              pricingOverrideValue: row.pricingOverrideValue,
              entitlementPetLimit: row.entitlementPetLimit,
              status: "draft",
            },
            executionRequirement,
            executionStatus: "SUCCESS",
            relatedConditionId: row.id,
          },
          tx,
        );

        return {
          statusCode: 201,
          data: {
            success: true,
            condition: row,
            message:
              "Rascunho comercial salvo com sucesso. A alteração de cobrança será aplicada após a etapa de sincronização com o Stripe.",
          },
          resourceId: row.id,
        };
      },
    });

    res.status(result.statusCode).json({
      ...result.data,
      ...(result.replayed ? { replay: true } : {}),
    });
  } catch (err: any) {
    if (
      err instanceof CommercialIdempotencyConflictError ||
      err instanceof CommercialOperationInProgressError ||
      err instanceof CommercialOperationFailedFinalError
    ) {
      res.status(err.statusCode).json({
        error: err.code === "IDEMPOTENCY_CONFLICT" ? "idempotency_conflict" : err.code,
        code: err.code,
        message: err.message,
      });
      return;
    }
    if (err instanceof CatalogPriceResolutionError) {
      res.status(422).json({ error: "catalog_price_missing", message: err.message });
      return;
    }
    res.status(500).json({ error: "INTERNAL_ERROR", message: err.message || "Erro interno." });
  }
});

/**
 * POST /api/creches/:crecheId/commercial/activate-condition
 * Two-phase commercial activation of a draft condition against Stripe.
 */
commercialRouter.post("/activate-condition", async (req: AuthRequest, res: Response): Promise<void> => {
  const crecheId = Number(req.params.crecheId);
  const { conditionId, prorationMode, reason } = req.body;

  let idempotencyKey: string;
  try {
    idempotencyKey = validateIdempotencyKey(req.header("X-Idempotency-Key"));
  } catch (err: any) {
    res.status(400).json({ error: "idempotency_key_invalid", message: err.message });
    return;
  }

  if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
    res.status(400).json({
      error: "reason_required",
      message: "Justificativa obrigatória para ativação comercial no Stripe.",
    });
    return;
  }

  const parsedConditionId = Number(conditionId);
  if (!parsedConditionId || !Number.isInteger(parsedConditionId) || parsedConditionId <= 0) {
    res.status(400).json({
      error: "invalid_condition_id",
      message: "ID da proposta comercial inválido.",
    });
    return;
  }

  const selectedProrationMode: ActivationTimingMode =
    prorationMode ?? ACTIVATION_TIMING_MODES.EFFECTIVE_NOW_PRORATE;
  if (
    selectedProrationMode !== ACTIVATION_TIMING_MODES.EFFECTIVE_NOW_PRORATE &&
    selectedProrationMode !== ACTIVATION_TIMING_MODES.EFFECTIVE_NOW_NO_PRORATION
  ) {
    res.status(400).json({
      error: "invalid_proration_mode",
      message: `Modo de rateio '${prorationMode}' inválido. Modos suportados: ${Object.values(ACTIVATION_TIMING_MODES).join(", ")}.`,
    });
    return;
  }

  const operation = COMMERCIAL_OPERATIONS.ACTIVATE_PRICE_CONDITION;
  const payload = {
    crecheId,
    operation,
    conditionId: parsedConditionId,
    prorationMode: selectedProrationMode,
    reason: reason.trim(),
  };

  try {
    const result = await withCommercialOperationIdempotency({
      crecheId,
      operation,
      idempotencyKey,
      payload,
      resourceType: "customer_commercial_condition",
      resourceId: parsedConditionId,
      isDbOnly: false,
      execute: async () => {
        const activationResult = await executeStripeCommercialActivation({
          crecheId,
          conditionId: parsedConditionId,
          prorationMode: selectedProrationMode,
          reason: reason.trim(),
          idempotencyKey,
          requestFingerprint: computeRequestFingerprint(payload),
          actorId: req.user?.id,
          actorEmail: req.user?.email,
        });
        return {
          statusCode: 200,
          data: activationResult,
          resourceId: parsedConditionId,
        };
      },
    });

    res.status(result.statusCode).json({
      ...result.data,
      ...(result.replayed ? { replay: true } : {}),
    });
  } catch (err: any) {
    if (
      err instanceof CommercialIdempotencyConflictError ||
      err instanceof CommercialOperationInProgressError ||
      err instanceof CommercialOperationFailedFinalError
    ) {
      res.status(err.statusCode).json({
        error: err.code === "IDEMPOTENCY_CONFLICT" ? "idempotency_conflict" : err.code,
        code: err.code,
        message: err.message,
      });
      return;
    }
    if (err instanceof CommercialActivationError) {
      res.status(err.statusCode).json({
        error: err.code,
        code: err.code,
        message: err.message,
      });
      return;
    }
    res.status(500).json({
      error: "STRIPE_ACTIVATION_ERROR",
      message: err.message || "Erro inesperado ao ativar condição comercial no Stripe.",
    });
  }
});

/**
 * POST /api/creches/:crecheId/commercial/conditions/:conditionId/retry-activation
 * Retries a failed Stripe activation using the same logical parameters.
 */
commercialRouter.post(
  "/conditions/:conditionId/retry-activation",
  async (req: AuthRequest, res: Response): Promise<void> => {
    const crecheId = Number(req.params.crecheId);
    const conditionId = Number(req.params.conditionId);
    const { reason, prorationMode } = req.body;

    let idempotencyKey: string;
    try {
      idempotencyKey = validateIdempotencyKey(req.header("X-Idempotency-Key"));
    } catch (err: any) {
      res.status(400).json({ error: "idempotency_key_invalid", message: err.message });
      return;
    }

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      res.status(400).json({
        error: "reason_required",
        message: "Justificativa obrigatória para nova tentativa de ativação comercial.",
      });
      return;
    }

    if (!conditionId || !Number.isInteger(conditionId) || conditionId <= 0) {
      res.status(400).json({
        error: "invalid_condition_id",
        message: "ID da proposta comercial inválido.",
      });
      return;
    }

    const selectedProrationMode: ActivationTimingMode =
      prorationMode ?? ACTIVATION_TIMING_MODES.EFFECTIVE_NOW_PRORATE;

    const operation = COMMERCIAL_OPERATIONS.RETRY_PRICE_ACTIVATION;
    const payload = {
      crecheId,
      operation,
      conditionId,
      prorationMode: selectedProrationMode,
      reason: reason.trim(),
    };

    try {
      const result = await withCommercialOperationIdempotency({
        crecheId,
        operation,
        idempotencyKey,
        payload,
        resourceType: "customer_commercial_condition",
        resourceId: conditionId,
        isDbOnly: false,
        execute: async () => {
          const retryRes = await retryStripeCommercialActivation({
            crecheId,
            conditionId,
            reason: reason.trim(),
            idempotencyKey,
            prorationMode: selectedProrationMode,
            actorId: req.user?.id,
            actorEmail: req.user?.email,
          });
          return {
            statusCode: 200,
            data: retryRes,
            resourceId: conditionId,
          };
        },
      });

      res.status(result.statusCode).json({
        ...result.data,
        ...(result.replayed ? { replay: true } : {}),
      });
    } catch (err: any) {
      if (
        err instanceof CommercialIdempotencyConflictError ||
        err instanceof CommercialOperationInProgressError ||
        err instanceof CommercialOperationFailedFinalError
      ) {
        res.status(err.statusCode).json({
          error: err.code === "IDEMPOTENCY_CONFLICT" ? "idempotency_conflict" : err.code,
          code: err.code,
          message: err.message,
        });
        return;
      }
      if (err instanceof CommercialActivationError) {
        res.status(err.statusCode).json({
          error: err.code,
          code: err.code,
          message: err.message,
        });
        return;
      }
      res.status(500).json({
        error: "RETRY_ACTIVATION_ERROR",
        message: err.message || "Erro ao tentar novamente ativação comercial.",
      });
    }
  },
);

/**
 * POST /api/creches/:crecheId/commercial/conditions/:conditionId/abandon
 * Administratively abandons a draft or activation_failed condition.
 */
commercialRouter.post(
  "/conditions/:conditionId/abandon",
  async (req: AuthRequest, res: Response): Promise<void> => {
    const crecheId = Number(req.params.crecheId);
    const conditionId = Number(req.params.conditionId);
    const { reason } = req.body;

    let idempotencyKey: string;
    try {
      idempotencyKey = validateIdempotencyKey(req.header("X-Idempotency-Key"));
    } catch (err: any) {
      res.status(400).json({ error: "idempotency_key_invalid", message: err.message });
      return;
    }

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      res.status(400).json({
        error: "reason_required",
        message: "Justificativa obrigatória para abandonar proposta comercial.",
      });
      return;
    }

    if (!conditionId || !Number.isInteger(conditionId) || conditionId <= 0) {
      res.status(400).json({
        error: "invalid_condition_id",
        message: "ID da proposta comercial inválido.",
      });
      return;
    }

    const operation = COMMERCIAL_OPERATIONS.ABANDON_PRICE_CONDITION;
    const payload = {
      crecheId,
      operation,
      conditionId,
      reason: reason.trim(),
    };

    try {
      const result = await withCommercialOperationIdempotency({
        crecheId,
        operation,
        idempotencyKey,
        payload,
        resourceType: "customer_commercial_condition",
        resourceId: conditionId,
        isDbOnly: true,
        execute: async (tx) => {
          const abandonRes = await abandonCommercialCondition({
            crecheId,
            conditionId,
            reason: reason.trim(),
            actorId: req.user?.id,
            actorEmail: req.user?.email,
            dbClient: tx,
          });
          return {
            statusCode: 200,
            data: abandonRes,
            resourceId: conditionId,
          };
        },
      });

      res.status(result.statusCode).json({
        ...result.data,
        ...(result.replayed ? { replay: true } : {}),
      });
    } catch (err: any) {
      if (
        err instanceof CommercialIdempotencyConflictError ||
        err instanceof CommercialOperationInProgressError ||
        err instanceof CommercialOperationFailedFinalError
      ) {
        res.status(err.statusCode).json({
          error: err.code === "IDEMPOTENCY_CONFLICT" ? "idempotency_conflict" : err.code,
          code: err.code,
          message: err.message,
        });
        return;
      }
      if (err instanceof CommercialActivationError) {
        res.status(err.statusCode).json({
          error: err.code,
          code: err.code,
          message: err.message,
        });
        return;
      }
      res.status(500).json({
        error: "ABANDON_CONDITION_ERROR",
        message: err.message || "Erro ao abandonar proposta comercial.",
      });
    }
  },
);

/**
 * POST /api/creches/:crecheId/commercial/conditions/:conditionId/reprice-percentage
 * Bounded Master Admin percentage repricing action when current catalog price drifts.
 */
commercialRouter.post(
  "/conditions/:conditionId/reprice-percentage",
  async (req: AuthRequest, res: Response): Promise<void> => {
    const crecheId = Number(req.params.crecheId);
    const conditionId = Number(req.params.conditionId);
    const { reason } = req.body;

    let idempotencyKey: string;
    try {
      idempotencyKey = validateIdempotencyKey(req.header("X-Idempotency-Key"));
    } catch (err: any) {
      res.status(400).json({ error: "idempotency_key_invalid", message: err.message });
      return;
    }

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      res.status(400).json({
        error: "reason_required",
        message: "Justificativa obrigatória para reconciliação/reprecificação do Stripe.",
      });
      return;
    }

    if (!conditionId || !Number.isInteger(conditionId) || conditionId <= 0) {
      res.status(400).json({
        error: "invalid_condition_id",
        message: "ID da condição comercial inválido.",
      });
      return;
    }

    const operation = COMMERCIAL_OPERATIONS.REPRICE_PERCENTAGE_CONDITION;
    const payload = {
      crecheId,
      operation,
      conditionId,
      reason: reason.trim(),
    };

    try {
      const result = await withCommercialOperationIdempotency({
        crecheId,
        operation,
        idempotencyKey,
        payload,
        resourceType: "customer_commercial_condition",
        resourceId: conditionId,
        isDbOnly: false,
        execute: async () => {
          const repriceRes = await executePercentageReprice({
            crecheId,
            conditionId,
            reason: reason.trim(),
            actorId: req.user?.id,
            actorEmail: req.user?.email,
          });
          return {
            statusCode: 200,
            data: repriceRes,
            resourceId: conditionId,
          };
        },
      });

      res.status(result.statusCode).json({
        ...result.data,
        ...(result.replayed ? { replay: true } : {}),
      });
    } catch (err: any) {
      if (
        err instanceof CommercialIdempotencyConflictError ||
        err instanceof CommercialOperationInProgressError ||
        err instanceof CommercialOperationFailedFinalError
      ) {
        res.status(err.statusCode).json({
          error: err.code === "IDEMPOTENCY_CONFLICT" ? "idempotency_conflict" : err.code,
          code: err.code,
          message: err.message,
        });
        return;
      }
      if (err instanceof CommercialActivationError) {
        res.status(err.statusCode).json({
          error: err.code === "IDEMPOTENCY_CONFLICT" ? "idempotency_conflict" : err.code,
          code: err.code,
          message: err.message,
        });
        return;
      }
      res.status(500).json({
        error: "REPRICE_PERCENTAGE_ERROR",
        message: err.message || "Erro ao reconciliar cobrança percentual no Stripe.",
      });
    }
  },
);
