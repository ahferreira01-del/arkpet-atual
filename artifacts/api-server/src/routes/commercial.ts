import { Router, type Response } from "express";
import crypto from "crypto";
import { db, BILLING_INTERVALS, type BillingInterval } from "@workspace/db";
import {
  crechesTable,
  subscriptionsTable,
  plansTable,
  customerCommercialConditionsTable,
  commercialAgreementsTable,
  commercialCampaignsTable,
  commercialCampaignBenefitsTable,
  assignedCommercialBenefitsTable,
  benefitCycleConsumptionsTable,
  platformServiceRequestsTable,
  billingWebhookErrorsTable,
} from "@workspace/db/schema";
import { eq, and, or, desc, sql } from "drizzle-orm";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate.js";
import { countActivePetsForCreche } from "../middlewares/checkPetLimit.js";
import { PlanVersionService, PlanVersionError } from "../services/planVersionService.js";
import { dispatchWebhookBusinessLogic } from "../lib/webhookHandlers.js";
import {
  createProposal,
  updateDraftProposal,
  sendProposal,
  supersedeProposal,
  retryProposalActivation,
  CommercialProposalError,
} from "../services/commercialProposals.js";
import {
  reviewImplementationRequest,
  sendImplementationQuote,
  scheduleImplementation,
  startImplementation,
  completeImplementation,
  cancelImplementation,
  PlatformServiceError,
} from "../services/platformServices.js";
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
  CommercialOperationFencingLostError,
} from "../services/commercialOperationRequests.js";
import {
  createCampaign,
  updateCampaign,
  previewCampaignAssignment,
  assignCampaignToCreche,
  CommercialCampaignError,
  CommercialCampaignIntegrityError,
  CommercialCampaignFavorableOnlyError,
  CommercialCampaignConflictError,
  CommercialCampaignNotActiveError,
} from "../services/commercialCampaigns.js";
import {
  ExistingStripeScheduleUnsupportedError,
  StripeCampaignScheduleError,
} from "../services/stripeCampaignSchedule.js";

