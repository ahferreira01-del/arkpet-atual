import { db, type BillingInterval } from "@workspace/db";
import {
  commercialCampaignsTable,
  commercialCampaignBenefitsTable,
  assignedCommercialBenefitsTable,
  benefitCycleConsumptionsTable,
  customerCommercialConditionsTable,
  subscriptionsTable,
  plansTable,
  crechesTable,
  type CommercialCampaign,
  type CommercialCampaignBenefit,
  type AssignedCommercialBenefit,
} from "@workspace/db/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import type Stripe from "stripe";
import { logCommercialAudit } from "./commercialAudit.js";
import { resolveCatalogPlanPrice } from "./catalogPricing.js";
import { calculateEffectivePrice } from "./pricingEngine.js";
import { transitionActiveCondition, assertConditionFullSnapshot } from "./commercialConditions.js";
import {
  executeStripeCampaignSchedule,
  releaseCampaignSchedule,
  ExistingStripeScheduleUnsupportedError,
} from "./stripeCampaignSchedule.js";
import { getUncachableStripeClient } from "../lib/stripeClient.js";

export class CommercialCampaignError extends Error {
  readonly code: string;
  readonly statusCode: number;
  constructor(message: string, code = "CAMPAIGN_ERROR", statusCode = 400) {
    super(message);
    this.name = "CommercialCampaignError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class CommercialCampaignIntegrityError extends CommercialCampaignError {
  constructor(message: string, code = "CAMPAIGN_INTEGRITY_ERROR") {
    super(message, code, 400);
    this.name = "CommercialCampaignIntegrityError";
  }
}

export class CommercialCampaignFavorableOnlyError extends CommercialCampaignError {
  constructor(message: string, code = "CAMPAIGN_NOT_FAVORABLE") {
    super(message, code, 422);
    this.name = "CommercialCampaignFavorableOnlyError";
  }
}

export class CommercialCampaignConflictError extends CommercialCampaignError {
  constructor(message: string, code = "CAMPAIGN_CONFLICT") {
    super(message, code, 409);
    this.name = "CommercialCampaignConflictError";
  }
}

export class CommercialCampaignNotActiveError extends CommercialCampaignError {
  constructor(message: string, code = "CAMPAIGN_NOT_ACTIVE") {
    super(message, code, 422);
    this.name = "CommercialCampaignNotActiveError";
  }
}

export interface CreateCampaignParams {
  name: string;
  description?: string;
  status?: "draft" | "active";
  eligibleFrom?: Date | null;
  eligibleUntil?: Date | null;
  priority?: number;
  assignmentMode?: "MASTER_ADMIN_SAFE_ASSIGNMENT";
  benefitType: "PERCENTAGE_DISCOUNT" | "FIXED_DISCOUNT" | "FIXED_PROMOTIONAL_PRICE";
  benefitValue: number;
  billingCycles: number;
  createdBy?: string;
}

export interface UpdateCampaignParams {
  name?: string;
  description?: string;
  status?: "draft" | "active" | "paused" | "closed" | "archived";
  eligibleFrom?: Date | null;
  eligibleUntil?: Date | null;
  priority?: number;
  benefitType?: "PERCENTAGE_DISCOUNT" | "FIXED_DISCOUNT" | "FIXED_PROMOTIONAL_PRICE";
  benefitValue?: number;
  billingCycles?: number;
  updatedBy?: string;
}

/**
 * Validates benefit definition constraints (Section 4, 5, 12).
 */
export function validateBenefitDefinition(
  benefitType: string,
  benefitValue: number,
  billingCycles: number,
): void {
  if (!Number.isInteger(billingCycles) || billingCycles <= 0 || billingCycles > 36) {
    throw new CommercialCampaignIntegrityError(
      "billingCycles deve ser um número inteiro positivo entre 1 e 36.",
      "INVALID_BILLING_CYCLES",
    );
  }

  if (!Number.isInteger(benefitValue)) {
    throw new CommercialCampaignIntegrityError("benefitValue deve ser um número inteiro.", "INVALID_BENEFIT_VALUE");
  }

  if (benefitType === "PERCENTAGE_DISCOUNT") {
    if (benefitValue <= 0 || benefitValue > 10000) {
      throw new CommercialCampaignIntegrityError(
        "Para PERCENTAGE_DISCOUNT, benefitValue deve representar basis points entre 1 e 10000 (ex: 1500 = 15%).",
        "INVALID_PERCENTAGE_BPS",
      );
    }
  } else if (benefitType === "FIXED_DISCOUNT") {
    if (benefitValue <= 0) {
      throw new CommercialCampaignIntegrityError(
        "Para FIXED_DISCOUNT, benefitValue deve ser um desconto positivo em centavos (> 0).",
        "INVALID_FIXED_DISCOUNT",
      );
    }
  } else if (benefitType === "FIXED_PROMOTIONAL_PRICE") {
    if (benefitValue <= 0) {
      throw new CommercialCampaignIntegrityError(
        "Para FIXED_PROMOTIONAL_PRICE, benefitValue deve ser um valor positivo em centavos (> 0).",
        "INVALID_FIXED_PRICE",
      );
    }
  } else {
    throw new CommercialCampaignIntegrityError(
      `Tipo de benefício inválido '${benefitType}'. Tipos suportados: PERCENTAGE_DISCOUNT, FIXED_DISCOUNT, FIXED_PROMOTIONAL_PRICE.`,
      "INVALID_BENEFIT_TYPE",
    );
  }
}

/**
 * Creates a new commercial campaign and its recurring benefit definition.
 */
export async function createCampaign(
  params: CreateCampaignParams,
  dbClient: any = db,
): Promise<{ campaign: CommercialCampaign; benefit: CommercialCampaignBenefit }> {
  if (!params.name || typeof params.name !== "string" || params.name.trim().length === 0) {
    throw new CommercialCampaignIntegrityError("name é obrigatório para a campanha.", "NAME_REQUIRED");
  }

  validateBenefitDefinition(params.benefitType, params.benefitValue, params.billingCycles);

  if (params.eligibleFrom && params.eligibleUntil && new Date(params.eligibleFrom) > new Date(params.eligibleUntil)) {
    throw new CommercialCampaignIntegrityError(
      "Data de início da elegibilidade não pode ser posterior à data de término.",
      "INVALID_ELIGIBILITY_WINDOW",
    );
  }

  return await dbClient.transaction(async (tx: any) => {
    const [campaign] = await tx
      .insert(commercialCampaignsTable)
      .values({
        name: params.name.trim(),
        description: params.description?.trim() || null,
        status: params.status ?? "draft",
        eligibleFrom: params.eligibleFrom ? new Date(params.eligibleFrom) : null,
        eligibleUntil: params.eligibleUntil ? new Date(params.eligibleUntil) : null,
        priority: params.priority ?? 0,
        assignmentMode: params.assignmentMode ?? "MASTER_ADMIN_SAFE_ASSIGNMENT",
        createdBy: params.createdBy ?? "master_admin",
      })
      .returning();

    const [benefit] = await tx
      .insert(commercialCampaignBenefitsTable)
      .values({
        campaignId: campaign.id,
        benefitType: params.benefitType,
        benefitValue: params.benefitValue,
        billingCycles: params.billingCycles,
      })
      .returning();

    await logCommercialAudit(
      {
        targetCrecheId: 1, // Global campaign audit
        actorType: "user",
        action: "commercial_campaign_created",
        reason: `Criação da campanha '${campaign.name}' com benefício ${benefit.benefitType}`,
        executionStatus: "SUCCESS",
        afterState: {
          campaignId: campaign.id,
          name: campaign.name,
          status: campaign.status,
          benefitType: benefit.benefitType,
          benefitValue: benefit.benefitValue,
          billingCycles: benefit.billingCycles,
        },
      },
      tx,
    );

    return { campaign, benefit };
  });
}

/**
 * Updates campaign metadata, status, or benefit definition.
 * Edits affect FUTURE assignments only; existing assigned benefit snapshots remain immutable (Section 40).
 */
export async function updateCampaign(
  campaignId: number,
  params: UpdateCampaignParams,
  dbClient: any = db,
): Promise<{ campaign: CommercialCampaign; benefit: CommercialCampaignBenefit }> {
  const [existing] = await dbClient
    .select()
    .from(commercialCampaignsTable)
    .where(eq(commercialCampaignsTable.id, campaignId))
    .limit(1);

  if (!existing) {
    throw new CommercialCampaignError(`Campanha #${campaignId} não encontrada.`, "CAMPAIGN_NOT_FOUND", 404);
  }

  if (params.eligibleFrom && params.eligibleUntil && new Date(params.eligibleFrom) > new Date(params.eligibleUntil)) {
    throw new CommercialCampaignError(
      "Data de início da elegibilidade não pode ser posterior à data de término.",
      "INVALID_ELIGIBILITY_WINDOW",
      400,
    );
  }

  return await dbClient.transaction(async (tx: any) => {
    const updateSet: Record<string, any> = { updatedAt: new Date() };
    if (params.name !== undefined) updateSet.name = params.name.trim();
    if (params.description !== undefined) updateSet.description = params.description?.trim() || null;
    if (params.status !== undefined) updateSet.status = params.status;
    if (params.eligibleFrom !== undefined) updateSet.eligibleFrom = params.eligibleFrom ? new Date(params.eligibleFrom) : null;
    if (params.eligibleUntil !== undefined) updateSet.eligibleUntil = params.eligibleUntil ? new Date(params.eligibleUntil) : null;
    if (params.priority !== undefined) updateSet.priority = params.priority;

    const [updatedCampaign] = await tx
      .update(commercialCampaignsTable)
      .set(updateSet)
      .where(eq(commercialCampaignsTable.id, campaignId))
      .returning();

    let [benefit] = await tx
      .select()
      .from(commercialCampaignBenefitsTable)
      .where(eq(commercialCampaignBenefitsTable.campaignId, campaignId))
      .limit(1);

    if (params.benefitType || params.benefitValue !== undefined || params.billingCycles !== undefined) {
      const newType = params.benefitType ?? benefit.benefitType;
      const newValue = params.benefitValue !== undefined ? params.benefitValue : benefit.benefitValue;
      const newCycles = params.billingCycles !== undefined ? params.billingCycles : benefit.billingCycles;

      validateBenefitDefinition(newType, newValue, newCycles);

      const [updatedBenefit] = await tx
        .update(commercialCampaignBenefitsTable)
        .set({
          benefitType: newType,
          benefitValue: newValue,
          billingCycles: newCycles,
        })
        .where(eq(commercialCampaignBenefitsTable.campaignId, campaignId))
        .returning();

      benefit = updatedBenefit;
    }

    await logCommercialAudit(
      {
        targetCrecheId: 1,
        actorType: "user",
        action: "commercial_campaign_updated",
        reason: `Atualização da campanha #${campaignId}`,
        executionStatus: "SUCCESS",
        beforeState: existing,
        afterState: updatedCampaign,
      },
      tx,
    );

    return { campaign: updatedCampaign, benefit };
  });
}

/**
 * Detailed assignment preview for a customer.
 */
export interface CrecheCampaignPreviewItem {
  crecheId: number;
  crecheName: string;
  eligible: boolean;
  ineligibilityReason: string | null;
  targetPlanId: number | null;
  targetPlanName: string | null;
  billingInterval: BillingInterval | null;
  catalogPriceCents: number;
  currentEffectivePriceCents: number;
  promotionalPriceCents: number;
  absoluteSavingsCents: number;
  percentageSavingsBps: number;
  billingCycles: number;
  firstPromotionalPeriodDate: string | null;
  expectedFinalPromotionalPeriodDate: string | null;
  restorationCommittedPriceCents: number;
  stripeSubscriptionId: string | null;
  hasActiveCampaignConflict: boolean;
  hasExistingStripeSchedule: boolean;
}

/**
 * Previews campaign assignment across one or more creches.
 * Strictly read-only, zero side effects (Section 43).
 */
export async function previewCampaignAssignment(
  campaignId: number,
  crecheIds: number[],
  dbClient: any = db,
  stripeClient?: Stripe,
): Promise<{ campaign: CommercialCampaign; benefit: CommercialCampaignBenefit; items: CrecheCampaignPreviewItem[] }> {
  const [campaign] = await dbClient
    .select()
    .from(commercialCampaignsTable)
    .where(eq(commercialCampaignsTable.id, campaignId))
    .limit(1);

  if (!campaign) {
    throw new CommercialCampaignError(`Campanha #${campaignId} não encontrada.`, "CAMPAIGN_NOT_FOUND", 404);
  }

  const [benefit] = await dbClient
    .select()
    .from(commercialCampaignBenefitsTable)
    .where(eq(commercialCampaignBenefitsTable.campaignId, campaignId))
    .limit(1);

  if (!benefit) {
    throw new CommercialCampaignError("Definição de benefício da campanha não encontrada.", "BENEFIT_NOT_FOUND", 404);
  }

  const stripe = stripeClient ?? (await getUncachableStripeClient());
  const results: CrecheCampaignPreviewItem[] = [];

  for (const crecheId of crecheIds) {
    const [creche] = await dbClient.select().from(crechesTable).where(eq(crechesTable.id, crecheId)).limit(1);
    if (!creche) {
      results.push({
        crecheId,
        crecheName: `Creche #${crecheId}`,
        eligible: false,
        ineligibilityReason: "Creche não encontrada.",
        targetPlanId: null,
        targetPlanName: null,
        billingInterval: null,
        catalogPriceCents: 0,
        currentEffectivePriceCents: 0,
        promotionalPriceCents: 0,
        absoluteSavingsCents: 0,
        percentageSavingsBps: 0,
        billingCycles: benefit.billingCycles,
        firstPromotionalPeriodDate: null,
        expectedFinalPromotionalPeriodDate: null,
        restorationCommittedPriceCents: 0,
        stripeSubscriptionId: null,
        hasActiveCampaignConflict: false,
        hasExistingStripeSchedule: false,
      });
      continue;
    }

    // 1. Check existing active subscription
    const [sub] = await dbClient
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.crecheId, crecheId))
      .limit(1);

