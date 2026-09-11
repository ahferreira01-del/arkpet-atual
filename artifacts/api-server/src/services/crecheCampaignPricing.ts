import {
  type CampaignBenefitType,
  type CampaignStatus,
  type CampaignAudienceType,
  type CampaignInteractionPolicy,
  type CampaignUsageLimitType,
  type CrechePromotionalCampaign,
} from "@workspace/db/schema";
import {
  decimalStringToCents,
  centsToDecimalString,
  resolveBasePriceCents,
  type ResolvedPriceSnapshot,
} from "./tutorCommercialPricing.js";

// ─── Domain Errors ────────────────────────────────────────────────────────────

export class CrecheCampaignError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "CrecheCampaignError";
    this.status = status;
  }
}

export class CrecheCampaignValidationError extends CrecheCampaignError {
  constructor(message: string) {
    super(message, 422);
    this.name = "CrecheCampaignValidationError";
  }
}

export class CrecheCampaignNotFoundError extends CrecheCampaignError {
  constructor(message: string) {
    super(message, 404);
    this.name = "CrecheCampaignNotFoundError";
  }
}

export class CrecheCampaignConflictError extends CrecheCampaignError {
  constructor(message: string) {
    super(message, 409);
    this.name = "CrecheCampaignConflictError";
  }
}