export const COMMERCIAL_OPERATIONS = {
  PET_LIMIT_OVERRIDE: "PET_LIMIT_OVERRIDE",
  DRAFT_PRICE_CONDITION: "DRAFT_PRICE_CONDITION",
  ACTIVATE_PRICE_CONDITION: "ACTIVATE_PRICE_CONDITION",
  RETRY_PRICE_ACTIVATION: "RETRY_PRICE_ACTIVATION",
  ABANDON_PRICE_CONDITION: "ABANDON_PRICE_CONDITION",
  REPRICE_PERCENTAGE_CONDITION: "REPRICE_PERCENTAGE_CONDITION",
  CREATE_COMMERCIAL_CAMPAIGN: "CREATE_COMMERCIAL_CAMPAIGN",
  UPDATE_COMMERCIAL_CAMPAIGN: "UPDATE_COMMERCIAL_CAMPAIGN",
  CHANGE_COMMERCIAL_CAMPAIGN_STATUS: "CHANGE_COMMERCIAL_CAMPAIGN_STATUS",
  ASSIGN_COMMERCIAL_CAMPAIGN: "ASSIGN_COMMERCIAL_CAMPAIGN",
  CREATE_PROPOSAL: "CREATE_PROPOSAL",
  UPDATE_DRAFT_PROPOSAL: "UPDATE_DRAFT_PROPOSAL",
  SEND_PROPOSAL: "SEND_PROPOSAL",
  SUPERSEDE_PROPOSAL: "SUPERSEDE_PROPOSAL",
  ACCEPT_PROPOSAL: "ACCEPT_PROPOSAL",
  DECLINE_PROPOSAL: "DECLINE_PROPOSAL",
  RETRY_PROPOSAL_ACTIVATION: "RETRY_PROPOSAL_ACTIVATION",
  REQUEST_ASSISTED_IMPLEMENTATION: "REQUEST_ASSISTED_IMPLEMENTATION",
  REVIEW_IMPLEMENTATION_REQUEST: "REVIEW_IMPLEMENTATION_REQUEST",
  SEND_IMPLEMENTATION_QUOTE: "SEND_IMPLEMENTATION_QUOTE",
  ACCEPT_IMPLEMENTATION_QUOTE: "ACCEPT_IMPLEMENTATION_QUOTE",
  CREATE_IMPLEMENTATION_PAYMENT: "CREATE_IMPLEMENTATION_PAYMENT",
  SCHEDULE_IMPLEMENTATION: "SCHEDULE_IMPLEMENTATION",
  START_IMPLEMENTATION: "START_IMPLEMENTATION",
  COMPLETE_IMPLEMENTATION: "COMPLETE_IMPLEMENTATION",
  CANCEL_IMPLEMENTATION: "CANCEL_IMPLEMENTATION",
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
    lastSynchronizedAmountCents: number | null;
    message: string;
  } | null = null;

  if (sub?.stripeSubscriptionId) {
    const isPending =
      latestDraft?.syncStatus === "sync_pending" ||
      latestDraft?.status === "pending_activation" ||
      activeCondition?.syncStatus === "sync_pending";

    const isFailed =
      latestDraft?.syncStatus === "sync_failed" ||
      latestDraft?.status === "activation_failed" ||
      activeCondition?.syncStatus === "sync_failed";

    const isDivergent =
      activeCondition?.syncStatus === "divergent" ||
      latestDraft?.syncStatus === "divergent";

    if (isPending) {
      // 1. sync_pending -> PENDING (Precedence 1)
      commercialStripeStatus = "PENDING";
    } else if (isFailed) {
      // 2. sync_failed -> FAILED (Precedence 2)
      commercialStripeStatus = "FAILED";
    } else if (isDivergent) {
      // 3. divergent -> DIVERGENT (Precedence 3)
      // Amount equality must NOT hide identity/cadence divergence (Section 6)
      commercialStripeStatus = "DIVERGENT";
      if (activeCondition && activeCondition.pricingOverrideType === "percentage" && pricing) {
        percentageRepriceNotice = {
          required: true,
          expectedEffectivePriceCents: pricing.finalEffectivePriceCents,
          lastSynchronizedAmountCents: activeCondition.lastSynchronizedAmountCents ?? null,
          message: "Cobrança Stripe divergente em relação à condição comercial ativa.",
        };
      }
    } else if (activeCondition?.syncStatus === "synced") {
      // 4. synced -> evaluate known-good synchronized amount (Precedence 4)
      const expectedAmount = pricing ? pricing.finalEffectivePriceCents : null;
      const lastSyncedAmount = activeCondition.lastSynchronizedAmountCents;

      if (activeCondition.pricingOverrideType === "percentage") {
        if (lastSyncedAmount != null && expectedAmount != null && lastSyncedAmount === expectedAmount) {
          commercialStripeStatus = "SYNCHRONIZED";
        } else {
          commercialStripeStatus = "DIVERGENT";
          percentageRepriceNotice = {
            required: true,
            expectedEffectivePriceCents: expectedAmount ?? 0,
            lastSynchronizedAmountCents: lastSyncedAmount ?? null,
            message:
              lastSyncedAmount == null
                ? "Estado de sincronização Stripe indefinido ou não confirmado."
                : "Valor Stripe desatualizado. O catálogo foi alterado após a última sincronização desta condição percentual.",
          };
        }
      } else {
        if (lastSyncedAmount != null && expectedAmount != null && lastSyncedAmount === expectedAmount) {
          commercialStripeStatus = "SYNCHRONIZED";
        } else {
          commercialStripeStatus = "DIVERGENT";
        }
      }
    } else if (!activeCondition) {
      commercialStripeStatus = "SYNCHRONIZED";
    } else {
      commercialStripeStatus = "DIVERGENT";
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
      err instanceof CommercialOperationFailedFinalError ||
      err instanceof CommercialOperationFencingLostError
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
      err instanceof CommercialOperationFailedFinalError ||
      err instanceof CommercialOperationFencingLostError
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
      execute: async (_client, fencingToken) => {
        const activationResult = await executeStripeCommercialActivation({
          crecheId,
          conditionId: parsedConditionId,
          prorationMode: selectedProrationMode,
          reason: reason.trim(),
          idempotencyKey,
          requestFingerprint: computeRequestFingerprint(payload),
          actorId: req.user?.id,
          actorEmail: req.user?.email,
          fencingToken,
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
      err instanceof CommercialOperationFailedFinalError ||
      err instanceof CommercialOperationFencingLostError
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
        execute: async (_client, fencingToken) => {
          const retryRes = await retryStripeCommercialActivation({
            crecheId,
            conditionId,
            reason: reason.trim(),
            idempotencyKey,
            prorationMode: selectedProrationMode,
            actorId: req.user?.id,
            actorEmail: req.user?.email,
            fencingToken,
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
        err instanceof CommercialOperationFailedFinalError ||
        err instanceof CommercialOperationFencingLostError
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
        err instanceof CommercialOperationFailedFinalError ||
        err instanceof CommercialOperationFencingLostError
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
        execute: async (_client, fencingToken) => {
          const repriceRes = await executePercentageReprice({
            crecheId,
            conditionId,
            reason: reason.trim(),
            actorId: req.user?.id,
            actorEmail: req.user?.email,
            fencingToken,
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
        err instanceof CommercialOperationFailedFinalError ||
        err instanceof CommercialOperationFencingLostError
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
        error: "REPRICE_PERCENTAGE_ERROR",
        message: err.message || "Erro ao reconciliar cobrança percentual no Stripe.",
      });
    }
  },
);

// ============================================================================
// COMMERCIAL CAMPAIGNS & TEMPORAL BENEFITS (R36.F)
// ============================================================================

/**
 * GET /campaigns
 * Lists all commercial campaigns with benefit details and assignment statistics.
 */
commercialRouter.get("/campaigns", async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const campaigns = await db
      .select()
      .from(commercialCampaignsTable)
      .orderBy(desc(commercialCampaignsTable.priority), desc(commercialCampaignsTable.createdAt));

    const enriched = await Promise.all(
      campaigns.map(async (camp) => {
        const [benefit] = await db
          .select()
          .from(commercialCampaignBenefitsTable)
          .where(eq(commercialCampaignBenefitsTable.campaignId, camp.id))
          .limit(1);

        const assignments = await db
          .select()
          .from(assignedCommercialBenefitsTable)
          .where(eq(assignedCommercialBenefitsTable.campaignId, camp.id));

        const assignedCount = assignments.length;
        const activeCount = assignments.filter((a) => a.status === "active").length;
        const completedCount = assignments.filter((a) => a.status === "completed").length;

        return {
          ...camp,
          benefit: benefit ?? null,
          stats: {
            assignedCount,
            activeCount,
            completedCount,
          },
        };
      }),
    );

    res.json({ campaigns: enriched });
  } catch (err: any) {
    res.status(500).json({ error: "CAMPAIGNS_FETCH_FAILED", message: err.message });
  }
});

/**
 * POST /campaigns
 * Creates a new draft or active commercial campaign with its recurring benefit definition.
 */
commercialRouter.post("/campaigns", async (req: AuthRequest, res: Response): Promise<void> => {
  let idempotencyKey: string;
  try {
    idempotencyKey = validateIdempotencyKey(req.header("X-Idempotency-Key"));
  } catch (err: any) {
    res.status(400).json({ error: "idempotency_key_invalid", message: err.message });
    return;
  }

  const {
    name,
    description,
    status,
    eligibleFrom,
    eligibleUntil,
    priority,
    benefitType,
    benefitValue,
    billingCycles,
  } = req.body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "name_required", message: "Nome da campanha é obrigatório." });
    return;
  }

  if (status === "active" && (!req.body.reason || String(req.body.reason).trim().length === 0)) {
    res.status(422).json({
      error: "CAMPAIGN_STATUS_REASON_REQUIRED",
      code: "CAMPAIGN_STATUS_REASON_REQUIRED",
      message: "Justificativa comercial obrigatória para ativação da campanha.",
    });
    return;
  }

  const operation = COMMERCIAL_OPERATIONS.CREATE_COMMERCIAL_CAMPAIGN;
  const payload = {
    operation,
    name: name.trim(),
    description: description ? String(description).trim() : null,
    status: status ?? "draft",
    eligibleFrom: eligibleFrom ?? null,
    eligibleUntil: eligibleUntil ?? null,
    priority: typeof priority === "number" ? priority : 0,
    benefitType,
    benefitValue: Number(benefitValue),
    billingCycles: Number(billingCycles),
  };

  try {
    const result = await withCommercialOperationIdempotency({
      crecheId: null,
      operation,
      idempotencyKey,
      payload,
      resourceType: "commercial_campaign",
      isDbOnly: true,
      execute: async (tx) => {
        const campaign = await createCampaign(
          {
            name: name.trim(),
            description: description ? String(description).trim() : undefined,
            status: status ?? "draft",
            eligibleFrom: eligibleFrom ? new Date(eligibleFrom) : null,
            eligibleUntil: eligibleUntil ? new Date(eligibleUntil) : null,
            priority: typeof priority === "number" ? priority : 0,
            benefitType,
            benefitValue: Number(benefitValue),
            billingCycles: Number(billingCycles),
            createdBy: req.user?.email ?? "master_admin",
            reason: req.body.reason ? String(req.body.reason).trim() : undefined,
          },
          tx,
        );
        return {
          statusCode: 201,
          data: campaign,
          resourceId: campaign.campaign.id,
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
      err instanceof CommercialOperationFailedFinalError ||
      err instanceof CommercialOperationFencingLostError
    ) {
      res.status(err.statusCode).json({
        error: err.code === "IDEMPOTENCY_CONFLICT" ? "idempotency_conflict" : err.code,
        code: err.code,
        message: err.message,
      });
      return;
    }
    if (err instanceof CommercialCampaignError) {
      res.status(err.statusCode).json({ error: err.code, code: err.code, message: err.message });
      return;
    }
    if (err instanceof CommercialCampaignIntegrityError) {
      res.status(400).json({ error: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "CAMPAIGN_CREATE_FAILED", message: err.message });
  }
});

/**
 * GET /campaigns/:id
 * Retrieves campaign details, benefit definition, and assigned benefits with cycle consumption counts.
 */
commercialRouter.get("/campaigns/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const campaignId = Number(req.params.id);
    if (!campaignId || Number.isNaN(campaignId)) {
      res.status(400).json({ error: "invalid_campaign_id", message: "ID da campanha inválido." });
      return;
    }

    const [campaign] = await db
      .select()
      .from(commercialCampaignsTable)
      .where(eq(commercialCampaignsTable.id, campaignId))
      .limit(1);

    if (!campaign) {
      res.status(404).json({ error: "campaign_not_found", message: "Campanha não encontrada." });
      return;
    }

    const [benefit] = await db
      .select()
      .from(commercialCampaignBenefitsTable)
      .where(eq(commercialCampaignBenefitsTable.campaignId, campaignId))
      .limit(1);

    const assignments = await db
      .select({
        assignedBenefit: assignedCommercialBenefitsTable,
        crecheName: crechesTable.name,
      })
      .from(assignedCommercialBenefitsTable)
      .innerJoin(crechesTable, eq(assignedCommercialBenefitsTable.crecheId, crechesTable.id))
      .where(eq(assignedCommercialBenefitsTable.campaignId, campaignId))
      .orderBy(desc(assignedCommercialBenefitsTable.assignedAt));

    const enrichedAssignments = await Promise.all(
      assignments.map(async ({ assignedBenefit, crecheName }) => {
        const consumptions = await db
          .select()
          .from(benefitCycleConsumptionsTable)
          .where(eq(benefitCycleConsumptionsTable.assignedBenefitId, assignedBenefit.id));

        return {
          ...assignedBenefit,
          crecheName,
          consumedCyclesCount: consumptions.length,
          consumptions,
        };
      }),
    );

    res.json({
      campaign,
      benefit: benefit ?? null,
      assignments: enrichedAssignments,
    });
  } catch (err: any) {
    res.status(500).json({ error: "CAMPAIGN_FETCH_FAILED", message: err.message });
  }
});

/**
 * PATCH /campaigns/:id
 * Updates mutable campaign metadata or status (pause, close, archive).
 */
commercialRouter.patch("/campaigns/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  const campaignId = Number(req.params.id);
  if (!campaignId || Number.isNaN(campaignId)) {
    res.status(400).json({ error: "invalid_campaign_id", message: "ID da campanha inválido." });
    return;
  }

  let idempotencyKey: string;
  try {
    idempotencyKey = validateIdempotencyKey(req.header("X-Idempotency-Key"));
  } catch (err: any) {
    res.status(400).json({ error: "idempotency_key_invalid", message: err.message });
    return;
  }

  const {
    name,
    description,
    status,
    eligibleFrom,
    eligibleUntil,
    priority,
    reason,
  } = req.body;

  if (status !== undefined && (!reason || String(reason).trim().length === 0)) {
    res.status(422).json({
      error: "CAMPAIGN_STATUS_REASON_REQUIRED",
      code: "CAMPAIGN_STATUS_REASON_REQUIRED",
      message: "Justificativa comercial obrigatória para alteração de status da campanha.",
    });
    return;
  }

  const isStatusOnly =
    status !== undefined &&
    name === undefined &&
    description === undefined &&
    eligibleFrom === undefined &&
    eligibleUntil === undefined &&
    priority === undefined;

  const operation = isStatusOnly
    ? COMMERCIAL_OPERATIONS.CHANGE_COMMERCIAL_CAMPAIGN_STATUS
    : COMMERCIAL_OPERATIONS.UPDATE_COMMERCIAL_CAMPAIGN;

  const payload: Record<string, any> = {
    campaignId,
    operation,
    name: name !== undefined ? String(name).trim() : null,
    description: description !== undefined ? (description ? String(description).trim() : null) : null,
    status: status ?? null,
    eligibleFrom: eligibleFrom ?? null,
    eligibleUntil: eligibleUntil ?? null,
    priority: typeof priority === "number" ? priority : null,
  };
  if (reason !== undefined) {
    payload.reason = reason ? String(reason).trim() : null;
  }

  try {
    const result = await withCommercialOperationIdempotency({
      crecheId: null,
      operation,
      idempotencyKey,
      payload,
      resourceType: "commercial_campaign",
      resourceId: campaignId,
      isDbOnly: true,
      execute: async (tx) => {
        const updated = await updateCampaign(
          campaignId,
          {
            name: name !== undefined ? String(name).trim() : undefined,
            description: description !== undefined ? (description ? String(description).trim() : undefined) : undefined,
            status,
            eligibleFrom: eligibleFrom !== undefined ? (eligibleFrom ? new Date(eligibleFrom) : null) : undefined,
            eligibleUntil: eligibleUntil !== undefined ? (eligibleUntil ? new Date(eligibleUntil) : null) : undefined,
            priority: typeof priority === "number" ? priority : undefined,
            reason: reason ? String(reason).trim() : undefined,
          },
          tx,
        );
        return {
          statusCode: 200,
          data: { campaign: updated },
          resourceId: campaignId,
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
      err instanceof CommercialOperationFailedFinalError ||
      err instanceof CommercialOperationFencingLostError
    ) {
      res.status(err.statusCode).json({
        error: err.code === "IDEMPOTENCY_CONFLICT" ? "idempotency_conflict" : err.code,
        code: err.code,
        message: err.message,
      });
      return;
    }
    if (err instanceof CommercialCampaignError) {
      res.status(err.statusCode).json({ error: err.code, code: err.code, message: err.message });
      return;
    }
    if (err instanceof CommercialCampaignIntegrityError) {
      res.status(400).json({ error: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "CAMPAIGN_UPDATE_FAILED", message: err.message });
  }
});

/**
 * POST /campaigns/:id/preview
 * Read-only dry-run preview evaluating customer eligibility, prices, savings, and dates.
 */
commercialRouter.post("/campaigns/:id/preview", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const campaignId = Number(req.params.id);
    if (!campaignId || Number.isNaN(campaignId)) {
      res.status(400).json({ error: "invalid_campaign_id", message: "ID da campanha inválido." });
      return;
    }

    const { crecheIds } = req.body;
    if (!Array.isArray(crecheIds) || crecheIds.length === 0) {
      res.status(400).json({ error: "creche_ids_required", message: "Lista de creches é obrigatória para o preview." });
      return;
    }

    const parsedIds = crecheIds.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (parsedIds.length === 0) {
      res.status(400).json({ error: "invalid_creche_ids", message: "Nenhum ID de creche válido informado." });
      return;
    }

    const preview = await previewCampaignAssignment(campaignId, parsedIds, db);

    res.json(preview);
  } catch (err: any) {
    if (err instanceof CommercialCampaignIntegrityError || err instanceof CommercialCampaignNotActiveError) {
      res.status(400).json({ error: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "CAMPAIGN_PREVIEW_FAILED", message: err.message });
  }
});

/**
 * POST /campaigns/:id/assign/:crecheId
 * Single-target idempotent assignment of a commercial campaign to a customer.
 */
commercialRouter.post(
  "/campaigns/:id/assign/:crecheId",
  async (req: AuthRequest, res: Response): Promise<void> => {
    const campaignId = Number(req.params.id);
    const crecheId = Number(req.params.crecheId);

    if (!campaignId || Number.isNaN(campaignId)) {
      res.status(400).json({ error: "invalid_campaign_id", message: "ID da campanha inválido." });
      return;
    }
    if (!crecheId || Number.isNaN(crecheId)) {
      res.status(400).json({ error: "invalid_creche_id", message: "ID da creche inválido." });
      return;
    }

    let idempotencyKey: string;
    try {
      idempotencyKey = validateIdempotencyKey(req.header("X-Idempotency-Key"));
    } catch (err: any) {
      res.status(400).json({ error: "idempotency_key_invalid", message: err.message });
      return;
    }

    const { reason } = req.body;
    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      res.status(400).json({
        error: "reason_required",
        message: "Justificativa obrigatória para atribuição de campanha comercial.",
      });
      return;
    }

    const operation = COMMERCIAL_OPERATIONS.ASSIGN_COMMERCIAL_CAMPAIGN;
    const payload = {
      crecheId,
      campaignId,
      operation,
      reason: reason.trim(),
    };

    try {
      const result = await withCommercialOperationIdempotency({
        crecheId,
        operation,
        idempotencyKey,
        payload,
        resourceType: "assigned_commercial_benefit",
        resourceId: undefined,
        isDbOnly: false,
        execute: async (client, _fencingToken) => {
          const assignRes = await assignCampaignToCreche({
            campaignId,
            crecheId,
            assignedBy: req.user?.email ?? "master_admin",
            reason: reason.trim(),
            dbClient: client,
          });

          return {
            statusCode: 201,
            data: assignRes,
            resourceId: assignRes.assignedBenefit.id,
          };
        },
      });

      res.status(result.statusCode).json({
        ...(result.data as Record<string, unknown>),
        ...(result.replayed ? { replay: true } : {}),
      });
    } catch (err: any) {
      if (
        err instanceof CommercialIdempotencyConflictError ||
        err instanceof CommercialOperationInProgressError ||
        err instanceof CommercialOperationFailedFinalError ||
        err instanceof CommercialOperationFencingLostError
      ) {
        res.status(err.statusCode).json({
          error: err.code === "IDEMPOTENCY_CONFLICT" ? "idempotency_conflict" : err.code,
          code: err.code,
          message: err.message,
        });
        return;
      }
      if (err instanceof CommercialCampaignError) {
        res.status(err.statusCode).json({ error: err.code, code: err.code, message: err.message });
        return;
      }
      if (err instanceof CommercialCampaignIntegrityError || err instanceof CommercialCampaignNotActiveError) {
        res.status(400).json({ error: err.code, code: err.code, message: err.message });
        return;
      }
      if (err instanceof CommercialCampaignFavorableOnlyError) {
        res.status(422).json({ error: err.code, code: err.code, message: err.message });
        return;
      }
      if (err instanceof CommercialCampaignConflictError) {
        res.status(409).json({ error: err.code, code: err.code, message: err.message });
        return;
      }
      if (err instanceof ExistingStripeScheduleUnsupportedError) {
        res.status(409).json({ error: err.code, code: err.code, message: err.message });
        return;
      }
      if (err instanceof StripeCampaignScheduleError) {
        res.status(422).json({ error: err.code, code: err.code, message: err.message });
        return;
      }
      res.status(500).json({
        error: "ASSIGN_CAMPAIGN_ERROR",
        message: err.message || "Erro ao atribuir campanha comercial.",
      });
    }
  },
);

// ==========================================================
// MASTER ADMIN PROPOSALS (Phase R36.G)
// ==========================================================

commercialRouter.get("/proposals", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const crecheId = req.params.crecheId ? Number(req.params.crecheId) : req.query.crecheId ? Number(req.query.crecheId) : null;
    const status = typeof req.query.status === "string" ? req.query.status : null;

    let query = db.select().from(commercialAgreementsTable).$dynamic();
    const conditions = [eq(commercialAgreementsTable.type, "commercial_proposal")];

    if (crecheId && !Number.isNaN(crecheId)) {
      conditions.push(eq(commercialAgreementsTable.crecheId, crecheId));
    }
    if (status) {
      conditions.push(eq(commercialAgreementsTable.status, status));
    }

    const proposals = await query.where(and(...conditions)).orderBy(desc(commercialAgreementsTable.createdAt));
    res.json(proposals);
  } catch (err: any) {
    res.status(500).json({ error: "LIST_PROPOSALS_ERROR", message: err.message });
  }
});

commercialRouter.get("/proposals/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      res.status(400).json({ error: "ID inválido." });
      return;
    }

    const [proposal] = await db
      .select()
      .from(commercialAgreementsTable)
      .where(
        and(
          eq(commercialAgreementsTable.id, id),
          eq(commercialAgreementsTable.type, "commercial_proposal"),
        ),
      )
      .limit(1);

    if (!proposal) {
      res.status(404).json({ error: "PROPOSAL_NOT_FOUND", message: "Proposta não encontrada." });
      return;
    }

    res.json(proposal);
  } catch (err: any) {
    res.status(500).json({ error: "GET_PROPOSAL_ERROR", message: err.message });
  }
});