    if (!sub || !sub.stripeSubscriptionId || sub.status === "cancelled") {
      results.push({
        crecheId,
        crecheName: creche.name,
        eligible: false,
        ineligibilityReason: "A creche não possui uma assinatura Stripe recorrente ativa.",
        targetPlanId: sub?.planId ?? null,
        targetPlanName: null,
        billingInterval: sub?.billingInterval as BillingInterval ?? null,
        catalogPriceCents: 0,
        currentEffectivePriceCents: 0,
        promotionalPriceCents: 0,
        absoluteSavingsCents: 0,
        percentageSavingsBps: 0,
        billingCycles: benefit.billingCycles,
        firstPromotionalPeriodDate: null,
        expectedFinalPromotionalPeriodDate: null,
        restorationCommittedPriceCents: 0,
        stripeSubscriptionId: sub?.stripeSubscriptionId ?? null,
        hasActiveCampaignConflict: false,
        hasExistingStripeSchedule: false,
      });
      continue;
    }

    const interval: BillingInterval = (sub.billingInterval as BillingInterval) || "month";

    // 2. Resolve plan and authoritative catalog price
    const [plan] = await dbClient.select().from(plansTable).where(eq(plansTable.id, sub.planId)).limit(1);
    if (!plan) {
      results.push({
        crecheId,
        crecheName: creche.name,
        eligible: false,
        ineligibilityReason: "Plano da assinatura não encontrado no catálogo.",
        targetPlanId: sub.planId,
        targetPlanName: null,
        billingInterval: interval,
        catalogPriceCents: 0,
        currentEffectivePriceCents: 0,
        promotionalPriceCents: 0,
        absoluteSavingsCents: 0,
        percentageSavingsBps: 0,
        billingCycles: benefit.billingCycles,
        firstPromotionalPeriodDate: null,
        expectedFinalPromotionalPeriodDate: null,
        restorationCommittedPriceCents: 0,
        stripeSubscriptionId: sub.stripeSubscriptionId,
        hasActiveCampaignConflict: false,
        hasExistingStripeSchedule: false,
      });
      continue;
    }

