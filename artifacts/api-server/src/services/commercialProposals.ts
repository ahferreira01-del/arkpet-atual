import { db, type BillingInterval } from "@workspace/db";
import {
  commercialAgreementsTable,
  customerCommercialConditionsTable,
  subscriptionsTable,
  plansTable,
  crechesTable,
  assignedCommercialBenefitsTable,
  type CommercialAgreement,
  type CustomerCommercialCondition,
} from "@workspace/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { calculateEffectivePrice, PricingEngineError } from "./pricingEngine.js";
import { resolveCatalogPlanPrice, normalizeBillingInterval, CatalogPriceResolutionError } from "./catalogPricing.js";
import { logCommercialAudit } from "./commercialAudit.js";
import {
  executeStripeCommercialActivation,
  ACTIVATION_TIMING_MODES,
  type ActivationTimingMode,
  CommercialActivationError,
} from "./stripeCommercialActivation.js";

export class CommercialProposalError extends Error {
  public code: string;
  public statusCode: number;

  constructor(code: string, message: string, statusCode: number = 422) {
    super(message);
    this.name = "CommercialProposalError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface ProposalSnapshot {
  crecheId: number;
  planId?: number | null;
  planName?: string | null;
  billingInterval?: BillingInterval | null;
  catalogPriceCents?: number | null;
  pricingOverrideType: "none" | "fixed_amount" | "percentage";
  pricingOverrideValue?: number | null;
  displayedEffectivePriceCents: number;
  entitlementPetLimit?: number | null;
  prorationMode: ActivationTimingMode;
  validUntil?: string | null;
  predecessorConditionId?: number | null;
  executionRequirement: "ARKPET_ONLY" | "STRIPE_REQUIRED";
  title?: string | null;
  notes?: string | null;
  sentAt?: string | null;
  createdBy?: string | null;
}

export interface CreateProposalParams {
  crecheId: number;
  title: string;
  notes?: string | null;
  planId?: number | null;
  billingInterval?: BillingInterval | null;
  pricingOverrideType?: "none" | "fixed_amount" | "percentage";
  pricingOverrideValue?: number | null;
  entitlementPetLimit?: number | null;
  prorationMode?: ActivationTimingMode;
  validUntil?: Date | null;
  createdBy: string;
  dbClient?: any;
}

export async function createProposal(params: CreateProposalParams): Promise<CommercialAgreement> {
  const dbClient = params.dbClient ?? db;

  if (!params.crecheId || Number.isNaN(params.crecheId)) {
    throw new CommercialProposalError("INVALID_CRECHE_ID", "Creche inválida.", 400);
  }
  if (!params.title || typeof params.title !== "string" || params.title.trim().length === 0) {
    throw new CommercialProposalError("TITLE_REQUIRED", "Título da proposta é obrigatório.", 400);
  }

  const [creche] = await dbClient
    .select()
    .from(crechesTable)
    .where(eq(crechesTable.id, params.crecheId))
    .limit(1);

  if (!creche) {
    throw new CommercialProposalError("CRECHE_NOT_FOUND", "Creche não encontrada.", 404);
  }

  const [agreement] = await dbClient
    .insert(commercialAgreementsTable)
    .values({
      crecheId: params.crecheId,
      type: "commercial_proposal",
      status: "draft",
      title: params.title.trim(),
      notes: params.notes?.trim() ?? null,
      activationStatus: "not_started",
      validUntil: params.validUntil ?? null,
      createdBy: params.createdBy,
      snapshotJson: {
        planId: params.planId ?? null,
        billingInterval: params.billingInterval ?? null,
        pricingOverrideType: params.pricingOverrideType ?? "none",
        pricingOverrideValue: params.pricingOverrideValue ?? null,
        entitlementPetLimit: params.entitlementPetLimit ?? null,
        prorationMode: params.prorationMode ?? ACTIVATION_TIMING_MODES.EFFECTIVE_NOW_PRORATE,
      },
    })
    .returning();

  return agreement;
}

export interface UpdateDraftProposalParams {
  id: number;
  crecheId: number;
  title?: string;
  notes?: string | null;
  planId?: number | null;
  billingInterval?: BillingInterval | null;
  pricingOverrideType?: "none" | "fixed_amount" | "percentage";
  pricingOverrideValue?: number | null;
  entitlementPetLimit?: number | null;
  prorationMode?: ActivationTimingMode;
  validUntil?: Date | null;
  dbClient?: any;
}

export async function updateDraftProposal(params: UpdateDraftProposalParams): Promise<CommercialAgreement> {
  const dbClient = params.dbClient ?? db;

  const [existing] = await dbClient
    .select()
    .from(commercialAgreementsTable)
    .where(
      and(
        eq(commercialAgreementsTable.id, params.id),
        eq(commercialAgreementsTable.crecheId, params.crecheId),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new CommercialProposalError("PROPOSAL_NOT_FOUND", "Proposta não encontrada.", 404);
  }

  if (existing.status !== "draft") {
    throw new CommercialProposalError(
      "PROPOSAL_NOT_EDITABLE",
      `Apenas propostas em rascunho podem ser editadas (status atual: '${existing.status}').`,
      422,
    );
  }

  const prevSnapshot = (existing.snapshotJson as any) ?? {};
  const updatedSnapshot = {
    ...prevSnapshot,
    planId: params.planId !== undefined ? params.planId : prevSnapshot.planId,
    billingInterval: params.billingInterval !== undefined ? params.billingInterval : prevSnapshot.billingInterval,
    pricingOverrideType: params.pricingOverrideType !== undefined ? params.pricingOverrideType : prevSnapshot.pricingOverrideType,
    pricingOverrideValue: params.pricingOverrideValue !== undefined ? params.pricingOverrideValue : prevSnapshot.pricingOverrideValue,
    entitlementPetLimit: params.entitlementPetLimit !== undefined ? params.entitlementPetLimit : prevSnapshot.entitlementPetLimit,
    prorationMode: params.prorationMode !== undefined ? params.prorationMode : prevSnapshot.prorationMode,
  };

  const [updated] = await dbClient
    .update(commercialAgreementsTable)
    .set({
      title: params.title !== undefined ? params.title.trim() : existing.title,
      notes: params.notes !== undefined ? (params.notes?.trim() ?? null) : existing.notes,
      validUntil: params.validUntil !== undefined ? params.validUntil : existing.validUntil,
      snapshotJson: updatedSnapshot,
      updatedAt: new Date(),
    })
    .where(eq(commercialAgreementsTable.id, params.id))
    .returning();

  return updated;
}

export interface SendProposalParams {
  id: number;
  crecheId: number;
  senderEmail: string;
  senderId?: number;
  reason?: string;
  dbClient?: any;
}

export async function sendProposal(params: SendProposalParams): Promise<CommercialAgreement> {
  const dbClient = params.dbClient ?? db;

  const [existing] = await dbClient
    .select()
    .from(commercialAgreementsTable)
    .where(
      and(
        eq(commercialAgreementsTable.id, params.id),
        eq(commercialAgreementsTable.crecheId, params.crecheId),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new CommercialProposalError("PROPOSAL_NOT_FOUND", "Proposta não encontrada.", 404);
  }

  if (!params.reason || typeof params.reason !== "string" || params.reason.trim().length === 0) {
    throw new CommercialProposalError(
      "REASON_REQUIRED",
      "Justificativa obrigatória para envio de proposta comercial.",
      400,
    );
  }

  if (existing.status !== "draft") {
    throw new CommercialProposalError(
      "PROPOSAL_NOT_DRAFT",
      `Apenas propostas em rascunho podem ser enviadas (status atual: '${existing.status}').`,
      422,
    );
  }

  const [sub] = await dbClient
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.crecheId, params.crecheId))
    .limit(1);

  const rawSnapshot = (existing.snapshotJson as any) ?? {};
  const targetPlanId = rawSnapshot.planId ?? sub?.planId;
  const interval: BillingInterval =
    (rawSnapshot.billingInterval ? normalizeBillingInterval(rawSnapshot.billingInterval) : null) ??
    (sub?.billingInterval ? normalizeBillingInterval(sub.billingInterval) : null) ??
    "month";

  let catalogPriceCents: number | null = null;
  let planName: string | null = null;

  if (targetPlanId) {
    const [plan] = await dbClient
      .select()
      .from(plansTable)
      .where(eq(plansTable.id, targetPlanId))
      .limit(1);

    if (plan) {
      planName = plan.name;
      const resolvedCatalog = await resolveCatalogPlanPrice(plan, interval, dbClient);
      catalogPriceCents = resolvedCatalog.catalogPriceCents;
    }
  }

  const pricingOverrideType = rawSnapshot.pricingOverrideType ?? "none";
  const pricingOverrideValue = rawSnapshot.pricingOverrideValue ?? null;
  const entitlementPetLimit = rawSnapshot.entitlementPetLimit ?? null;

  let displayedEffectivePriceCents = catalogPriceCents ?? 0;
  if (catalogPriceCents !== null && pricingOverrideType !== "none") {
    const calc = calculateEffectivePrice({
      catalogPriceCents,
      pricingOverrideType,
      pricingOverrideValue,
    });
    displayedEffectivePriceCents = calc.finalEffectivePriceCents;
  }

  const executionRequirement: "ARKPET_ONLY" | "STRIPE_REQUIRED" =
    pricingOverrideType !== "none" || (targetPlanId && sub && targetPlanId !== sub.planId)
      ? "STRIPE_REQUIRED"
      : "ARKPET_ONLY";

  const predecessorConditionId = sub?.activeConditionId ?? null;

  const frozenSnapshot: ProposalSnapshot = {
    crecheId: params.crecheId,
    planId: targetPlanId,
    planName,
    billingInterval: interval,
    catalogPriceCents,
    pricingOverrideType,
    pricingOverrideValue,
    displayedEffectivePriceCents,
    entitlementPetLimit,
    prorationMode: rawSnapshot.prorationMode ?? ACTIVATION_TIMING_MODES.EFFECTIVE_NOW_PRORATE,
    validUntil: existing.validUntil ? existing.validUntil.toISOString() : null,
    predecessorConditionId,
    executionRequirement,
    title: existing.title,
    notes: existing.notes,
    sentAt: new Date().toISOString(),
    createdBy: existing.createdBy,
  };

  const [sent] = await dbClient
    .update(commercialAgreementsTable)
    .set({
      status: "sent",
      sentAt: new Date(),
      predecessorConditionId,
      snapshotJson: frozenSnapshot,
      termsSnapshot: frozenSnapshot,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(commercialAgreementsTable.id, params.id),
        eq(commercialAgreementsTable.status, "draft"),
      ),
    )
    .returning();

  if (!sent) {
    throw new CommercialProposalError(
      "PROPOSAL_STATE_CONFLICT",
      "Conflito de estado: a proposta foi modificada concorrentemente.",
      409,
    );
  }

  await logCommercialAudit({
    targetCrecheId: params.crecheId,
    actorType: "user",
    actorId: params.senderId,
    actorRole: "master_admin",
    actorEmail: params.senderEmail,
    action: "commercial_proposal_sent",
    reason: params.reason ? params.reason.trim() : `Envio de proposta comercial #${sent.id}`,
    executionRequirement,
    executionStatus: "pending",
    relatedAgreementId: sent.id,
    afterState: {
      status: "sent",
      displayedEffectivePriceCents,
      entitlementPetLimit,
      predecessorConditionId,
    },
  }, dbClient);

  return sent;
}

export interface SupersedeProposalParams {
  id: number;
  crecheId: number;
  supersededByAgreementId: number;
  adminEmail: string;
  adminId?: number;
  reason?: string;
  dbClient?: any;
}

export async function supersedeProposal(params: SupersedeProposalParams): Promise<CommercialAgreement> {
  const dbClient = params.dbClient ?? db;

  if (!params.reason || typeof params.reason !== "string" || params.reason.trim().length === 0) {
    throw new CommercialProposalError(
      "REASON_REQUIRED",
      "Justificativa obrigatória para substituição de proposta comercial.",
      400,
    );
  }

  const [superseded] = await dbClient
    .update(commercialAgreementsTable)
    .set({
      status: "superseded",
      supersededByAgreementId: params.supersededByAgreementId,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(commercialAgreementsTable.id, params.id),
        eq(commercialAgreementsTable.crecheId, params.crecheId),
        eq(commercialAgreementsTable.status, "sent"),
      ),
    )
    .returning();

  if (!superseded) {
    throw new CommercialProposalError(
      "PROPOSAL_STATE_CONFLICT",
      "Apenas propostas com status 'sent' podem ser substituídas.",
      409,
    );
  }

  await logCommercialAudit({
    targetCrecheId: params.crecheId,
    actorType: "user",
    actorId: params.adminId,
    actorRole: "master_admin",
    actorEmail: params.adminEmail,
    action: "commercial_proposal_superseded",
    reason: params.reason ? params.reason.trim() : `Proposta #${params.id} substituída pela proposta #${params.supersededByAgreementId}`,
    relatedAgreementId: superseded.id,
    afterState: {
      status: "superseded",
      supersededByAgreementId: params.supersededByAgreementId,
    },
  }, dbClient);

  return superseded;
}

export interface AcceptProposalParams {
  id: number;
  crecheId: number;
  userId: number;
  userEmail?: string;
  dbClient?: any;
  stripeClient?: any;
}

export interface AcceptProposalResult {
  success: boolean;
  agreement: CommercialAgreement;
  activationStatus: string;
  conditionId?: number;
  message: string;
}

export async function acceptProposal(params: AcceptProposalParams): Promise<AcceptProposalResult> {
  const dbClient = params.dbClient ?? db;

  const [agreement] = await dbClient
    .select()
    .from(commercialAgreementsTable)
    .where(
      and(
        eq(commercialAgreementsTable.id, params.id),
        eq(commercialAgreementsTable.crecheId, params.crecheId),
      ),
    )
    .limit(1);

  if (!agreement) {
    throw new CommercialProposalError("PROPOSAL_NOT_FOUND", "Proposta não encontrada.", 404);
  }

  if (agreement.status === "accepted") {
    return {
      success: true,
      agreement,
      activationStatus: agreement.activationStatus,
      conditionId: agreement.activatedConditionId ?? undefined,
      message: "Proposta já foi aceita anteriormente.",
    };
  }

  if (agreement.status !== "sent") {
    throw new CommercialProposalError(
      "PROPOSAL_STATE_CONFLICT",
      `A proposta não está mais disponível para aceite (status atual: '${agreement.status}').`,
      409,
    );
  }

  const now = new Date();
  if (agreement.validUntil && agreement.validUntil <= now) {
    throw new CommercialProposalError(
      "PROPOSAL_EXPIRED",
      "A proposta expirou e não pode mais ser aceita.",
      422,
    );
  }

  const [sub] = await dbClient
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.crecheId, params.crecheId))
    .limit(1);

  if ((sub?.activeConditionId ?? null) !== (agreement.predecessorConditionId ?? null)) {
    throw new CommercialProposalError(
      "PROPOSAL_REVALIDATION_REQUIRED",
      "O estado comercial da creche foi alterado após o envio da proposta. Revalidação necessária.",
      422,
    );
  }

  // Active temporal campaign conflict check (R36.G1 Sections 3 & 4)
  const [activeCampaignBenefit] = await dbClient
    .select({ id: assignedCommercialBenefitsTable.id, status: assignedCommercialBenefitsTable.status })
    .from(assignedCommercialBenefitsTable)
    .where(
      and(
        eq(assignedCommercialBenefitsTable.crecheId, params.crecheId),
        inArray(assignedCommercialBenefitsTable.status, [
          "pending",
          "pending_activation",
          "scheduled",
          "active",
          "restoration_review",
          "failed",
        ]),
      ),
    )
    .limit(1);

  if (activeCampaignBenefit) {
    throw new CommercialProposalError(
      "PROPOSAL_ACTIVE_CAMPAIGN_CONFLICT",
      `A creche possui um benefício de campanha comercial não terminal (status: '${activeCampaignBenefit.status}'). A proposta não pode ser aceita enquanto uma campanha controlar o ciclo de cobrança.`,
      422,
    );
  }

  const snapshot: ProposalSnapshot = ((agreement as any).termsSnapshot ?? agreement.snapshotJson) as any ?? {};

  if (snapshot.pricingOverrideType === "percentage" && snapshot.planId) {
    const [plan] = await dbClient
      .select()
      .from(plansTable)
      .where(eq(plansTable.id, snapshot.planId))
      .limit(1);

    if (plan) {
      const resolved = await resolveCatalogPlanPrice(plan, snapshot.billingInterval ?? "month", dbClient);
      const calc = calculateEffectivePrice({
        catalogPriceCents: resolved.catalogPriceCents,
        pricingOverrideType: "percentage",
        pricingOverrideValue: snapshot.pricingOverrideValue ?? 0,
      });

      if (calc.finalEffectivePriceCents !== snapshot.displayedEffectivePriceCents) {
        throw new CommercialProposalError(
          "PROPOSAL_REVALIDATION_REQUIRED",
          "O preço de catálogo foi alterado e o valor efetivo diverge da proposta. Revalidação necessária.",
          422,
        );
      }
    }
  }

  const [acceptedAgreement] = await dbClient
    .update(commercialAgreementsTable)
    .set({
      status: "accepted",
      acceptedAt: now,
      acceptedByUserId: params.userId,
      activationStatus: "pending_activation",
      updatedAt: now,
    })
    .where(
      and(
        eq(commercialAgreementsTable.id, params.id),
        eq(commercialAgreementsTable.status, "sent"),
      ),
    )
    .returning();

  if (!acceptedAgreement) {
    throw new CommercialProposalError(
      "PROPOSAL_STATE_CONFLICT",
      "Conflito de estado: a proposta foi modificada concorrentemente.",
      409,
    );
  }

  await logCommercialAudit({
    targetCrecheId: params.crecheId,
    actorType: "user",
    actorId: params.userId,
    actorRole: "creche_admin",
    actorEmail: params.userEmail,
    action: "commercial_proposal_accepted",
    reason: `Aceite formal da proposta comercial #${params.id}`,
    executionRequirement: snapshot.executionRequirement,
    executionStatus: "pending",
    relatedAgreementId: acceptedAgreement.id,
    afterState: {
      status: "accepted",
      acceptedAt: now.toISOString(),
      acceptedByUserId: params.userId,
      activationStatus: "pending_activation",
    },
  }, dbClient);

  let activationStatus = "pending_activation";
  let activatedConditionId: number | null = null;
  let activationError: string | null = null;

  try {
    if (snapshot.executionRequirement === "ARKPET_ONLY") {
      const [newCondition] = await dbClient
        .insert(customerCommercialConditionsTable)
        .values({
          crecheId: params.crecheId,
          planId: snapshot.planId ?? sub?.planId ?? null,
          pricingOverrideType: snapshot.pricingOverrideType ?? "none",
          pricingOverrideValue: snapshot.pricingOverrideValue ?? null,
          entitlementPetLimit: snapshot.entitlementPetLimit ?? null,
          validFrom: now,
          status: "active",
          predecessorId: agreement.predecessorConditionId ?? null,
          agreementId: acceptedAgreement.id,
          executionRequirement: "ARKPET_ONLY",
          syncStatus: "synced",
          snapshotBillingInterval: snapshot.billingInterval ?? "month",
          snapshotBasePriceCents: snapshot.catalogPriceCents ?? 0,
          lastSynchronizedAmountCents: snapshot.displayedEffectivePriceCents,
        })
        .returning();

      if (sub) {
        const updatePayload: any = {
          activeConditionId: newCondition.id,
          updatedAt: new Date(),
        };
        if (snapshot.entitlementPetLimit !== undefined && snapshot.entitlementPetLimit !== null) {
          updatePayload.petLimit = snapshot.entitlementPetLimit;
        }
        await dbClient
          .update(subscriptionsTable)
          .set(updatePayload)
          .where(eq(subscriptionsTable.id, sub.id));
      }

      activationStatus = "active";
      activatedConditionId = newCondition.id;

      await dbClient
        .update(commercialAgreementsTable)
        .set({
          activationStatus: "active",
          activatedConditionId: newCondition.id,
          updatedAt: new Date(),
        })
        .where(eq(commercialAgreementsTable.id, acceptedAgreement.id));
    } else if (snapshot.executionRequirement === "STRIPE_REQUIRED") {
      const [newCondition] = await dbClient
        .insert(customerCommercialConditionsTable)
        .values({
          crecheId: params.crecheId,
          planId: snapshot.planId ?? sub?.planId ?? null,
          pricingOverrideType: snapshot.pricingOverrideType ?? "none",
          pricingOverrideValue: snapshot.pricingOverrideValue ?? null,
          entitlementPetLimit: snapshot.entitlementPetLimit ?? null,
          validFrom: now,
          status: "pending_activation",
          predecessorId: agreement.predecessorConditionId ?? null,
          agreementId: acceptedAgreement.id,
          executionRequirement: "STRIPE_REQUIRED",
          syncStatus: "sync_pending",
          snapshotBillingInterval: snapshot.billingInterval ?? "month",
          snapshotBasePriceCents: snapshot.catalogPriceCents ?? 0,
          lastSynchronizedAmountCents: snapshot.displayedEffectivePriceCents,
        })
        .returning();

      try {
        const activationResult = await executeStripeCommercialActivation({
          crecheId: params.crecheId,
          conditionId: newCondition.id,
          prorationMode: snapshot.prorationMode ?? ACTIVATION_TIMING_MODES.EFFECTIVE_NOW_PRORATE,
          reason: `Ativação automática decorrente do aceite da proposta comercial #${acceptedAgreement.id}`,
          idempotencyKey: `proposal-activation-${acceptedAgreement.id}-${newCondition.id}`,
          actorId: params.userId,
          actorEmail: params.userEmail,
          dbClient,
          stripeClient: params.stripeClient,
        });

        if (activationResult.success) {
          activationStatus = "active";
          activatedConditionId = newCondition.id;

          await dbClient
            .update(commercialAgreementsTable)
            .set({
              activationStatus: "active",
              activatedConditionId: newCondition.id,
              updatedAt: new Date(),
            })
            .where(eq(commercialAgreementsTable.id, acceptedAgreement.id));
        }
      } catch (actErr: any) {
        activationStatus = "activation_failed";
        activationError = actErr?.message ?? String(actErr);

        await dbClient
          .update(commercialAgreementsTable)
          .set({
            activationStatus: "activation_failed",
            activationError,
            updatedAt: new Date(),
          })
          .where(eq(commercialAgreementsTable.id, acceptedAgreement.id));
      }
    }
  } catch (postCommitErr: any) {
    activationStatus = "activation_failed";
    activationError = postCommitErr?.message ?? String(postCommitErr);

    await dbClient
      .update(commercialAgreementsTable)
      .set({
        activationStatus: "activation_failed",
        activationError,
        updatedAt: new Date(),
      })
      .where(eq(commercialAgreementsTable.id, acceptedAgreement.id));
  }

  const finalRows = await dbClient
    .select()
    .from(commercialAgreementsTable)
    .where(eq(commercialAgreementsTable.id, acceptedAgreement.id))
    .limit(1);
  const finalAgreement = finalRows?.[0] ?? acceptedAgreement;

  return {
    success: true,
    agreement: finalAgreement,
    activationStatus,
    conditionId: activatedConditionId ?? undefined,
    message:
      activationStatus === "active"
        ? "Proposta aceita e condições comerciais ativadas com sucesso."
        : "Proposta aceita com sucesso. A ativação está em processamento ou aguardando intervenção operacional.",
  };
}