commercialRouter.post("/proposals", async (req: AuthRequest, res: Response): Promise<void> => {
  const crecheId = Number(req.body.crecheId || req.params.crecheId);
  if (!crecheId || Number.isNaN(crecheId)) {
    res.status(400).json({ error: "Creche inválida." });
    return;
  }

  const {
    title,
    notes,
    planId,
    billingInterval,
    pricingOverrideType,
    pricingOverrideValue,
    entitlementPetLimit,
    prorationMode,
    validUntil,
  } = req.body;

  let idempotencyKey: string;
  try {
    const rawKey = (req.headers["x-idempotency-key"] as string) || (req.header("X-Idempotency-Key") as string) || null;
    idempotencyKey = rawKey ? validateIdempotencyKey(rawKey) : crypto.randomUUID();
  } catch (err: any) {
    res.status(400).json({ error: "idempotency_key_invalid", message: err.message });
    return;
  }

  const executeAction = async (tx?: any) => {
    return await createProposal({
      crecheId,
      title,
      notes,
      planId: planId ? Number(planId) : null,
      billingInterval,
      pricingOverrideType,
      pricingOverrideValue: pricingOverrideValue !== undefined && pricingOverrideValue !== null ? Number(pricingOverrideValue) : null,
      entitlementPetLimit: entitlementPetLimit !== undefined && entitlementPetLimit !== null ? Number(entitlementPetLimit) : null,
      prorationMode,
      validUntil: validUntil ? new Date(validUntil) : null,
      createdBy: req.user?.email ?? `user_${req.user?.id}`,
      dbClient: tx,
    });
  };

  try {
    if (idempotencyKey) {
      validateIdempotencyKey(idempotencyKey);
      const result = await withCommercialOperationIdempotency({
        crecheId,
        operation: COMMERCIAL_OPERATIONS.CREATE_PROPOSAL,
        idempotencyKey,
        payload: req.body,
        resourceType: "commercial_agreement",
        isDbOnly: true,
        execute: async (tx) => {
          const proposal = await executeAction(tx);
          return { statusCode: 201, data: proposal, resourceId: proposal.id };
        },
      });
      res.status(result.statusCode).json({
        ...(result.data as Record<string, unknown>),
        ...(result.replayed ? { replay: true } : {}),
      });
      return;
    }

    const proposal = await executeAction();
    res.status(201).json(proposal);
  } catch (err: any) {
    if (err instanceof CommercialProposalError) {
      res.status(err.statusCode).json({ error: err.code, code: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "CREATE_PROPOSAL_ERROR", message: err.message });
  }
});

commercialRouter.patch("/proposals/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }

  const [existing] = await db
    .select()
    .from(commercialAgreementsTable)
    .where(eq(commercialAgreementsTable.id, id))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "PROPOSAL_NOT_FOUND", message: "Proposta não encontrada." });
    return;
  }

  const {
    title,
    notes,
    planId,
    billingInterval,
    pricingOverrideType,
    pricingOverrideValue,
    entitlementPetLimit,
    prorationMode,
    validUntil,
  } = req.body;

  let idempotencyKey: string;
  try {
    const rawKey = (req.headers["x-idempotency-key"] as string) || (req.header("X-Idempotency-Key") as string) || null;
    idempotencyKey = rawKey ? validateIdempotencyKey(rawKey) : crypto.randomUUID();
  } catch (err: any) {
    res.status(400).json({ error: "idempotency_key_invalid", message: err.message });
    return;
  }

  const executeAction = async (tx?: any) => {
    return await updateDraftProposal({
      id,
      crecheId: existing.crecheId,
      title,
      notes,
      planId: planId !== undefined ? (planId ? Number(planId) : null) : undefined,
      billingInterval,
      pricingOverrideType,
      pricingOverrideValue: pricingOverrideValue !== undefined ? (pricingOverrideValue !== null ? Number(pricingOverrideValue) : null) : undefined,
      entitlementPetLimit: entitlementPetLimit !== undefined ? (entitlementPetLimit !== null ? Number(entitlementPetLimit) : null) : undefined,
      prorationMode,
      validUntil: validUntil !== undefined ? (validUntil ? new Date(validUntil) : null) : undefined,
      dbClient: tx,
    });
  };

  try {
    if (idempotencyKey) {
      validateIdempotencyKey(idempotencyKey);
      const result = await withCommercialOperationIdempotency({
        crecheId: existing.crecheId,
        operation: COMMERCIAL_OPERATIONS.UPDATE_DRAFT_PROPOSAL,
        idempotencyKey,
        payload: req.body,
        resourceType: "commercial_agreement",
        isDbOnly: true,
        execute: async (tx) => {
          const updated = await executeAction(tx);
          return { statusCode: 200, data: updated, resourceId: updated.id };
        },
      });
      res.status(result.statusCode).json({
        ...(result.data as Record<string, unknown>),
        ...(result.replayed ? { replay: true } : {}),
      });
      return;
    }

    const updated = await executeAction();
    res.json(updated);
  } catch (err: any) {
    if (err instanceof CommercialProposalError) {
      res.status(err.statusCode).json({ error: err.code, code: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "UPDATE_PROPOSAL_ERROR", message: err.message });
  }
});