    let catalogPriceCents = 0;
    try {
      const resolvedCatalog = await resolveCatalogPlanPrice(plan, interval, dbClient);
      catalogPriceCents = resolvedCatalog.catalogPriceCents;
    } catch {
      catalogPriceCents = plan.priceBrl ?? 0;
    }

    // 3. Resolve current effective recurring price from active commercial condition (if any)
    let currentEffectivePriceCents = catalogPriceCents;
    if (sub.activeConditionId) {
      const [activeCond] = await dbClient
        .select()
        .from(customerCommercialConditionsTable)
        .where(eq(customerCommercialConditionsTable.id, sub.activeConditionId))
        .limit(1);

      if (activeCond && activeCond.status === "active") {
        const pricing = calculateEffectivePrice({
          catalogPriceCents,
          pricingOverrideType: (activeCond.pricingOverrideType as any) ?? "none",
          pricingOverrideValue: activeCond.pricingOverrideValue ?? null,
        });
        currentEffectivePriceCents = pricing.finalEffectivePriceCents;
      }
    }

    // 4. Calculate promotional recurring price
    // Financial semantics (Section 13, 22):
    let promotionalPriceCents = currentEffectivePriceCents;
    if (benefit.benefitType === "PERCENTAGE_DISCOUNT") {
      const calc = calculateEffectivePrice({
        catalogPriceCents,
        pricingOverrideType: "percentage",
        pricingOverrideValue: benefit.benefitValue,
      });
      promotionalPriceCents = calc.finalEffectivePriceCents;
    } else if (benefit.benefitType === "FIXED_DISCOUNT") {
      promotionalPriceCents = Math.max(0, currentEffectivePriceCents - benefit.benefitValue);
    } else if (benefit.benefitType === "FIXED_PROMOTIONAL_PRICE") {
      promotionalPriceCents = benefit.benefitValue;
    }

