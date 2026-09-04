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