commercialRouter.post("/proposals/:id/send", async (req: AuthRequest, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }

  const [existing] = await db
    .select()
    .from(commercialAgreementsTable)
    .where(eq(commercialAgreementsTable.id, id))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "PROPOSAL_NOT_FOUND", message: "Proposta não encontrada." });
    return;
  }

  const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
  if (!reason) {
    res.status(400).json({
      error: "REASON_REQUIRED",
      code: "REASON_REQUIRED",
      message: "Justificativa obrigatória para envio de proposta comercial.",
    });
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
    return await sendProposal({
      id,
      crecheId: existing.crecheId,
      senderEmail: req.user?.email ?? `user_${req.user?.id}`,
      senderId: req.user?.id,
      reason,
      dbClient: tx,
    });
  };

  try {
    if (idempotencyKey) {
      validateIdempotencyKey(idempotencyKey);
      const result = await withCommercialOperationIdempotency({
        crecheId: existing.crecheId,
        operation: COMMERCIAL_OPERATIONS.SEND_PROPOSAL,
        idempotencyKey,
        payload: req.body,
        resourceType: "commercial_agreement",
        isDbOnly: true,
        execute: async (tx) => {
          const sent = await executeAction(tx);
          return { statusCode: 200, data: sent, resourceId: sent.id };
        },
      });
      res.status(result.statusCode).json({
        ...(result.data as Record<string, unknown>),
        ...(result.replayed ? { replay: true } : {}),
      });
      return;
    }

    const sent = await executeAction();
    res.json(sent);
  } catch (err: any) {
    if (err instanceof CommercialProposalError) {
      res.status(err.statusCode).json({ error: err.code, code: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "SEND_PROPOSAL_ERROR", message: err.message });
  }
});