    // 5. Non-stacking campaign conflict check (Section 15, Correction 8)
    const [activeCampaign] = await dbClient
      .select({ id: assignedCommercialBenefitsTable.id, status: assignedCommercialBenefitsTable.status })
      .from(assignedCommercialBenefitsTable)
      .where(
        and(
          eq(assignedCommercialBenefitsTable.crecheId, crecheId),
          inArray(assignedCommercialBenefitsTable.status, [
            "pending_activation",
            "scheduled",
            "active",
            "restoration_review",
          ]),
        ),
      )
      .limit(1);

    const hasActiveCampaignConflict = Boolean(activeCampaign);

    // 6. Favorable-only automatic safety check (Section 17)
    const isFavorableOrEqual = promotionalPriceCents <= currentEffectivePriceCents;

    // 7. Check Stripe schedule eligibility
    let hasExistingStripeSchedule = false;
    let existingScheduleSupported = true;
    try {
      const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
      const scheduleId =
        typeof (stripeSub as any).schedule === "string"
          ? (stripeSub as any).schedule
          : (stripeSub as any).schedule?.id ?? null;

      if (scheduleId) {
        hasExistingStripeSchedule = true;
        existingScheduleSupported = false; // Unknown existing schedule fails closed
      }
    } catch {
      // Mock / network fallback
    }