export interface DeclineProposalParams {
  id: number;
  crecheId: number;
  userId: number;
  userEmail?: string;
  reason?: string | null;
  dbClient?: any;
}

export async function declineProposal(params: DeclineProposalParams): Promise<CommercialAgreement> {
  const dbClient = params.dbClient ?? db;

  const [declined] = await dbClient
    .update(commercialAgreementsTable)
    .set({
      status: "declined",
      declinedAt: new Date(),
      declinedByUserId: params.userId,
      declineReason: params.reason ? params.reason.trim() : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(commercialAgreementsTable.id, params.id),
        eq(commercialAgreementsTable.crecheId, params.crecheId),
        eq(commercialAgreementsTable.status, "sent"),
      ),
    )
    .returning();

  if (!declined) {
    throw new CommercialProposalError(
      "PROPOSAL_STATE_CONFLICT",
      "A proposta não está mais disponível para recusa (não encontrada ou status alterado).",
      409,
    );
  }

  await logCommercialAudit({
    targetCrecheId: params.crecheId,
    actorType: "user",
    actorId: params.userId,
    actorRole: "creche_admin",
    actorEmail: params.userEmail,
    action: "commercial_proposal_declined",
    reason: params.reason ? params.reason.trim() : "Recusa de proposta comercial pelo cliente",
    relatedAgreementId: declined.id,
    afterState: {
      status: "declined",
      declineReason: params.reason ? params.reason.trim() : null,
    },
  }, dbClient);

  return declined;
}