commercialRouter.post("/proposals/:id/supersede", async (req: AuthRequest, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  const supersededByAgreementId = Number(req.body.supersededByAgreementId);

  if (!id || Number.isNaN(id) || !supersededByAgreementId || Number.isNaN(supersededByAgreementId)) {
    res.status(400).json({ error: "IDs inválidos." });
    return;
  }

  const [existing] = await db
    .select()
    .from(commercialAgreementsTable)
    .where(eq(commercialAgreementsTable.id, id))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "PROPOSAL_NOT_FOUND", message: "Proposta não encontrada." });
    return;
  }

  const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
  if (!reason) {
    res.status(400).json({
      error: "REASON_REQUIRED",
      code: "REASON_REQUIRED",
      message: "Justificativa obrigatória para substituição de proposta comercial.",
    });
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
    return await supersedeProposal({
      id,
      crecheId: existing.crecheId,
      supersededByAgreementId,
      adminEmail: req.user?.email ?? `user_${req.user?.id}`,
      adminId: req.user?.id,
      reason: reason.trim(),
      dbClient: tx,
    });
  };

  try {
    if (idempotencyKey) {
      validateIdempotencyKey(idempotencyKey);
      const result = await withCommercialOperationIdempotency({
        crecheId: existing.crecheId,
        operation: COMMERCIAL_OPERATIONS.SUPERSEDE_PROPOSAL,
        idempotencyKey,
        payload: req.body,
        resourceType: "commercial_agreement",
        isDbOnly: true,
        execute: async (tx) => {
          const superseded = await executeAction(tx);
          return { statusCode: 200, data: superseded, resourceId: superseded.id };
        },
      });
      res.status(result.statusCode).json({
        ...(result.data as Record<string, unknown>),
        ...(result.replayed ? { replay: true } : {}),
      });
      return;
    }

    const superseded = await executeAction();
    res.json(superseded);
  } catch (err: any) {
    if (err instanceof CommercialProposalError) {
      res.status(err.statusCode).json({ error: err.code, code: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "SUPERSEDE_PROPOSAL_ERROR", message: err.message });
  }
});

commercialRouter.post("/proposals/:id/retry-activation", async (req: AuthRequest, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }

  const [existing] = await db
    .select()
    .from(commercialAgreementsTable)
    .where(eq(commercialAgreementsTable.id, id))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "PROPOSAL_NOT_FOUND", message: "Proposta não encontrada." });
    return;
  }

  const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
  if (!reason) {
    res.status(400).json({
      error: "REASON_REQUIRED",
      code: "REASON_REQUIRED",
      message: "Justificativa obrigatória para retentativa de ativação.",
    });
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
    return await retryProposalActivation({
      id,
      crecheId: existing.crecheId,
      adminEmail: req.user?.email ?? `user_${req.user?.id}`,
      adminId: req.user?.id,
      reason,
      dbClient: tx,
    });
  };

  try {
    if (idempotencyKey) {
      validateIdempotencyKey(idempotencyKey);
      const result = await withCommercialOperationIdempotency({
        crecheId: existing.crecheId,
        operation: COMMERCIAL_OPERATIONS.RETRY_PROPOSAL_ACTIVATION,
        idempotencyKey,
        payload: req.body,
        resourceType: "commercial_agreement",
        isDbOnly: false,
        execute: async (tx) => {
          const retried = await executeAction(tx);
          return { statusCode: 200, data: retried, resourceId: retried.id };
        },
      });
      res.status(result.statusCode).json({
        ...(result.data as Record<string, unknown>),
        ...(result.replayed ? { replay: true } : {}),
      });
      return;
    }

    const retried = await executeAction();
    res.json(retried);
  } catch (err: any) {
    if (err instanceof CommercialProposalError) {
      res.status(err.statusCode).json({ error: err.code, code: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "RETRY_ACTIVATION_ERROR", message: err.message });
  }
});

