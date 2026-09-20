/**
 * Pure Deterministic Pricing Engine (R36.D Slice 2)
 *
 * Invariants:
 * 1. Pure calculation — zero DB, zero Stripe, zero React dependencies.
 * 2. Integer centavos only — no floating-point currency representation or parsing.
 * 3. Safe integer arithmetic — uses BigInt internally to prevent Number overflow.
 * 4. Canonical percentage rounding — rounds the final effective price via roundHalfUp,
 *    deriving discount as (catalog - effective).
 * 5. Temporal validity window — validFrom <= referenceDate < validUntil (start inclusive, end exclusive).
 * 6. Non-negative output guarantee — finalEffectivePriceCents >= 0.
 * 7. Promotions absent in Slice 2 — finalEffectivePriceCents === baseEffectivePriceCents.
 */

export class PricingEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingEngineError";
  }
}

export type PricingOverrideType = "none" | "fixed_amount" | "percentage";

export interface PricingCalculationInput {
  catalogPriceCents: number;
  pricingOverrideType?: PricingOverrideType | null;
  pricingOverrideValue?: number | null;
  validFrom?: Date | string | null;
  validUntil?: Date | string | null;
  referenceDate?: Date | string | null;
}

export interface PricingCalculationResult {
  catalogPriceCents: number;
  baseEffectivePriceCents: number;
  overrideDiscountCents: number;
  finalEffectivePriceCents: number;
  appliedOverrideType: PricingOverrideType;
  isExpired: boolean;
}

/**
 * Checks whether referenceDate falls within [validFrom, validUntil).
 * Start is inclusive, end is exclusive.
 */
export function isWithinValidityWindow(
  validFrom: Date | string | null | undefined,
  validUntil: Date | string | null | undefined,
  referenceDate: Date | string | null | undefined,
): boolean {
  const ref = referenceDate ? new Date(referenceDate) : new Date();
  const refTime = ref.getTime();

  if (isNaN(refTime)) {
    throw new PricingEngineError("Invalid referenceDate provided to pricing engine.");
  }

  if (validFrom) {
    const fromTime = new Date(validFrom).getTime();
    if (isNaN(fromTime)) {
      throw new PricingEngineError("Invalid validFrom date provided to pricing engine.");
    }
    // Start inclusive
    if (refTime < fromTime) {
      return false;
    }
  }

  if (validUntil) {
    const untilTime = new Date(validUntil).getTime();
    if (isNaN(untilTime)) {
      throw new PricingEngineError("Invalid validUntil date provided to pricing engine.");
    }
    // End exclusive
    if (refTime >= untilTime) {
      return false;
    }
  }

  return true;
}

/**
 * Calculates deterministic effective price for a commercial condition.
 */