    // Determine overall eligibility
    let eligible = true;
    let ineligibilityReason: string | null = null;

    if (hasActiveCampaignConflict) {
      eligible = false;
      ineligibilityReason = "Creche já possui um benefício de campanha recorrente ativo ou agendado.";
    } else if (!isFavorableOrEqual) {
      eligible = false;
      ineligibilityReason = `O preço promocional (R$ ${(promotionalPriceCents / 100).toFixed(2)}) é maior que o preço efetivo atual (R$ ${(currentEffectivePriceCents / 100).toFixed(2)}).`;
    } else if (hasExistingStripeSchedule && !existingScheduleSupported) {
      eligible = false;
      ineligibilityReason = "A assinatura Stripe já possui um Subscription Schedule externo. Falha segura ativada.";
    }

    const absoluteSavingsCents = Math.max(0, currentEffectivePriceCents - promotionalPriceCents);
    const percentageSavingsBps =
      currentEffectivePriceCents > 0 ? Math.round((absoluteSavingsCents / currentEffectivePriceCents) * 10000) : 0;

    const firstPeriodDate = sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null;

    results.push({
      crecheId,
      crecheName: creche.name,
      eligible,
      ineligibilityReason,
      targetPlanId: plan.id,
      targetPlanName: plan.name,
      billingInterval: interval,
      catalogPriceCents,
      currentEffectivePriceCents,
      promotionalPriceCents,
      absoluteSavingsCents,
      percentageSavingsBps,
      billingCycles: benefit.billingCycles,
      firstPromotionalPeriodDate: firstPeriodDate,
      expectedFinalPromotionalPeriodDate: null, // Computed upon scheduling
      restorationCommittedPriceCents: currentEffectivePriceCents,
      stripeSubscriptionId: sub.stripeSubscriptionId,
      hasActiveCampaignConflict,
      hasExistingStripeSchedule,
    });
  }

  return { campaign, benefit, items: results };
}

/**
 * Assigns a commercial campaign to a single creche (Section 10, 13, 17, 18, 44; Correction 12).
 * Strictly single-target contract per operation request.
 */