// ==========================================================
// MASTER ADMIN PLATFORM SERVICES (Phase R36.G: Assisted Implementation)
// ==========================================================

commercialRouter.get("/platform-services", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const crecheId = req.params.crecheId ? Number(req.params.crecheId) : req.query.crecheId ? Number(req.query.crecheId) : null;
    const status = typeof req.query.status === "string" ? req.query.status : null;

    let query = db.select().from(platformServiceRequestsTable).$dynamic();
    const conditions = [];

    if (crecheId && !Number.isNaN(crecheId)) {
      conditions.push(eq(platformServiceRequestsTable.crecheId, crecheId));
    }
    if (status) {
      conditions.push(eq(platformServiceRequestsTable.status, status));
    }

    const requests = await (conditions.length > 0 ? query.where(and(...conditions)) : query).orderBy(
      desc(platformServiceRequestsTable.createdAt),
    );
    res.json(requests);
  } catch (err: any) {
    res.status(500).json({ error: "LIST_PLATFORM_SERVICES_ERROR", message: err.message });
  }
});

commercialRouter.get("/platform-services/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) {
      res.status(400).json({ error: "ID inválido." });
      return;
    }

    const [request] = await db
      .select()
      .from(platformServiceRequestsTable)
      .where(eq(platformServiceRequestsTable.id, id))
      .limit(1);

    if (!request) {
      res.status(404).json({ error: "REQUEST_NOT_FOUND", message: "Solicitação não encontrada." });
      return;
    }

    res.json(request);
  } catch (err: any) {
    res.status(500).json({ error: "GET_PLATFORM_SERVICE_ERROR", message: err.message });
  }
});

commercialRouter.post("/platform-services/:id/review", async (req: AuthRequest, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }

  const [existing] = await db.select().from(platformServiceRequestsTable).where(eq(platformServiceRequestsTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "REQUEST_NOT_FOUND", message: "Solicitação não encontrada." });
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
    return await reviewImplementationRequest({
      id,
      crecheId: existing.crecheId,
      adminId: req.user?.id,
      adminEmail: req.user?.email ?? `user_${req.user?.id}`,
      adminNotes: req.body.adminNotes,
      reason: req.body.reason,
      dbClient: tx,
    });
  };

  try {
    if (idempotencyKey) {
      validateIdempotencyKey(idempotencyKey);
      const result = await withCommercialOperationIdempotency({
        crecheId: existing.crecheId,
        operation: COMMERCIAL_OPERATIONS.REVIEW_IMPLEMENTATION_REQUEST,
        idempotencyKey,
        payload: req.body,
        resourceType: "platform_service_request",
        isDbOnly: true,
        execute: async (tx) => {
          const reviewed = await executeAction(tx);
          return { statusCode: 200, data: reviewed, resourceId: reviewed.id };
        },
      });
      res.status(result.statusCode).json({
        ...(result.data as Record<string, unknown>),
        ...(result.replayed ? { replay: true } : {}),
      });
      return;
    }

    const reviewed = await executeAction();
    res.json(reviewed);
  } catch (err: any) {
    if (err instanceof PlatformServiceError) {
      res.status(err.statusCode).json({ error: err.code, code: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "REVIEW_REQUEST_ERROR", message: err.message });
  }
});

commercialRouter.post("/platform-services/:id/quote", async (req: AuthRequest, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }

  const [existing] = await db.select().from(platformServiceRequestsTable).where(eq(platformServiceRequestsTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "REQUEST_NOT_FOUND", message: "Solicitação não encontrada." });
    return;
  }

  const { quotedPriceCents, scopeNotes, adminNotes, reason } = req.body;
  if (!reason || typeof reason !== "string" || !reason.trim()) {
    res.status(400).json({
      error: "REASON_REQUIRED",
      code: "REASON_REQUIRED",
      message: "Justificativa obrigatória para envio de orçamento.",
    });
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
    return await sendImplementationQuote({
      id,
      crecheId: existing.crecheId,
      quotedPriceCents: Number(quotedPriceCents),
      scopeNotes,
      adminNotes,
      adminId: req.user?.id,
      adminEmail: req.user?.email ?? `user_${req.user?.id}`,
      reason: reason.trim(),
      dbClient: tx,
    });
  };

  try {
    if (idempotencyKey) {
      validateIdempotencyKey(idempotencyKey);
      const result = await withCommercialOperationIdempotency({
        crecheId: existing.crecheId,
        operation: COMMERCIAL_OPERATIONS.SEND_IMPLEMENTATION_QUOTE,
        idempotencyKey,
        payload: req.body,
        resourceType: "platform_service_request",
        isDbOnly: true,
        execute: async (tx) => {
          const quoted = await executeAction(tx);
          return { statusCode: 200, data: quoted, resourceId: quoted.id };
        },
      });
      res.status(result.statusCode).json({
        ...(result.data as Record<string, unknown>),
        ...(result.replayed ? { replay: true } : {}),
      });
      return;
    }

    const quoted = await executeAction();
    res.json(quoted);
  } catch (err: any) {
    if (err instanceof PlatformServiceError) {
      res.status(err.statusCode).json({ error: err.code, code: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "SEND_QUOTE_ERROR", message: err.message });
  }
});

commercialRouter.post("/platform-services/:id/schedule", async (req: AuthRequest, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }

  const [existing] = await db.select().from(platformServiceRequestsTable).where(eq(platformServiceRequestsTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "REQUEST_NOT_FOUND", message: "Solicitação não encontrada." });
    return;
  }

  const { scheduledFor, adminNotes, reason } = req.body;
  if (!scheduledFor) {
    res.status(400).json({ error: "Data de agendamento obrigatória." });
    return;
  }
  if (!reason || typeof reason !== "string" || !reason.trim()) {
    res.status(400).json({
      error: "REASON_REQUIRED",
      code: "REASON_REQUIRED",
      message: "Justificativa obrigatória para agendamento.",
    });
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
    return await scheduleImplementation({
      id,
      crecheId: existing.crecheId,
      scheduledFor: new Date(scheduledFor),
      adminNotes,
      adminId: req.user?.id,
      adminEmail: req.user?.email ?? `user_${req.user?.id}`,
      reason: reason.trim(),
      dbClient: tx,
    });
  };

  try {
    if (idempotencyKey) {
      validateIdempotencyKey(idempotencyKey);
      const result = await withCommercialOperationIdempotency({
        crecheId: existing.crecheId,
        operation: COMMERCIAL_OPERATIONS.SCHEDULE_IMPLEMENTATION,
        idempotencyKey,
        payload: req.body,
        resourceType: "platform_service_request",
        isDbOnly: true,
        execute: async (tx) => {
          const scheduled = await executeAction(tx);
          return { statusCode: 200, data: scheduled, resourceId: scheduled.id };
        },
      });
      res.status(result.statusCode).json({
        ...(result.data as Record<string, unknown>),
        ...(result.replayed ? { replay: true } : {}),
      });
      return;
    }

    const scheduled = await executeAction();
    res.json(scheduled);
  } catch (err: any) {
    if (err instanceof PlatformServiceError) {
      res.status(err.statusCode).json({ error: err.code, code: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "SCHEDULE_ERROR", message: err.message });
  }
});

