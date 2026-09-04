import { Router, type Response } from "express";
import crypto from "crypto";
import { db } from "@workspace/db";
import {
  crechesTable,
  subscriptionsTable,
  plansTable,
  customerCommercialConditionsTable,
} from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
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
  if (sub?.planId) {
    const [p] = await db.select().from(plansTable).where(eq(plansTable.id, sub.planId)).limit(1);
    plan = p ?? null;
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
  if (plan) {
    pricing = calculateEffectivePrice({
      catalogPriceCents: plan.priceBrl,
      pricingOverrideType: (activeCondition?.pricingOverrideType as any) ?? "none",
      pricingOverrideValue: activeCondition?.pricingOverrideValue ?? null,
      validFrom: activeCondition?.validFrom ?? null,
      validUntil: activeCondition?.validUntil ?? null,
    });
  }

  // Effective pet limit calculation
  const effectivePetLimit = activeCondition?.entitlementPetLimit ?? plan?.petLimit ?? null;

  // Query latest draft condition (if any)
  const [latestDraft] = await db
    .select()
    .from(customerCommercialConditionsTable)
    .where(
      and(
        eq(customerCommercialConditionsTable.crecheId, crecheId),
        eq(customerCommercialConditionsTable.status, "draft"),
      ),
    )
    .orderBy(desc(customerCommercialConditionsTable.createdAt))
    .limit(1);

  let draftPricing = null;
  if (latestDraft && plan) {
    draftPricing = calculateEffectivePrice({
      catalogPriceCents: plan.priceBrl,
      pricingOverrideType: (latestDraft.pricingOverrideType as any) ?? "none",
      pricingOverrideValue: latestDraft.pricingOverrideValue ?? null,
      validFrom: latestDraft.validFrom ?? null,
      validUntil: latestDraft.validUntil ?? null,
    });
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
          billingInterval: sub.billingInterval ?? "monthly",
          currentPeriodEnd: sub.currentPeriodEnd,
          trialEndsAt: sub.trialEndsAt,
          hasStripeCustomer: Boolean(sub.stripeCustomerId),
          hasStripeSubscription: Boolean(sub.stripeSubscriptionId),
        }
      : null,
    plan: plan
      ? {
          id: plan.id,
          name: plan.name,
          priceCents: plan.priceBrl,
          petLimit: plan.petLimit,
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
          statusNotice: "Ainda não aplicado / aguardando etapa Stripe",
        }
      : null,
  });
});

/**
 * POST /api/creches/:crecheId/commercial/preview-price
 * Pure simulation endpoint for pricing / limit overrides.
 */
commercialRouter.post("/preview-price", async (req: AuthRequest, res: Response): Promise<void> => {
  const crecheId = Number(req.params.crecheId);
  const { planId, pricingOverrideType, pricingOverrideValue, entitlementPetLimit } = req.body;

  let targetPlanId = planId ? Number(planId) : null;
  if (!targetPlanId) {
    const [sub] = await db
      .select({ planId: subscriptionsTable.planId })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.crecheId, crecheId))
      .limit(1);
    targetPlanId = sub?.planId ?? null;
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

    const calculation = calculateEffectivePrice({
      catalogPriceCents: plan.priceBrl,
      pricingOverrideType: pricingOverrideType ?? "none",
      pricingOverrideValue: pricingOverrideValue ?? null,
    });

    const activePetCount = await countActivePetsForCreche(crecheId, db);
    const proposedPetLimit =
      typeof entitlementPetLimit === "number" && entitlementPetLimit > 0
        ? entitlementPetLimit
        : plan.petLimit;

    const discountPercentage =
      plan.priceBrl > 0
        ? Math.round((calculation.overrideDiscountCents / plan.priceBrl) * 10000) / 100
        : 0;

    res.json({
      catalogPriceCents: plan.priceBrl,
      currentEffectivePriceCents: plan.priceBrl,
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

  // Correction 13: Lowering limit safety check
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

  // Idempotency check (Correction 3)
  const operation = "pet_limit_override";
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

  // Fetch current active condition (if any) to create full successor snapshot
  let currentActive = null;
  if (sub?.activeConditionId) {
    currentActive = await resolveActiveCommercialCondition(crecheId, sub.activeConditionId, db);
  }

  const successorSnapshot = {
    crecheId,
    planId: currentActive?.planId ?? sub?.planId ?? null,
    pricingOverrideType: currentActive?.pricingOverrideType ?? "none",
    pricingOverrideValue: currentActive?.pricingOverrideValue ?? null,
    entitlementPetLimit,
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
  const { planId, pricingOverrideType, pricingOverrideValue, entitlementPetLimit, reason } = req.body;

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

  // Idempotency check (Correction 3)
  const operation = "draft_condition";
  const requestFingerprint = computeRequestFingerprint({
    crecheId,
    operation,
    targetPlanId,
    pricingOverrideType,
    pricingOverrideValue,
    entitlementPetLimit: entitlementPetLimit ?? null,
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