export async function assignCampaignToCreche(params: {
  campaignId: number;
  crecheId: number;
  assignedBy?: string;
  reason?: string;
  dbClient?: any;
  stripeClient?: Stripe;
}): Promise<{
  assignedBenefit: AssignedCommercialBenefit;
  promotionalConditionId: number;
  stripeScheduleId: string;
  scheduledStartPeriod: Date;
}> {
  const dbClient = params.dbClient ?? db;
  const stripe = params.stripeClient ?? (await getUncachableStripeClient());

  // 1. Preview eligibility and terms
  const preview = await previewCampaignAssignment(params.campaignId, [params.crecheId], dbClient, stripe);
  const target = preview.items[0];

  if (!target || !target.eligible) {
    throw new CommercialCampaignError(
      `A creche #${params.crecheId} não é elegível para a campanha: ${target?.ineligibilityReason || "Critérios não atendidos"}`,
      "ASSIGNMENT_INELIGIBLE",
      422,
    );
  }

  // Verify campaign eligibility window (Section 6)
  const now = new Date();
  if (preview.campaign.eligibleFrom && new Date(preview.campaign.eligibleFrom) > now) {
    throw new CommercialCampaignError("A janela de elegibilidade da campanha ainda não iniciou.", "WINDOW_NOT_STARTED", 422);
  }
  if (preview.campaign.eligibleUntil && new Date(preview.campaign.eligibleUntil) < now) {
    throw new CommercialCampaignError("A janela de elegibilidade da campanha já expirou.", "WINDOW_EXPIRED", 422);
  }
  if (preview.campaign.status !== "active") {
    throw new CommercialCampaignError(
      `Campanha não está ativa para novas atribuições (status: ${preview.campaign.status}).`,
      "CAMPAIGN_NOT_ACTIVE",
      422,
    );
  }

  const [sub] = await dbClient
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.crecheId, params.crecheId))
    .limit(1);

  return await dbClient.transaction(async (tx: any) => {
    // 2. Create immutable Assigned Commercial Benefit Snapshot (Section 13, 18)
    const [assignedBenefit] = await tx
      .insert(assignedCommercialBenefitsTable)
      .values({
        campaignId: preview.campaign.id,
        campaignBenefitId: preview.benefit.id,
        crecheId: params.crecheId,
        status: "pending_activation",
        campaignName: preview.campaign.name,
        benefitType: preview.benefit.benefitType,
        benefitValue: preview.benefit.benefitValue,
        billingCycles: preview.benefit.billingCycles,
        targetPlanId: target.targetPlanId!,
        targetBillingInterval: target.billingInterval!,
        catalogPriceCents: target.catalogPriceCents,
        predecessorConditionId: sub.activeConditionId ?? null,
        predecessorEffectivePriceCents: target.currentEffectivePriceCents,
        promotionalPriceCents: target.promotionalPriceCents,
        restorationPriceCents: target.restorationCommittedPriceCents,
        stripeSubscriptionId: target.stripeSubscriptionId!,
        assignedBy: params.assignedBy ?? "master_admin",
      })
      .returning();

    // 3. Create promotional commercial condition (Section 21, 22)
    const pricingOverrideType = preview.benefit.benefitType === "PERCENTAGE_DISCOUNT" ? "percentage" : "fixed_amount";
    const pricingOverrideValue =
      preview.benefit.benefitType === "PERCENTAGE_DISCOUNT"
        ? preview.benefit.benefitValue
        : target.promotionalPriceCents;

    const promoConditionSnapshot = {
      crecheId: params.crecheId,
      planId: target.targetPlanId!,
      pricingOverrideType,
      pricingOverrideValue,
      entitlementPetLimit: null,
      snapshotBillingInterval: target.billingInterval!,
      snapshotBasePriceCents: target.catalogPriceCents,
      lastSynchronizedAmountCents: target.promotionalPriceCents,
      validFrom: new Date(),
      status: "pending_activation",
      executionRequirement: "STRIPE_REQUIRED",
      syncStatus: "sync_pending",
      reason: `Benefício da campanha '${preview.campaign.name}' (${preview.benefit.billingCycles} ciclos)`,
      assignedBenefitId: assignedBenefit.id,
    };

    assertConditionFullSnapshot(promoConditionSnapshot as any);

    const [promoCondition] = await tx
      .insert(customerCommercialConditionsTable)
      .values(promoConditionSnapshot as any)
      .returning();

    // Link commercial condition to assigned benefit
    await tx
      .update(assignedCommercialBenefitsTable)
      .set({ commercialConditionId: promoCondition.id })
      .where(eq(assignedCommercialBenefitsTable.id, assignedBenefit.id));

    // 4. External Stripe Schedule Execution (Section 25, Correction 3, 4, 5, 6)
    const scheduleResult = await executeStripeCampaignSchedule({
      assignedBenefitId: assignedBenefit.id,
      campaignId: preview.campaign.id,
      crecheId: params.crecheId,
      stripeSubscriptionId: target.stripeSubscriptionId!,
      billingInterval: target.billingInterval!,
      billingCycles: preview.benefit.billingCycles,
      promotionalPriceCents: target.promotionalPriceCents,
      restorationPriceCents: target.restorationCommittedPriceCents,
      stripeClient: stripe,
      dbClient: tx,
    });

    // Update commercial condition with promotional Stripe Price ID
    await tx
      .update(customerCommercialConditionsTable)
      .set({
        stripePriceId: scheduleResult.promotionalStripePriceId,
        syncStatus: "synced",
        updatedAt: new Date(),
      })
      .where(eq(customerCommercialConditionsTable.id, promoCondition.id));

    await logCommercialAudit(
      {
        targetCrecheId: params.crecheId,
        actorType: "user",
        actorId: 1,
        actorRole: "master_admin",
        actorEmail: params.assignedBy ?? "master_admin",
        action: "commercial_campaign_assigned",
        reason: `Atribuição da campanha '${preview.campaign.name}' à creche #${params.crecheId}`,
        executionRequirement: "STRIPE_REQUIRED",
        executionStatus: "SUCCESS",
        relatedConditionId: promoCondition.id,
        afterState: {
          campaignId: preview.campaign.id,
          assignedBenefitId: assignedBenefit.id,
          stripeScheduleId: scheduleResult.stripeScheduleId,
          promotionalPriceCents: target.promotionalPriceCents,
          restorationPriceCents: target.restorationCommittedPriceCents,
          billingCycles: preview.benefit.billingCycles,
        },
      },
      tx,
    );

    const [finalAssigned] = await tx
      .select()
      .from(assignedCommercialBenefitsTable)
      .where(eq(assignedCommercialBenefitsTable.id, assignedBenefit.id))
      .limit(1);

    return {
      assignedBenefit: finalAssigned,
      promotionalConditionId: promoCondition.id,
      stripeScheduleId: scheduleResult.stripeScheduleId,
      scheduledStartPeriod: scheduleResult.scheduledStartPeriod,
    };
  });
}

/**
 * Reconciles billing cycle advancement from Stripe subscription state (Section 31, 32, 33, 34, 35; Correction 9).
 * Idempotently counts qualifying contractual billing periods into benefit_cycle_consumptions.
 */