export class CrecheCampaignForbiddenError extends CrecheCampaignError {
  constructor(message: string) {
    super(message, 403);
    this.name = "CrecheCampaignForbiddenError";
  }
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface CampaignBenefitInput {
  benefitType: CampaignBenefitType;
  percentageBps?: number | null;
  fixedDiscountCents?: number | null;
  fixedPromotionalPriceCents?: number | null;
}

export interface CampaignPricingResult {
  baseUnitPriceCents: number;
  effectiveUnitPriceCents: number;
  unitDiscountCents: number;
  baseUnitPrice: string;
  effectiveUnitPrice: string;
  unitDiscount: string;
  quantity: number;
  baseLineTotalCents: number;
  discountLineTotalCents: number;
  finalLineTotalCents: number;
  baseLineTotal: string;
  discountLineTotal: string;
  finalLineTotal: string;
  pricingSource: "CAMPAIGN";
  campaignId: number | null;
  snapshot: {
    campaignId: number | null;
    benefitType: CampaignBenefitType;
    percentageBps: number | null;
    fixedDiscountCents: number | null;
    fixedPromotionalPriceCents: number | null;
    baseUnitPriceCents: number;
    effectiveUnitPriceCents: number;
    unitDiscountCents: number;
    quantity: number;
    baseLineTotalCents: number;
    discountLineTotalCents: number;
    finalLineTotalCents: number;
    snapshotTimestamp: string;
  };
}

export interface EligibleCampaignCandidate {
  campaign: CrechePromotionalCampaign;
  effectiveUnitPriceCents: number;
  unitDiscountCents: number;
}

export interface CommercialCompositionPreview {
  pricingSourceType: "CATALOG" | "TUTOR_CONDITION" | "CAMPAIGN";
  effectiveUnitPriceCents: number;
  unitDiscountCents: number;
  baseUnitPriceCents: number;
  quantity: number;
  finalLineTotalCents: number;
  appliedConditionId: number | null;
  appliedCampaignId: number | null;
  tutorConditionEffectivePriceCents: number | null;
  campaignEffectivePriceCents: number | null;
  competingCampaignCount: number;
  precedenceExplanation: string;
}

export interface CatalogueItemSalePrices {
  id: number;
  name: string;
  itemType: string;
  crecheId: number;
  basePrice: string | number;
  priceSmall?: string | number | null;
  priceMedium?: string | number | null;
  priceLarge?: string | number | null;
}

// ─── Pure Math Functions ──────────────────────────────────────────────────────

/**
 * Validates that a FIXED_PROMOTIONAL_PRICE does NOT increase the price for ANY
 * applicable variant (basePrice, priceSmall, priceMedium, priceLarge).
 * Requirement 1: fixedPromotionalPrice <= minimumApplicableSalePrice.
 */
export function validateItemPricesForFixedPromotionalPrice(
  item: CatalogueItemSalePrices,
  fixedPromotionalPriceCents: number
): void {
  const prices: number[] = [];

  if (item.basePrice != null) {
    prices.push(decimalStringToCents(item.basePrice));
  }
  if (item.priceSmall != null) {
    prices.push(decimalStringToCents(item.priceSmall));
  }
  if (item.priceMedium != null) {
    prices.push(decimalStringToCents(item.priceMedium));
  }
  if (item.priceLarge != null) {
    prices.push(decimalStringToCents(item.priceLarge));
  }

  if (prices.length === 0) {
    throw new CrecheCampaignValidationError(
      `O item "${item.name}" (#${item.id}) não possui preços de venda definidos.`
    );
  }

  const minSalePriceCents = Math.min(...prices);

  if (fixedPromotionalPriceCents > minSalePriceCents) {
    throw new CrecheCampaignValidationError(
      `Preço promocional fixo (R$ ${centsToDecimalString(fixedPromotionalPriceCents)}) não pode ser superior ao menor preço de venda do item "${item.name}" (#${item.id}), que é R$ ${centsToDecimalString(minSalePriceCents)}. Campanhas não podem aumentar preços de nenhuma variante.`
    );
  }
}

/**
 * Pure calculation of campaign pricing for an item given base unit price and benefit.
 */
export function calculateCampaignPrice(
  baseUnitPriceCents: number,
  benefit: CampaignBenefitInput,
  options: { quantity?: number; campaignId?: number | null } = {}
): CampaignPricingResult {
  const quantity = Math.max(1, options.quantity ?? 1);
  const basePrice = Math.max(0, baseUnitPriceCents);
  let effectiveUnitPriceCents = basePrice;
  let unitDiscountCents = 0;

  switch (benefit.benefitType) {
    case "PERCENTAGE_DISCOUNT": {
      const bps = benefit.percentageBps ?? 0;
      if (bps < 1 || bps > 10000) {
        throw new CrecheCampaignValidationError(
          "O percentual de desconto deve estar entre 1 e 10000 basis points (0.01% a 100%)."
        );
      }
      if (bps === 10000) {
        effectiveUnitPriceCents = 0;
        unitDiscountCents = basePrice;
      } else {
        const discount = Number((BigInt(basePrice) * BigInt(bps) + 5000n) / 10000n);
        unitDiscountCents = discount;
        effectiveUnitPriceCents = Math.max(0, basePrice - discount);
      }
      break;
    }

    case "FIXED_DISCOUNT": {
      const discountVal = benefit.fixedDiscountCents ?? 0;
      if (discountVal <= 0) {
        throw new CrecheCampaignValidationError(
          "O valor de desconto fixo deve ser estritamente maior que zero."
        );
      }
      unitDiscountCents = Math.min(basePrice, discountVal);
      effectiveUnitPriceCents = Math.max(0, basePrice - unitDiscountCents);
      break;
    }

    case "FIXED_PROMOTIONAL_PRICE": {
      const promoPrice = benefit.fixedPromotionalPriceCents ?? 0;
      if (promoPrice < 0) {
        throw new CrecheCampaignValidationError(
          "O preço promocional fixo não pode ser negativo."
        );
      }
      if (promoPrice > basePrice) {
        throw new CrecheCampaignValidationError(
          `Preço promocional fixo (R$ ${centsToDecimalString(promoPrice)}) não pode ser superior ao preço base (R$ ${centsToDecimalString(basePrice)}).`
        );
      }
      effectiveUnitPriceCents = promoPrice;
      unitDiscountCents = Math.max(0, basePrice - effectiveUnitPriceCents);
      break;
    }

    default:
      throw new CrecheCampaignValidationError(
        `Tipo de benefício inválido: ${(benefit as any).benefitType}`
      );
  }

  const baseLineTotalCents = basePrice * quantity;
  const discountLineTotalCents = unitDiscountCents * quantity;
  const finalLineTotalCents = effectiveUnitPriceCents * quantity;

  return {
    baseUnitPriceCents: basePrice,
    effectiveUnitPriceCents,
    unitDiscountCents,
    baseUnitPrice: centsToDecimalString(basePrice),
    effectiveUnitPrice: centsToDecimalString(effectiveUnitPriceCents),
    unitDiscount: centsToDecimalString(unitDiscountCents),
    quantity,
    baseLineTotalCents,
    discountLineTotalCents,
    finalLineTotalCents,
    baseLineTotal: centsToDecimalString(baseLineTotalCents),
    discountLineTotal: centsToDecimalString(discountLineTotalCents),
    finalLineTotal: centsToDecimalString(finalLineTotalCents),
    pricingSource: "CAMPAIGN",
    campaignId: options.campaignId ?? null,
    snapshot: {
      campaignId: options.campaignId ?? null,
      benefitType: benefit.benefitType,
      percentageBps: benefit.percentageBps ?? null,
      fixedDiscountCents: benefit.fixedDiscountCents ?? null,
      fixedPromotionalPriceCents: benefit.fixedPromotionalPriceCents ?? null,
      baseUnitPriceCents: basePrice,
      effectiveUnitPriceCents,
      unitDiscountCents,
      quantity,
      baseLineTotalCents,
      discountLineTotalCents,
      finalLineTotalCents,
      snapshotTimestamp: new Date().toISOString(),
    },
  };
}

/**
 * Evaluates whether a campaign is temporally active at a given business time.
 * Interval: [validFrom, validUntil) -> START INCLUSIVE, END EXCLUSIVE.
 */
export function isCampaignActive(
  campaign: {
    status: CampaignStatus;
    validFrom: Date | string;
    validUntil: Date | string;
  },
  atTime: Date = new Date()
): boolean {
  if (campaign.status !== "ACTIVE" && campaign.status !== "SCHEDULED") {
    return false;
  }

  const from = new Date(campaign.validFrom).getTime();
  const until = new Date(campaign.validUntil).getTime();
  const t = atTime.getTime();

  return t >= from && t < until;
}

/**
 * Selects the winning campaign among a list of eligible candidates.
 * Sorting priority:
 * 1. Lowest effectiveUnitPriceCents (greatest financial advantage for the tutor)
 * 2. Highest priority (e.g. 200 > 100)
 * 3. Smallest campaignId (earlier creation tie-breaker)
 */
export function pickWinningCampaign(
  candidates: {
    campaign: { id: number; priority: number; name?: string };
    effectiveUnitPriceCents: number;
    unitDiscountCents: number;
  }[]
): {
  campaign: { id: number; priority: number; name?: string };
  effectiveUnitPriceCents: number;
  unitDiscountCents: number;
} | null {
  if (!candidates || candidates.length === 0) return null;

  const sorted = [...candidates].sort((a, b) => {
    // 1. Lowest price wins
    if (a.effectiveUnitPriceCents !== b.effectiveUnitPriceCents) {
      return a.effectiveUnitPriceCents - b.effectiveUnitPriceCents;
    }
    // 2. Highest priority wins
    if (a.campaign.priority !== b.campaign.priority) {
      return b.campaign.priority - a.campaign.priority;
    }
    // 3. Lowest campaignId wins
    return a.campaign.id - b.campaign.id;
  });

  return sorted[0];
}

/**
 * Pure composition engine for commercial preview (R37.B Tutor Condition + R37.C Campaign).
 * ZERO STACKING contract.
 * Ties go to TUTOR_CONDITION.
 */
export function resolveCommercialPreview(params: {
  baseUnitPriceCents: number;
  quantity?: number;
  tutorCondition?: {
    conditionId: number;
    effectiveUnitPriceCents: number;
    unitDiscountCents: number;
  } | null;
  eligibleCampaigns?: {
    campaign: CrechePromotionalCampaign;
    effectiveUnitPriceCents: number;
    unitDiscountCents: number;
  }[];
}): CommercialCompositionPreview {
  const quantity = Math.max(1, params.quantity ?? 1);
  const baseUnitPriceCents = Math.max(0, params.baseUnitPriceCents);
  const cond = params.tutorCondition ?? null;
  const campaigns = params.eligibleCampaigns ?? [];

  // Case 1: No condition and no campaigns -> CATALOG
  if (!cond && campaigns.length === 0) {
    return {
      pricingSourceType: "CATALOG",
      effectiveUnitPriceCents: baseUnitPriceCents,
      unitDiscountCents: 0,
      baseUnitPriceCents,
      quantity,
      finalLineTotalCents: baseUnitPriceCents * quantity,
      appliedConditionId: null,
      appliedCampaignId: null,
      tutorConditionEffectivePriceCents: null,
      campaignEffectivePriceCents: null,
      competingCampaignCount: 0,
      precedenceExplanation: "Preço padrão do catálogo (sem condições ou campanhas aplicáveis).",
    };
  }

  // Case 2: No condition, but campaigns exist -> Pick best campaign
  if (!cond && campaigns.length > 0) {
    const winner = pickWinningCampaign(campaigns)!;
    return {
      pricingSourceType: "CAMPAIGN",
      effectiveUnitPriceCents: winner.effectiveUnitPriceCents,
      unitDiscountCents: winner.unitDiscountCents,
      baseUnitPriceCents,
      quantity,
      finalLineTotalCents: winner.effectiveUnitPriceCents * quantity,
      appliedConditionId: null,
      appliedCampaignId: winner.campaign.id,
      tutorConditionEffectivePriceCents: null,
      campaignEffectivePriceCents: winner.effectiveUnitPriceCents,
      competingCampaignCount: campaigns.length,
      precedenceExplanation: `Campanha promocional "${winner.campaign.name}" aplicada com sucesso.`,
    };
  }

  // Case 3: Condition exists, but no campaigns -> TUTOR_CONDITION
  if (cond && campaigns.length === 0) {
    return {
      pricingSourceType: "TUTOR_CONDITION",
      effectiveUnitPriceCents: cond.effectiveUnitPriceCents,
      unitDiscountCents: cond.unitDiscountCents,
      baseUnitPriceCents,
      quantity,
      finalLineTotalCents: cond.effectiveUnitPriceCents * quantity,
      appliedConditionId: cond.conditionId,
      appliedCampaignId: null,
      tutorConditionEffectivePriceCents: cond.effectiveUnitPriceCents,
      campaignEffectivePriceCents: null,
      competingCampaignCount: 0,
      precedenceExplanation: "Condição comercial individual do tutor aplicada.",
    };
  }

  // Case 4: BOTH condition and campaigns exist -> Enforce interaction policies & non-stacking
  const competingCampaigns = campaigns.filter(
    (c) =>
      c.campaign.conditionInteractionPolicy === "ALLOW_IF_BETTER" ||
      (c.campaign as any).interactionPolicy === "ALLOW_IF_BETTER"
  );

  // If none allow competition (all are EXCLUDE_IF_TUTOR_CONDITION) -> TUTOR_CONDITION wins
  if (competingCampaigns.length === 0) {
    return {
      pricingSourceType: "TUTOR_CONDITION",
      effectiveUnitPriceCents: cond!.effectiveUnitPriceCents,
      unitDiscountCents: cond!.unitDiscountCents,
      baseUnitPriceCents,
      quantity,
      finalLineTotalCents: cond!.effectiveUnitPriceCents * quantity,
      appliedConditionId: cond!.conditionId,
      appliedCampaignId: null,
      tutorConditionEffectivePriceCents: cond!.effectiveUnitPriceCents,
      campaignEffectivePriceCents: null,
      competingCampaignCount: 0,
      precedenceExplanation:
        "Condição comercial individual mantida (campanhas elegíveis possuem política de exclusão se tutor já tiver condição).",
    };
  }

  // Find best competing campaign
  const bestCampaign = pickWinningCampaign(competingCampaigns)!;

  // Compare prices:
  // - If condition is cheaper -> condition wins
  // - If campaign is cheaper -> campaign wins
  // - If exact tie -> condition wins (Requirement 9)
  if (cond!.effectiveUnitPriceCents <= bestCampaign.effectiveUnitPriceCents) {
    return {
      pricingSourceType: "TUTOR_CONDITION",
      effectiveUnitPriceCents: cond!.effectiveUnitPriceCents,
      unitDiscountCents: cond!.unitDiscountCents,
      baseUnitPriceCents,
      quantity,
      finalLineTotalCents: cond!.effectiveUnitPriceCents * quantity,
      appliedConditionId: cond!.conditionId,
      appliedCampaignId: null,
      tutorConditionEffectivePriceCents: cond!.effectiveUnitPriceCents,
      campaignEffectivePriceCents: bestCampaign.effectiveUnitPriceCents,
      competingCampaignCount: competingCampaigns.length,
      precedenceExplanation:
        cond!.effectiveUnitPriceCents === bestCampaign.effectiveUnitPriceCents
          ? "Empate exato de preços: condição comercial individual prevalece sobre a campanha por precedência contratual."
          : "Condição comercial individual oferece preço melhor que a campanha promocional.",
    };
  }

  // Campaign strictly cheaper!
  return {
    pricingSourceType: "CAMPAIGN",
    effectiveUnitPriceCents: bestCampaign.effectiveUnitPriceCents,
    unitDiscountCents: bestCampaign.unitDiscountCents,
    baseUnitPriceCents,
    quantity,
    finalLineTotalCents: bestCampaign.effectiveUnitPriceCents * quantity,
    appliedConditionId: null,
    appliedCampaignId: bestCampaign.campaign.id,
    tutorConditionEffectivePriceCents: cond!.effectiveUnitPriceCents,
    campaignEffectivePriceCents: bestCampaign.effectiveUnitPriceCents,
    competingCampaignCount: competingCampaigns.length,
    precedenceExplanation: `Campanha promocional "${bestCampaign.campaign.name}" aplicada com preço inferior à condição do tutor.`,
  };
}

// ─── RBAC & Boundary Security ─────────────────────────────────────────────────

/**
 * Requirement 6: Internal system actor boundary.
 * Only 'creche_admin' or trusted internal 'system' can manage campaigns.
 * 'system' is NEVER accepted from HTTP/client requests.
 */
export function assertCanManageCampaign(
  actorOrRole:
    | string
    | {
        userId?: number;
        role: string;
        source?: "http" | "internal";
      }
): void {
  const actor =
    typeof actorOrRole === "string"
      ? { role: actorOrRole, source: "http" as const }
      : actorOrRole;

  if (actor.source !== "internal" && actor.role === "system") {
    throw new CrecheCampaignForbiddenError(
      "Não é permitido assumir perfil de sistema via requisição externa."
    );
  }

  if (actor.role === "system" && actor.source === "internal") {
    return; // Allowed for internal batch/cron processes only
  }

  if (actor.role === "creche_admin") {
    return;
  }

  if (actor.role === "staff") {
    throw new CrecheCampaignForbiddenError(
      "Funcionários (staff) possuem acesso apenas para visualização de campanhas."
    );
  }

  if (actor.role === "tutor") {
    throw new CrecheCampaignForbiddenError(
      "Tutores não têm permissão para acessar ou gerenciar campanhas comerciais."
    );
  }

  if (actor.role === "master_admin") {
    throw new CrecheCampaignForbiddenError(
      "Master Admin não possui permissão para mutação operacional direta em campanhas de creche."
    );
  }

  throw new CrecheCampaignForbiddenError("Acesso negado.");
}
