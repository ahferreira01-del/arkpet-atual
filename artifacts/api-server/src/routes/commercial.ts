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
  CommercialActivationError,
} from "../services/stripeCommercialActivation.js";

export const COMMERCIAL_OPERATIONS = {
  PET_LIMIT_OVERRIDE: "PET_LIMIT_OVERRIDE",
  DRAFT_PRICE_CONDITION: "DRAFT_PRICE_CONDITION",
  ACTIVATE_PRICE_CONDITION: "ACTIVATE_PRICE_CONDITION",
  RETRY_PRICE_ACTIVATION: "RETRY_PRICE_ACTIVATION",
  ABANDON_PRICE_CONDITION: "ABANDON_PRICE_CONDITION",
} as const;
export type CommercialOperation = (typeof COMMERCIAL_OPERATIONS)[keyof typeof COMMERCIAL_OPERATIONS];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateIdempotencyKey(rawKey: unknown): string {
  if (typeof rawKey !== "string" || !UUID_REGEX.test(rawKey.trim())) {
    throw new Error("O cabeçalho X-Idempotency-Key é obrigatório e deve ser um UUID válido.");
  }
  return rawKey.trim().toLowerCase();
}

function computeRequestFingerprint(payload: Record<string, unknown>): string {
  const normalized = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

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

  // Idempotency check (Section 1, 2, 3, 5)
  const operation = COMMERCIAL_OPERATIONS.PET_LIMIT_OVERRIDE;
  const requestFingerprint = computeRequestFingerprint({
    crecheId,
    operation,
    entitlementPetLimit,
    reason: reason.trim(),
  });

  const [existingIdempotent] = await db
    .select()
    .from(customerCommercialConditionsTable)
    .where(
      and(
        eq(customerCommercialConditionsTable.crecheId, crecheId),
        eq(customerCommercialConditionsTable.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  if (existingIdempotent) {
    if (
      existingIdempotent.idempotencyOperation !== operation ||
      existingIdempotent.requestFingerprint !== requestFingerprint
    ) {
      res.status(409).json({
        error: "idempotency_conflict",
        code: "IDEMPOTENCY_CONFLICT",
        message: "A chave de idempotência fornecida já foi utilizada com operação ou parâmetros diferentes.",
      });
      return;
    }

    // Exact match: replay result without repeating mutation or audit
    res.json({
      replay: true,
      condition: existingIdempotent,
      message: "Operação idempotente reexecutada com sucesso.",
    });
    return;
  }

  // Not previously executed: validate lowering limit safety
  // If confirmation is required, return HTTP 409 WITHOUT consuming the idempotency key (zero mutation)
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

  // Fetch current active condition (if any) to create full successor snapshot
  let currentActive = null;
  if (sub?.activeConditionId) {
    currentActive = await resolveActiveCommercialCondition(crecheId, sub.activeConditionId, db);
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
    validFrom: new Date(),
    validUntil: currentActive?.validUntil ?? null,
    status: "draft", // created as draft, then atomically activated
    executionRequirement: "ARKPET_ONLY",
    syncStatus: "synced", // ARKPET_ONLY changes require zero Stripe calls
    reason: reason.trim(),
    idempotencyKey,
    idempotencyOperation: operation,
    requestFingerprint,
  };

  assertConditionFullSnapshot(successorSnapshot as any);

  const result = await db.transaction(async (tx) => {
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
      condition: activatedCondition,
      previousConditionId: transitionResult.previousConditionId,
    };
  });

  res.status(201).json({
    success: true,
    condition: result.condition,
    previousConditionId: result.previousConditionId,
    message: "Limite de pets personalizado aplicado com sucesso.",
  });
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

  // Idempotency check (Section 1, 2, 3) - Must execute before catalog resolution and mutations
  const operation = COMMERCIAL_OPERATIONS.DRAFT_PRICE_CONDITION;
  const requestFingerprint = computeRequestFingerprint({
    crecheId,
    operation,
    targetPlanId,
    pricingOverrideType,
    pricingOverrideValue,
    entitlementPetLimit: entitlementPetLimit ?? null,
    reason: reason.trim(),
    ...(rawInterval ? { billingInterval: rawInterval } : {}),
  });

  const [existingIdempotent] = await db
    .select()
    .from(customerCommercialConditionsTable)
    .where(
      and(
        eq(customerCommercialConditionsTable.crecheId, crecheId),
        eq(customerCommercialConditionsTable.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  if (existingIdempotent) {
    if (
      existingIdempotent.idempotencyOperation !== operation ||
      existingIdempotent.requestFingerprint !== requestFingerprint
    ) {
      res.status(409).json({
        error: "idempotency_conflict",
        code: "IDEMPOTENCY_CONFLICT",
        message: "A chave de idempotência fornecida já foi utilizada com operação ou parâmetros diferentes.",
      });
      return;
    }

    res.json({
      replay: true,
      condition: existingIdempotent,
      message: "Operação idempotente reexecutada com sucesso.",
    });
    return;
  }

  // Resolve authoritative catalog price for snapshotting
  let resolvedCatalog: ResolvedCatalogPlanPrice | null = null;
  if (targetPlanId) {
    try {
      resolvedCatalog = await resolveCatalogPlanPrice(targetPlanId, draftInterval, db);
    } catch (err: any) {
      if (err instanceof CatalogPriceResolutionError) {
        res.status(422).json({ error: "catalog_price_missing", message: err.message });
        return;
      }
      throw err;
    }
  }

  // Determine executionRequirement: if pricing override is set, Stripe synchronization is required
  const hasPricingOverride = pricingOverrideType && pricingOverrideType !== "none";
  const executionRequirement = hasPricingOverride ? "STRIPE_REQUIRED" : "ARKPET_ONLY";
  const syncStatus = hasPricingOverride ? "not_started" : "synced"; // Correction 4

  const draftCondition = {
    crecheId,
    planId: targetPlanId,
    pricingOverrideType: pricingOverrideType ?? "none",
    pricingOverrideValue: pricingOverrideValue ?? null,
    entitlementPetLimit: entitlementPetLimit ?? null,
    snapshotBillingInterval: draftInterval,
    snapshotBasePriceCents: resolvedCatalog?.catalogPriceCents ?? null,
    validFrom: new Date(),
    status: "draft",
    executionRequirement,
    syncStatus,
    reason: reason.trim(),
    idempotencyKey,
    idempotencyOperation: operation,
    requestFingerprint,
  };

  assertConditionFullSnapshot(draftCondition as any);

  const [inserted] = await db.transaction(async (tx) => {
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

    return [row];
  });

  res.status(201).json({
    success: true,
    condition: inserted,
    message:
      "Rascunho comercial salvo com sucesso. A alteração de cobrança será aplicada após a etapa de sincronização com o Stripe.",
  });
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
  const requestFingerprint = computeRequestFingerprint({
    crecheId,
    operation,
    conditionId: parsedConditionId,
    prorationMode: selectedProrationMode,
    reason: reason.trim(),
  });

  // Check operation-scoped idempotency
  const [existingIdempotent] = await db
    .select()
    .from(customerCommercialConditionsTable)
    .where(
      and(
        eq(customerCommercialConditionsTable.crecheId, crecheId),
        eq(customerCommercialConditionsTable.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  if (existingIdempotent) {
    if (
      existingIdempotent.idempotencyOperation !== operation ||
      existingIdempotent.requestFingerprint !== requestFingerprint
    ) {
      res.status(409).json({
        error: "idempotency_conflict",
        code: "IDEMPOTENCY_CONFLICT",
        message: "A chave de idempotência fornecida já foi utilizada com operação ou parâmetros diferentes.",
      });
      return;
    }

    res.json({
      replay: true,
      condition: existingIdempotent,
      message: "Operação idempotente reexecutada com sucesso.",
    });
    return;
  }

  try {
    const result = await executeStripeCommercialActivation({
      crecheId,
      conditionId: parsedConditionId,
      prorationMode: selectedProrationMode,
      reason: reason.trim(),
      idempotencyKey,
      requestFingerprint,
      actorId: req.user?.id,
      actorEmail: req.user?.email,
    });

    res.status(200).json(result);
  } catch (err: any) {
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

    try {
      const result = await retryStripeCommercialActivation({
        crecheId,
        conditionId,
        reason: reason.trim(),
        idempotencyKey,
        prorationMode: selectedProrationMode,
        actorId: req.user?.id,
        actorEmail: req.user?.email,
      });
      res.status(200).json(result);
    } catch (err: any) {
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

    try {
      const result = await abandonCommercialCondition({
        crecheId,
        conditionId,
        reason: reason.trim(),
        actorId: req.user?.id,
        actorEmail: req.user?.email,
      });
      res.status(200).json(result);
    } catch (err: any) {
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