export async function reconcileBenefitCycleAdvancement(params: {
  crecheId: number;
  stripeSubscriptionId: string;
  contractualPeriodStart: Date;
  contractualPeriodEnd: Date;
  sourceReferenceId?: string;
  dbClient?: any;
  stripeClient?: Stripe;
}): Promise<{ cycleConsumed: boolean; cycleNumber: number; assignedBenefitId?: number; completed?: boolean }> {
  const dbClient = params.dbClient ?? db;
  const stripe = params.stripeClient ?? (await getUncachableStripeClient());

  // Canonical cycleKey: <subscriptionId>:<periodStartTs>:<periodEndTs> (Section 31)
  const cycleKey = `${params.stripeSubscriptionId}:${params.contractualPeriodStart.getTime()}:${params.contractualPeriodEnd.getTime()}`;

  // Find assigned benefit in scheduled or active status for this creche
  const [assignedBenefit] = await dbClient
    .select()
    .from(assignedCommercialBenefitsTable)
    .where(
      and(
        eq(assignedCommercialBenefitsTable.crecheId, params.crecheId),
        inArray(assignedCommercialBenefitsTable.status, ["scheduled", "active"]),
      ),
    )
    .limit(1);

  if (!assignedBenefit) {
    return { cycleConsumed: false, cycleNumber: 0 };
  }

  // If status is 'scheduled', this period advancement marks the entry into the promotional phase!
  if (assignedBenefit.status === "scheduled") {
    if (assignedBenefit.commercialConditionId) {
      await transitionActiveCondition(params.crecheId, assignedBenefit.commercialConditionId, dbClient);
    }
    await dbClient
      .update(assignedCommercialBenefitsTable)
      .set({
        status: "active",
        firstConsumedPeriodStart: params.contractualPeriodStart,
        updatedAt: new Date(),
      })
      .where(eq(assignedCommercialBenefitsTable.id, assignedBenefit.id));

    await logCommercialAudit(
      {
        targetCrecheId: params.crecheId,
        actorType: "gateway",
        action: "campaign_pricing_activated",
        reason: `Início do período promocional da campanha '${assignedBenefit.campaignName}'`,
        executionStatus: "SUCCESS",
        relatedConditionId: assignedBenefit.commercialConditionId ?? undefined,
        afterState: { status: "active", periodStart: params.contractualPeriodStart },
      },
      dbClient,
    );
  }

  // Check if this contractual cycle was already consumed (Idempotency, Section 32)
  const [existingConsumption] = await dbClient
    .select()
    .from(benefitCycleConsumptionsTable)
    .where(
      and(
        eq(benefitCycleConsumptionsTable.assignedBenefitId, assignedBenefit.id),
        eq(benefitCycleConsumptionsTable.cycleKey, cycleKey),
      ),
    )
    .limit(1);

  if (existingConsumption) {
    return {
      cycleConsumed: false,
      cycleNumber: existingConsumption.cycleNumber,
      assignedBenefitId: assignedBenefit.id,
    };
  }

  // Count prior consumed cycles
  const consumptions = await dbClient
    .select()
    .from(benefitCycleConsumptionsTable)
    .where(eq(benefitCycleConsumptionsTable.assignedBenefitId, assignedBenefit.id));

  const priorCount = consumptions.length;

  if (priorCount >= assignedBenefit.billingCycles) {
    // All promotional cycles have already been consumed.
    // The arrival of this contractual period indicates we have moved into the post-promotional restoration period!
    const restoration = await reconcileCampaignRestoration({
      assignedBenefitId: assignedBenefit.id,
      dbClient,
      stripeClient: stripe,
    });
    return {
      cycleConsumed: false,
      cycleNumber: priorCount,
      assignedBenefitId: assignedBenefit.id,
      completed: restoration.completed,
    };
  }

  const cycleNumber = priorCount + 1;

  // Insert cycle consumption for promotional cycle
  await dbClient.insert(benefitCycleConsumptionsTable).values({
    assignedBenefitId: assignedBenefit.id,
    cycleKey,
    contractualPeriodStart: params.contractualPeriodStart,
    contractualPeriodEnd: params.contractualPeriodEnd,
    cycleNumber,
    source: "stripe_subscription_cycle",
    sourceReferenceId: params.sourceReferenceId ?? null,
  });

  await dbClient
    .update(assignedCommercialBenefitsTable)
    .set({
      lastConsumedPeriodEnd: params.contractualPeriodEnd,
      updatedAt: new Date(),
    })
    .where(eq(assignedCommercialBenefitsTable.id, assignedBenefit.id));

  await logCommercialAudit(
    {
      targetCrecheId: params.crecheId,
      actorType: "gateway",
      action: "campaign_cycle_consumed",
      reason: `Consumo do ciclo ${cycleNumber}/${assignedBenefit.billingCycles} da campanha '${assignedBenefit.campaignName}'`,
      executionStatus: "SUCCESS",
      afterState: { cycleNumber, cycleKey, totalCycles: assignedBenefit.billingCycles },
    },
    dbClient,
  );

  return { cycleConsumed: true, cycleNumber, assignedBenefitId: assignedBenefit.id, completed: false };
}