commercialRouter.post("/platform-services/:id/start", async (req: AuthRequest, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }

  const [existing] = await db.select().from(platformServiceRequestsTable).where(eq(platformServiceRequestsTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "REQUEST_NOT_FOUND", message: "Solicitação não encontrada." });
    return;
  }

  const { reason } = req.body;
  if (!reason || typeof reason !== "string" || !reason.trim()) {
    res.status(400).json({
      error: "REASON_REQUIRED",
      code: "REASON_REQUIRED",
      message: "Justificativa obrigatória para iniciar implantação.",
    });
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
    return await startImplementation({
      id,
      crecheId: existing.crecheId,
      adminId: req.user?.id,
      adminEmail: req.user?.email ?? `user_${req.user?.id}`,
      reason: reason.trim(),
      dbClient: tx,
    });
  };

  try {
    if (idempotencyKey) {
      validateIdempotencyKey(idempotencyKey);
      const result = await withCommercialOperationIdempotency({
        crecheId: existing.crecheId,
        operation: COMMERCIAL_OPERATIONS.START_IMPLEMENTATION,
        idempotencyKey,
        payload: req.body,
        resourceType: "platform_service_request",
        isDbOnly: true,
        execute: async (tx) => {
          const started = await executeAction(tx);
          return { statusCode: 200, data: started, resourceId: started.id };
        },
      });
      res.status(result.statusCode).json({
        ...(result.data as Record<string, unknown>),
        ...(result.replayed ? { replay: true } : {}),
      });
      return;
    }

    const started = await executeAction();
    res.json(started);
  } catch (err: any) {
    if (err instanceof PlatformServiceError) {
      res.status(err.statusCode).json({ error: err.code, code: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "START_ERROR", message: err.message });
  }
});

commercialRouter.post("/platform-services/:id/complete", async (req: AuthRequest, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }

  const [existing] = await db.select().from(platformServiceRequestsTable).where(eq(platformServiceRequestsTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "REQUEST_NOT_FOUND", message: "Solicitação não encontrada." });
    return;
  }

  const { completionNotes, reason } = req.body;
  if (!completionNotes || typeof completionNotes !== "string" || !completionNotes.trim()) {
    res.status(400).json({ error: "Notas de conclusão obrigatórias." });
    return;
  }
  if (!reason || typeof reason !== "string" || !reason.trim()) {
    res.status(400).json({
      error: "REASON_REQUIRED",
      code: "REASON_REQUIRED",
      message: "Justificativa obrigatória para conclusão.",
    });
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
    return await completeImplementation({
      id,
      crecheId: existing.crecheId,
      completionNotes: completionNotes.trim(),
      adminId: req.user?.id,
      adminEmail: req.user?.email ?? `user_${req.user?.id}`,
      reason: reason.trim(),
      dbClient: tx,
    });
  };

  try {
    if (idempotencyKey) {
      validateIdempotencyKey(idempotencyKey);
      const result = await withCommercialOperationIdempotency({
        crecheId: existing.crecheId,
        operation: COMMERCIAL_OPERATIONS.COMPLETE_IMPLEMENTATION,
        idempotencyKey,
        payload: req.body,
        resourceType: "platform_service_request",
        isDbOnly: true,
        execute: async (tx) => {
          const completed = await executeAction(tx);
          return { statusCode: 200, data: completed, resourceId: completed.id };
        },
      });
      res.status(result.statusCode).json({
        ...(result.data as Record<string, unknown>),
        ...(result.replayed ? { replay: true } : {}),
      });
      return;
    }

    const completed = await executeAction();
    res.json(completed);
  } catch (err: any) {
    if (err instanceof PlatformServiceError) {
      res.status(err.statusCode).json({ error: err.code, code: err.code, message: err.message });
      return;
    }
    res.status(500).json({ error: "COMPLETE_ERROR", message: err.message });
  }
});

commercialRouter.post("/platform-services/:id/cancel", async (req: AuthRequest, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!id || Number.isNaN(id)) {
    res.status(400).json({ error: "ID inválido." });
    return;
  }

  const [existing] = await db.select().from(platformServiceRequestsTable).where(eq(platformServiceRequestsTable.id, id)).limit(1);
  if (!existing) {
    res.status(404).json({ error: "REQUEST_NOT_FOUND", message: "Solicitação não encontrada." });
    return;
  }

  const { reason } = req.body;
  if (!reason || typeof reason !== "string" || !reason.trim()) {
    res.status(400).json({
      error: "REASON_REQUIRED",
      code: "REASON_REQUIRED",
      message: "Justificativa obrigatória para cancelamento.",
    });
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
    return await cancelImplementation({
      id,
      crecheId: existing.crecheId,
      actorRole: "master_admin",
      actorId: req.user?.id,
      actorEmail: req.user?.email ?? `user_${req.user?.id}`,
      reason: reason.trim(),
      dbClient: tx,
    });
  };

  try {
    if (idempotencyKey) {
      validateIdempotencyKey(idempotencyKey);
      const result = await withCommercialOperationIdempotency({
        crecheId: existing.crecheId,
        operation: COMMERCIAL_OPERATIONS.CANCEL_IMPLEMENTATION,
        idempotencyKey,
        payload: req.body,
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
    res.status(500).json({ error: "CANCEL_ERROR", message: err.message });
  }
});

// ─── Operational Commercial Notifications (R36.H) ───────────────────────────

commercialRouter.get(
  "/operational-notifications",
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { getCommercialNotificationsForUser } = await import("../services/commercialOutbox.js");
      const notifications = await getCommercialNotificationsForUser(userId, null, "master_admin");
      const unreadCount = notifications.filter((n) => !n.readAt).length;

      res.json({
        notifications,
        unreadCount,
      });
    } catch (err: any) {
      res.status(500).json({ error: "LIST_OPERATIONAL_NOTIFICATIONS_ERROR", message: err.message });
    }
  },
);

commercialRouter.post(
  "/operational-notifications/:id/read",
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const id = Number(req.params.id);
      if (!id || Number.isNaN(id)) {
        res.status(400).json({ error: "ID inválido." });
        return;
      }

      const { markCommercialNotificationAsRead } = await import("../services/commercialOutbox.js");
      const updated = await markCommercialNotificationAsRead(id, userId, null);
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

commercialRouter.post(
  "/operational-notifications/read-all",
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { markAllCommercialNotificationsAsRead } = await import("../services/commercialOutbox.js");
      const count = await markAllCommercialNotificationsAsRead(userId, null);

      res.json({ success: true, markedCount: count });
    } catch (err: any) {
      res.status(500).json({ error: "MARK_ALL_READ_ERROR", message: err.message });
    }
  },
);

// ─── R38.B Plan Versioning Routes ────────────────────────────────────────────

commercialRouter.get(
  "/plans/:planId/versions",
  async (req: AuthRequest, res: Response) => {
    try {
      const planId = Number(req.params.planId);
      if (!planId || Number.isNaN(planId)) {
        res.status(400).json({ error: "Invalid planId." });
        return;
      }
      const versions = await PlanVersionService.getVersions(planId);
      res.json({ versions });
    } catch (err: any) {
      res.status(500).json({ error: "GET_VERSIONS_ERROR", message: err.message });
    }
  },
);

commercialRouter.post(
  "/plans/:planId/versions",
  async (req: AuthRequest, res: Response) => {
    try {
      const planId = Number(req.params.planId);
      if (!planId || Number.isNaN(planId)) {
        res.status(400).json({ error: "Invalid planId." });
        return;
      }
      const { petLimit, priceBrl, prices, features, versionName, versionNumber } = req.body;
      const result = await PlanVersionService.createDraftVersion({
        planId,
        versionNumber,
        versionName,
        petLimit: Number(petLimit),
        priceBrl: priceBrl !== undefined ? Number(priceBrl) : undefined,
        features,
        prices,
        userId: req.user?.id,
      });
      res.status(201).json(result);
    } catch (err: any) {
      if (err instanceof PlanVersionError) {
        res.status(err.statusCode).json({ error: err.code, message: err.message });
        return;
      }
      res.status(500).json({ error: "CREATE_VERSION_ERROR", message: err.message });
    }
  },
);