export function calculateEffectivePrice(input: PricingCalculationInput): PricingCalculationResult {
  const { catalogPriceCents, pricingOverrideType, pricingOverrideValue, validFrom, validUntil, referenceDate } = input;

  // 1. Validate catalogPriceCents
  if (
    typeof catalogPriceCents !== "number" ||
    !Number.isSafeInteger(catalogPriceCents) ||
    catalogPriceCents < 0
  ) {
    throw new PricingEngineError(
      `Invalid catalogPriceCents: expected non-negative safe integer, received ${catalogPriceCents}.`,
    );
  }

  const normalizedType: PricingOverrideType = pricingOverrideType ?? "none";

  // 2. If override is 'none' or absent
  if (normalizedType === "none") {
    if (pricingOverrideValue !== null && pricingOverrideValue !== undefined && pricingOverrideValue !== 0) {
      throw new PricingEngineError(
        `Pricing override type 'none' cannot have a non-zero value (received ${pricingOverrideValue}).`,
      );
    }
    return {
      catalogPriceCents,
      baseEffectivePriceCents: catalogPriceCents,
      overrideDiscountCents: 0,
      finalEffectivePriceCents: catalogPriceCents,
      appliedOverrideType: "none",
      isExpired: false,
    };
  }

  // 3. Check temporal validity window
  const active = isWithinValidityWindow(validFrom, validUntil, referenceDate);
  if (!active) {
    // Override has expired or is not yet active: falls back to catalog price
    return {
      catalogPriceCents,
      baseEffectivePriceCents: catalogPriceCents,
      overrideDiscountCents: 0,
      finalEffectivePriceCents: catalogPriceCents,
      appliedOverrideType: "none",
      isExpired: true,
    };
  }

  // 4. Fixed amount override
  if (normalizedType === "fixed_amount") {
    if (
      typeof pricingOverrideValue !== "number" ||
      !Number.isSafeInteger(pricingOverrideValue) ||
      pricingOverrideValue < 0
    ) {
      throw new PricingEngineError(
        `Pricing override 'fixed_amount' requires a non-negative integer amount in centavos (received ${pricingOverrideValue}).`,
      );
    }

    const effective = pricingOverrideValue;
    const discount = Math.max(0, catalogPriceCents - effective);

    return {
      catalogPriceCents,
      baseEffectivePriceCents: effective,
      overrideDiscountCents: discount,
      finalEffectivePriceCents: effective,
      appliedOverrideType: "fixed_amount",
      isExpired: false,
    };
  }

  // 5. Percentage override (basis points: 0..10000 bps)
  if (normalizedType === "percentage") {
    if (
      typeof pricingOverrideValue !== "number" ||
      !Number.isSafeInteger(pricingOverrideValue) ||
      pricingOverrideValue < 0 ||
      pricingOverrideValue > 10000
    ) {
      throw new PricingEngineError(
        `Pricing override 'percentage' requires an integer in basis points between 0 and 10000 (received ${pricingOverrideValue}).`,
      );
    }

    const basisPoints = pricingOverrideValue;

    // Use BigInt internally for safe integer financial arithmetic
    const catalogBig = BigInt(catalogPriceCents);
    const factorBig = BigInt(10000 - basisPoints);
    const productBig = catalogBig * factorBig;

    // Canonical roundHalfUp on final effective price:
    // effective = floor((catalogPriceCents * (10000 - basisPoints) + 5000) / 10000)
    const effectiveBig = (productBig + 5000n) / 10000n;
    const discountBig = catalogBig - effectiveBig;

    const effective = Number(effectiveBig);
    const discount = Number(discountBig);

    return {
      catalogPriceCents,
      baseEffectivePriceCents: effective,
      overrideDiscountCents: Math.max(0, discount),
      finalEffectivePriceCents: effective,
      appliedOverrideType: "percentage",
      isExpired: false,
    };
  }

  throw new PricingEngineError(`Unsupported pricing override type '${normalizedType}'.`);
}

export interface CanonicalResolvedPrice {
  sourceType: "CUSTOM_CONDITION" | "PROPOSAL" | "CAMPAIGN" | "CATALOG";
  sourceId: number | string;
  planId: number;
  planVersionId: number;
  planVersionPriceId: number | null;
  billingInterval: BillingInterval;
  basePriceCents: number;
  catalogPriceCents?: number;
  finalPriceCents: number;
  discountType: "none" | "fixed_amount" | "percentage";
  discountValue: number; // Centavos or basis points (0..10000)
  discountPercentage?: number;
  stripePriceId: string | null;
  isGrandfathered: boolean;
}

export interface ResolveSaaSSubscriptionPriceInput {
  crecheId: number;
  planId: number;
  interval?: BillingInterval | string | null;
  referenceDate?: Date | string | null;
  dbClient?: any;
}