/**
 * Reconciles campaign completion and deterministic restoration (Section 18, 19, 37, 38; Correction 7, 10).
 */
export async function reconcileCampaignRestoration(params: {
  assignedBenefitId: number;
  dbClient?: any;
  stripeClient?: Stripe;
}): Promise<{ completed: boolean; status: string }> {
  const dbClient = params.dbClient ?? db;
  const stripe = params.stripeClient ?? (await getUncachableStripeClient());

  const [assignedBenefit] = await dbClient
    .select()
    .from(assignedCommercialBenefitsTable)
    .where(eq(assignedCommercialBenefitsTable.id, params.assignedBenefitId))
    .limit(1);

  if (!assignedBenefit) {
    return { completed: false, status: "not_found" };
  }

  // Read current subscription from Stripe to confirm transition to restoration Price (Section 38)
  const stripeSub = await stripe.subscriptions.retrieve(assignedBenefit.stripeSubscriptionId);
  const currentPriceId = stripeSub.items?.data?.[0]?.price?.id;

  const matchesRestorationPrice =
    currentPriceId === assignedBenefit.restorationStripePriceId ||
    (assignedBenefit.restorationStripePriceId && currentPriceId?.includes(assignedBenefit.restorationStripePriceId));

  // If Stripe has moved to restoration Price:
  if (matchesRestorationPrice) {
    return await dbClient.transaction(async (tx: any) => {
      // 1. Create successor restoration condition (Section 19)
      const restoreSnapshot = {
        crecheId: assignedBenefit.crecheId,
        planId: assignedBenefit.targetPlanId,
        pricingOverrideType: "fixed_amount",
        pricingOverrideValue: assignedBenefit.restorationPriceCents,
        entitlementPetLimit: null,
        snapshotBillingInterval: assignedBenefit.targetBillingInterval,
        snapshotBasePriceCents: assignedBenefit.catalogPriceCents,
        lastSynchronizedAmountCents: assignedBenefit.restorationPriceCents,
        validFrom: new Date(),
        status: "pending_activation",
        executionRequirement: "STRIPE_REQUIRED",
        syncStatus: "synced",
        stripePriceId: assignedBenefit.restorationStripePriceId,
        reason: `Restauração garantida pré-campanha '${assignedBenefit.campaignName}'`,
        assignedBenefitId: assignedBenefit.id,
      };

      assertConditionFullSnapshot(restoreSnapshot as any);

      const [restoreCond] = await tx
        .insert(customerCommercialConditionsTable)
        .values(restoreSnapshot as any)
        .returning();

      // 2. Transition active condition to restoration condition
      await transitionActiveCondition(assignedBenefit.crecheId, restoreCond.id, tx);

      // 3. Release ArkPet-owned Subscription Schedule (Section 7)
      if (assignedBenefit.stripeScheduleId) {
        await releaseCampaignSchedule(assignedBenefit.stripeScheduleId, stripe);
      }

      // 4. Mark assigned benefit completed
      await tx
        .update(assignedCommercialBenefitsTable)
        .set({
          status: "completed",
          restorationConditionId: restoreCond.id,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(assignedCommercialBenefitsTable.id, assignedBenefit.id));

      await logCommercialAudit(
        {
          targetCrecheId: assignedBenefit.crecheId,
          actorType: "system",
          action: "commercial_campaign_completed",
          reason: `Campanha '${assignedBenefit.campaignName}' concluída com restauração protegida em R$ ${(assignedBenefit.restorationPriceCents / 100).toFixed(2)}`,
          executionStatus: "SUCCESS",
          relatedConditionId: restoreCond.id,
          afterState: {
            status: "completed",
            restorationConditionId: restoreCond.id,
            restorationPriceCents: assignedBenefit.restorationPriceCents,
          },
        },
        tx,
      );

      return { completed: true, status: "completed" };
    });
  }

  // If Stripe differs: flag restoration_review / failed (Section 38)
  await dbClient
    .update(assignedCommercialBenefitsTable)
    .set({
      status: "restoration_review",
      failureReason: `Assinatura Stripe possui o preço '${currentPriceId}', diferente do esperado '${assignedBenefit.restorationStripePriceId}'.`,
      updatedAt: new Date(),
    })
    .where(eq(assignedCommercialBenefitsTable.id, assignedBenefit.id));

  await logCommercialAudit(
    {
      targetCrecheId: assignedBenefit.crecheId,
      actorType: "system",
      action: "campaign_restoration_divergent",
      reason: `Divergência ao tentar restaurar preço da campanha '${assignedBenefit.campaignName}'`,
      executionStatus: "failed",
      afterState: {
        status: "restoration_review",
        currentPriceId,
        expectedPriceId: assignedBenefit.restorationStripePriceId,
      },
    },
    dbClient,
  );

  return { completed: false, status: "restoration_review" };
}