commercialRouter.put(
  "/plans/:planId/versions/:versionNumber",
  async (req: AuthRequest, res: Response) => {
    try {
      const planId = Number(req.params.planId);
      const versionNumber = Number(req.params.versionNumber);
      if (!planId || Number.isNaN(planId) || !versionNumber || Number.isNaN(versionNumber)) {
        res.status(400).json({ error: "Invalid planId or versionNumber." });
        return;
      }
      const { petLimit, priceBrl, prices, features, versionName } = req.body;
      const result = await PlanVersionService.updateDraftVersion({
        planId,
        versionNumber,
        versionName,
        petLimit: petLimit !== undefined ? Number(petLimit) : undefined,
        priceBrl: priceBrl !== undefined ? Number(priceBrl) : undefined,
        features,
        prices,
      });
      res.json(result);
    } catch (err: any) {
      if (err instanceof PlanVersionError) {
        res.status(err.statusCode).json({ error: err.code, message: err.message });
        return;
      }
      res.status(500).json({ error: "UPDATE_VERSION_ERROR", message: err.message });
    }
  },
);

commercialRouter.delete(
  "/plans/:planId/versions/:versionNumber",
  async (req: AuthRequest, res: Response) => {
    try {
      const planId = Number(req.params.planId);
      const versionNumber = Number(req.params.versionNumber);
      if (!planId || Number.isNaN(planId) || !versionNumber || Number.isNaN(versionNumber)) {
        res.status(400).json({ error: "Invalid planId or versionNumber." });
        return;
      }
      await PlanVersionService.deleteDraftVersion(planId, versionNumber);
      res.status(204).send();
    } catch (err: any) {
      if (err instanceof PlanVersionError) {
        res.status(err.statusCode).json({ error: err.code, message: err.message });
        return;
      }
      res.status(500).json({ error: "DELETE_VERSION_ERROR", message: err.message });
    }
  },
);

commercialRouter.post(
  "/plans/:planId/versions/:versionNumber/activate",
  async (req: AuthRequest, res: Response) => {
    try {
      const planId = Number(req.params.planId);
      const versionNumber = Number(req.params.versionNumber);
      if (!planId || Number.isNaN(planId) || !versionNumber || Number.isNaN(versionNumber)) {
        res.status(400).json({ error: "Invalid planId or versionNumber." });
        return;
      }
      const { changeReason } = req.body;
      if (!changeReason || typeof changeReason !== "string" || !changeReason.trim()) {
        res.status(400).json({
          error: "ERR_CHANGE_REASON_REQUIRED",
          message: "Motivo da alteração é obrigatório para ativar uma versão.",
        });
        return;
      }

      const result = await PlanVersionService.activateVersion({
        planId,
        versionNumber,
        userId: req.user?.id ?? 1,
        changeReason: changeReason.trim(),
      });
      res.json({ success: true, version: result });
    } catch (err: any) {
      if (err instanceof PlanVersionError) {
        res.status(err.statusCode).json({ error: err.code, message: err.message });
        return;
      }
      if (err?.code === "23505" || err?.message?.includes("idx_plan_versions_one_active_per_plan")) {
        res.status(409).json({
          error: "ERR_CONCURRENT_VERSION_ACTIVATION",
          message: "Conflito de ativação concorrente de versão.",
        });
        return;
      }
      res.status(500).json({ error: "ACTIVATE_VERSION_ERROR", message: err.message });
    }
  },
);

commercialRouter.post(
  "/plans/:planId/versions/:versionNumber/archive",
  async (req: AuthRequest, res: Response) => {
    try {
      const planId = Number(req.params.planId);
      const versionNumber = Number(req.params.versionNumber);
      if (!planId || Number.isNaN(planId) || !versionNumber || Number.isNaN(versionNumber)) {
        res.status(400).json({ error: "Invalid planId or versionNumber." });
        return;
      }
      const result = await PlanVersionService.archiveVersion(planId, versionNumber);
      res.json({ success: true, version: result });
    } catch (err: any) {
      if (err instanceof PlanVersionError) {
        res.status(err.statusCode).json({ error: err.code, message: err.message });
        return;
      }
      res.status(500).json({ error: "ARCHIVE_VERSION_ERROR", message: err.message });
    }
  },
);

// ─── R38.B Webhook Replay Route (Atomic CAS Claim) ───────────────────────────

commercialRouter.post(
  "/billing-webhooks/:id/replay",
  async (req: AuthRequest, res: Response) => {
    try {
      const errorId = Number(req.params.id);
      if (!errorId || Number.isNaN(errorId)) {
        res.status(400).json({ error: "Invalid webhook error id." });
        return;
      }

      // TC-STP-14, 15, 16, 17: Atomic CAS claim PENDING_RECONCILIATION -> PROCESSING
      const [claimed] = await db
        .update(billingWebhookErrorsTable)
        .set({
          status: "PROCESSING",
          attemptCount: sql`${billingWebhookErrorsTable.attemptCount} + 1`,
          lastAttemptAt: sql`NOW()`,
        })
        .where(
          and(
            eq(billingWebhookErrorsTable.id, errorId),
            eq(billingWebhookErrorsTable.status, "PENDING_RECONCILIATION"),
          ),
        )
        .returning();

      if (!claimed) {
        const [existing] = await db
          .select()
          .from(billingWebhookErrorsTable)
          .where(eq(billingWebhookErrorsTable.id, errorId))
          .limit(1);

        if (!existing) {
          res.status(404).json({ error: "Webhook error not found." });
          return;
        }

        res.status(409).json({
          error: "replay_not_claimable",
          message: `Webhook error is in status '${existing.status}' and cannot be claimed for replay.`,
          status: existing.status,
        });
        return;
      }

      try {
        await dispatchWebhookBusinessLogic(claimed.rawPayload);

        const [resolved] = await db
          .update(billingWebhookErrorsTable)
          .set({
            status: "RESOLVED",
            resolvedAt: sql`NOW()`,
            resolvedBy: req.user?.email ?? "master_admin",
            resolutionNote: "Replayed successfully via admin endpoint",
          })
          .where(eq(billingWebhookErrorsTable.id, errorId))
          .returning();

        res.json({ success: true, status: "RESOLVED", error: resolved });
      } catch (dispatchErr: any) {
        // TC-STP-16: Failed replay increments attempt_count and resets to PENDING or FAILED_FINAL
        const nextStatus = claimed.attemptCount >= 5 ? "FAILED_FINAL" : "PENDING_RECONCILIATION";
        await db
          .update(billingWebhookErrorsTable)
          .set({
            status: nextStatus,
            errorMessage: dispatchErr?.message ?? String(dispatchErr),
          })
          .where(eq(billingWebhookErrorsTable.id, errorId));

        res.status(500).json({
          error: "replay_failed",
          message: dispatchErr?.message ?? String(dispatchErr),
          status: nextStatus,
        });
      }
    } catch (err: any) {
      res.status(500).json({ error: "REPLAY_ERROR", message: err.message });
    }
  },
);