import { db as defaultDb, type BillingInterval } from "@workspace/db";
import {
  planVersionsTable,
  planVersionPricesTable,
  customerCommercialConditionsTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { resolveCatalogPlanPrice, normalizeBillingInterval } from "./catalogPricing.js";

/**
 * Pure Deterministic DEC-09 Precedence Resolver for SaaS Subscriptions.
 * Precedence:
 *   [ LAYER 1 ] CUSTOM CONDITION (agreement_id IS NULL AND assigned_benefit_id IS NULL)
 *        │
 *   [ LAYER 2 ] PROPOSAL         (agreement_id IS NOT NULL)
 *        │
 *   [ LAYER 3 ] CAMPAIGN         (assigned_benefit_id IS NOT NULL)
 *        │
 *   [ LAYER 4 ] CATALOG          (plan_versions / plan_version_prices)
 *
 * Invariants:
 * 1. Pure precedence — First applicable unexpired source wins.
 * 2. Absolute zero monetary stacking across layers.
 * 3. Future eligibility evaluated against referenceDate (e.g. scheduledPeriodEnd).
 */
export async function resolveSaaSSubscriptionPrice(
  input: ResolveSaaSSubscriptionPriceInput,
): Promise<CanonicalResolvedPrice> {
  const dbClient = input.dbClient ?? defaultDb;
  const validInterval: BillingInterval = normalizeBillingInterval(input.interval) ?? "month";

  // 1. Resolve Layer 4 (Catalog base price) via active plan version or fallback
  let planVersionId = 0;
  let planVersionPriceId: number | null = null;
  let catalogBasePrice = 0;
  let catalogStripePriceId: string | null = null;

  try {
    const [activeVersion] = await dbClient
      .select()
      .from(planVersionsTable)
      .where(
        and(
          eq(planVersionsTable.planId, input.planId),
          eq(planVersionsTable.status, "ACTIVE"),
        ),
      )
      .limit(1);

    if (activeVersion) {
      planVersionId = activeVersion.id;
      const [versionPrice] = await dbClient
        .select()
        .from(planVersionPricesTable)
        .where(
          and(
            eq(planVersionPricesTable.planVersionId, activeVersion.id),
            eq(planVersionPricesTable.interval, validInterval),
          ),
        )
        .limit(1);

      if (versionPrice) {
        planVersionPriceId = versionPrice.id;
        catalogBasePrice = versionPrice.priceBrl;
        catalogStripePriceId = versionPrice.stripePriceId ?? null;
      } else {
        catalogBasePrice = activeVersion.priceBrl;
      }
    } else {
      const cat = await resolveCatalogPlanPrice(input.planId, validInterval, dbClient);
      catalogBasePrice = cat.catalogPriceCents;
      catalogStripePriceId = cat.stripePriceId ?? null;
    }
  } catch (err) {
    const cat = await resolveCatalogPlanPrice(input.planId, validInterval, dbClient);
    catalogBasePrice = cat.catalogPriceCents;
    catalogStripePriceId = cat.stripePriceId ?? null;
  }

  // 2. Fetch active commercial conditions for creche
  const conditions = await dbClient
    .select()
    .from(customerCommercialConditionsTable)
    .where(
      and(
        eq(customerCommercialConditionsTable.crecheId, input.crecheId),
        eq(customerCommercialConditionsTable.status, "active"),
      ),
    );

  // Filter conditions applicable to this plan (planId matches or is NULL)
  // and temporally valid at referenceDate
  const applicable = conditions.filter((c: any) => {
    if (c.planId !== null && c.planId !== undefined && c.planId !== input.planId) {
      return false;
    }
    return isWithinValidityWindow(c.validFrom, c.validUntil, input.referenceDate);
  });

  // Layer 1: Standalone Custom Condition (agreement_id IS NULL AND assigned_benefit_id IS NULL)
  const customCondition = applicable.find(
    (c: any) => c.agreementId == null && c.assignedBenefitId == null,
  );
  if (customCondition) {
    const calc = calculateEffectivePrice({
      catalogPriceCents: catalogBasePrice,
      pricingOverrideType: (customCondition.pricingOverrideType as PricingOverrideType) ?? "none",
      pricingOverrideValue: customCondition.pricingOverrideValue ?? 0,
      validFrom: customCondition.validFrom,
      validUntil: customCondition.validUntil,
      referenceDate: input.referenceDate,
    });
    return {
      sourceType: "CUSTOM_CONDITION",
      sourceId: customCondition.id,
      planId: input.planId,
      planVersionId,
      planVersionPriceId,
      billingInterval: validInterval,
      basePriceCents: catalogBasePrice,
      catalogPriceCents: catalogBasePrice,
      finalPriceCents: calc.finalEffectivePriceCents,
      discountType: (customCondition.pricingOverrideType as any) ?? "none",
      discountValue: customCondition.pricingOverrideValue ?? 0,
      discountPercentage: customCondition.pricingOverrideType === "percentage" ? (customCondition.pricingOverrideValue && customCondition.pricingOverrideValue > 100 ? Math.round(customCondition.pricingOverrideValue / 100) : customCondition.pricingOverrideValue ?? 0) : undefined,
      stripePriceId: customCondition.stripePriceId ?? catalogStripePriceId,
      isGrandfathered: false,
    };
  }

  // Layer 2: Proposal (agreement_id IS NOT NULL)
  const proposalCondition = applicable.find((c: any) => c.agreementId != null);
  if (proposalCondition) {
    const calc = calculateEffectivePrice({
      catalogPriceCents: catalogBasePrice,
      pricingOverrideType: (proposalCondition.pricingOverrideType as PricingOverrideType) ?? "none",
      pricingOverrideValue: proposalCondition.pricingOverrideValue ?? 0,
      validFrom: proposalCondition.validFrom,
      validUntil: proposalCondition.validUntil,
      referenceDate: input.referenceDate,
    });
    return {
      sourceType: "PROPOSAL",
      sourceId: proposalCondition.agreementId!,
      planId: input.planId,
      planVersionId,
      planVersionPriceId,
      billingInterval: validInterval,
      basePriceCents: catalogBasePrice,
      catalogPriceCents: catalogBasePrice,
      finalPriceCents: calc.finalEffectivePriceCents,
      discountType: (proposalCondition.pricingOverrideType as any) ?? "none",
      discountValue: proposalCondition.pricingOverrideValue ?? 0,
      discountPercentage: proposalCondition.pricingOverrideType === "percentage" ? (proposalCondition.pricingOverrideValue && proposalCondition.pricingOverrideValue > 100 ? Math.round(proposalCondition.pricingOverrideValue / 100) : proposalCondition.pricingOverrideValue ?? 0) : undefined,
      stripePriceId: proposalCondition.stripePriceId ?? catalogStripePriceId,
      isGrandfathered: false,
    };
  }

  // Layer 3: Campaign (assigned_benefit_id IS NOT NULL)
  const campaignCondition = applicable.find((c: any) => c.assignedBenefitId != null);
  if (campaignCondition) {
    const calc = calculateEffectivePrice({
      catalogPriceCents: catalogBasePrice,
      pricingOverrideType: (campaignCondition.pricingOverrideType as PricingOverrideType) ?? "none",
      pricingOverrideValue: campaignCondition.pricingOverrideValue ?? 0,
      validFrom: campaignCondition.validFrom,
      validUntil: campaignCondition.validUntil,
      referenceDate: input.referenceDate,
    });
    return {
      sourceType: "CAMPAIGN",
      sourceId: campaignCondition.assignedBenefitId!,
      planId: input.planId,
      planVersionId,
      planVersionPriceId,
      billingInterval: validInterval,
      basePriceCents: catalogBasePrice,
      catalogPriceCents: catalogBasePrice,
      finalPriceCents: calc.finalEffectivePriceCents,
      discountType: (campaignCondition.pricingOverrideType as any) ?? "none",
      discountValue: campaignCondition.pricingOverrideValue ?? 0,
      discountPercentage: campaignCondition.pricingOverrideType === "percentage" ? (campaignCondition.pricingOverrideValue && campaignCondition.pricingOverrideValue > 100 ? Math.round(campaignCondition.pricingOverrideValue / 100) : campaignCondition.pricingOverrideValue ?? 0) : undefined,
      stripePriceId: campaignCondition.stripePriceId ?? catalogStripePriceId,
      isGrandfathered: false,
    };
  }

  // Layer 4: Catalog Fallback
  return {
    sourceType: "CATALOG",
    sourceId: planVersionId,
    planId: input.planId,
    planVersionId,
    planVersionPriceId,
    billingInterval: validInterval,
    basePriceCents: catalogBasePrice,
    catalogPriceCents: catalogBasePrice,
    finalPriceCents: catalogBasePrice,
    discountType: "none",
    discountValue: 0,
    stripePriceId: catalogStripePriceId,
    isGrandfathered: false,
  };
}