export interface RetryProposalActivationParams {
  id: number;
  crecheId: number;
  adminEmail: string;
  adminId?: number;
  reason: string;
  dbClient?: any;
  stripeClient?: any;
}

export async function retryProposalActivation(params: RetryProposalActivationParams): Promise<CommercialAgreement> {
  const dbClient = params.dbClient ?? db;

  if (!params.reason || typeof params.reason !== "string" || params.reason.trim().length === 0) {
    throw new CommercialProposalError(
      "REASON_REQUIRED",
      "Justificativa obrigatória para retentativa de ativação de proposta.",
      400,
    );
  }

  const [agreement] = await dbClient
    .select()
    .from(commercialAgreementsTable)
    .where(
      and(
        eq(commercialAgreementsTable.id, params.id),
        eq(commercialAgreementsTable.crecheId, params.crecheId),
      ),
    )
    .limit(1);

  if (!agreement) {
    throw new CommercialProposalError("PROPOSAL_NOT_FOUND", "Proposta não encontrada.", 404);
  }

  if (agreement.status !== "accepted") {
    throw new CommercialProposalError(
      "PROPOSAL_NOT_ACCEPTED",
      `Apenas propostas aceitas podem ter ativação retentada (status atual: '${agreement.status}').`,
      422,
    );
  }

  if (agreement.activationStatus === "active") {
    return agreement;
  }

  const allowedRecoveryStatuses = ["not_started", "pending_activation", "activation_failed"];
  if (!allowedRecoveryStatuses.includes(agreement.activationStatus)) {
    throw new CommercialProposalError(
      "INVALID_ACTIVATION_STATUS",
      `Status de ativação '${agreement.activationStatus}' não permite retentativa.`,
      422,
    );
  }

  // Active temporal campaign conflict check (R36.G1 Sections 3 & 4)
  const [activeCampaignBenefit] = await dbClient
    .select({ id: assignedCommercialBenefitsTable.id, status: assignedCommercialBenefitsTable.status })
    .from(assignedCommercialBenefitsTable)
    .where(
      and(
        eq(assignedCommercialBenefitsTable.crecheId, params.crecheId),
        inArray(assignedCommercialBenefitsTable.status, [
          "pending",
          "pending_activation",
          "scheduled",
          "active",
          "restoration_review",
          "failed",
        ]),
      ),
    )
    .limit(1);

  if (activeCampaignBenefit) {
    throw new CommercialProposalError(
      "PROPOSAL_ACTIVE_CAMPAIGN_CONFLICT",
      `A creche possui um benefício de campanha comercial não terminal (status: '${activeCampaignBenefit.status}'). A ativação da proposta não pode sobrescrever a campanha.`,
      422,
    );
  }

  const snapshot: ProposalSnapshot = ((agreement as any).termsSnapshot ?? agreement.snapshotJson) as any ?? {};
  const now = new Date();

  const [sub] = await dbClient
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.crecheId, params.crecheId))
    .limit(1);

  if (snapshot.executionRequirement === "ARKPET_ONLY") {
    const [newCondition] = await dbClient
      .insert(customerCommercialConditionsTable)
      .values({
        crecheId: params.crecheId,
        planId: snapshot.planId ?? sub?.planId ?? null,
        pricingOverrideType: snapshot.pricingOverrideType ?? "none",
        pricingOverrideValue: snapshot.pricingOverrideValue ?? null,
        entitlementPetLimit: snapshot.entitlementPetLimit ?? null,
        validFrom: now,
        status: "active",
        predecessorId: agreement.predecessorConditionId ?? null,
        agreementId: agreement.id,
        executionRequirement: "ARKPET_ONLY",
        syncStatus: "synced",
        snapshotBillingInterval: snapshot.billingInterval ?? "month",
        snapshotBasePriceCents: snapshot.catalogPriceCents ?? 0,
        lastSynchronizedAmountCents: snapshot.displayedEffectivePriceCents,
      })
      .returning();

    if (sub) {
      const updatePayload: any = {
        activeConditionId: newCondition.id,
        updatedAt: new Date(),
      };
      if (snapshot.entitlementPetLimit !== undefined && snapshot.entitlementPetLimit !== null) {
        updatePayload.petLimit = snapshot.entitlementPetLimit;
      }
      await dbClient
        .update(subscriptionsTable)
        .set(updatePayload)
        .where(eq(subscriptionsTable.id, sub.id));
    }

    const [updated] = await dbClient
      .update(commercialAgreementsTable)
      .set({
        activationStatus: "active",
        activatedConditionId: newCondition.id,
        activationError: null,
        updatedAt: new Date(),
      })
      .where(eq(commercialAgreementsTable.id, agreement.id))
      .returning();

    await logCommercialAudit({
      targetCrecheId: params.crecheId,
      actorType: "user",
      actorId: params.adminId,
      actorRole: "master_admin",
      actorEmail: params.adminEmail,
      action: "commercial_proposal_activation_retried",
      reason: params.reason.trim(),
      executionRequirement: "ARKPET_ONLY",
      executionStatus: "success",
      relatedAgreementId: agreement.id,
      relatedConditionId: newCondition.id,
    }, dbClient);

    return updated;
  }

  // STRIPE_REQUIRED
  // Look for existing condition for this agreement, or create one if missing
  let [condition] = await dbClient
    .select()
    .from(customerCommercialConditionsTable)
    .where(
      and(
        eq(customerCommercialConditionsTable.agreementId, agreement.id),
        eq(customerCommercialConditionsTable.crecheId, params.crecheId),
      ),
    )
    .limit(1);

  if (!condition) {
    [condition] = await dbClient
      .insert(customerCommercialConditionsTable)
      .values({
        crecheId: params.crecheId,
        planId: snapshot.planId ?? sub?.planId ?? null,
        pricingOverrideType: snapshot.pricingOverrideType ?? "none",
        pricingOverrideValue: snapshot.pricingOverrideValue ?? null,
        entitlementPetLimit: snapshot.entitlementPetLimit ?? null,
        validFrom: now,
        status: "pending_activation",
        predecessorId: agreement.predecessorConditionId ?? null,
        agreementId: agreement.id,
        executionRequirement: "STRIPE_REQUIRED",
        syncStatus: "sync_pending",
        snapshotBillingInterval: snapshot.billingInterval ?? "month",
        snapshotBasePriceCents: snapshot.catalogPriceCents ?? 0,
        lastSynchronizedAmountCents: snapshot.displayedEffectivePriceCents,
      })
      .returning();
  }

  try {
    const activationResult = await executeStripeCommercialActivation({
      crecheId: params.crecheId,
      conditionId: condition.id,
      prorationMode: snapshot.prorationMode ?? ACTIVATION_TIMING_MODES.EFFECTIVE_NOW_PRORATE,
      reason: params.reason.trim(),
      idempotencyKey: `proposal-activation-retry-${agreement.id}-${condition.id}-${Date.now()}`,
      actorId: params.adminId,
      actorEmail: params.adminEmail,
      dbClient,
      stripeClient: params.stripeClient,
    });

    if (activationResult.success) {
      const [updated] = await dbClient
        .update(commercialAgreementsTable)
        .set({
          activationStatus: "active",
          activatedConditionId: condition.id,
          activationError: null,
          updatedAt: new Date(),
        })
        .where(eq(commercialAgreementsTable.id, agreement.id))
        .returning();

      await logCommercialAudit({
        targetCrecheId: params.crecheId,
        actorType: "user",
        actorId: params.adminId,
        actorRole: "master_admin",
        actorEmail: params.adminEmail,
        action: "commercial_proposal_activation_retried",
        reason: params.reason.trim(),
        executionRequirement: "STRIPE_REQUIRED",
        executionStatus: "success",
        relatedAgreementId: agreement.id,
        relatedConditionId: condition.id,
      }, dbClient);

      return updated;
    }
  } catch (err: any) {
    const [updated] = await dbClient
      .update(commercialAgreementsTable)
      .set({
        activationStatus: "activation_failed",
        activationError: err?.message ?? String(err),
        updatedAt: new Date(),
      })
      .where(eq(commercialAgreementsTable.id, agreement.id))
      .returning();

    await logCommercialAudit({
      targetCrecheId: params.crecheId,
      actorType: "user",
      actorId: params.adminId,
      actorRole: "master_admin",
      actorEmail: params.adminEmail,
      action: "commercial_proposal_activation_retried",
      reason: params.reason.trim(),
      executionRequirement: "STRIPE_REQUIRED",
      executionStatus: "failed",
      relatedAgreementId: agreement.id,
      relatedConditionId: condition.id,
      afterState: {
        error: err?.message ?? String(err),
      },
    }, dbClient);

    throw err;
  }

  return agreement;
}
