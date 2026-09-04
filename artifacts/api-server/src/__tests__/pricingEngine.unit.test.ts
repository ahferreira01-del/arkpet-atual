import { describe, it, expect } from "vitest";
import {
  calculateEffectivePrice,
  isWithinValidityWindow,
  PricingEngineError,
} from "../services/pricingEngine.js";

describe("Pure Deterministic Pricing Engine Golden Unit Tests (R36.D Slice 2)", () => {
  const CATALOG_STANDARD = 31990; // R$ 319.90

  describe("1. Baseline: No Override", () => {
    it("returns catalog price when override is absent", () => {
      const result = calculateEffectivePrice({ catalogPriceCents: CATALOG_STANDARD });
      expect(result.catalogPriceCents).toBe(31990);
      expect(result.baseEffectivePriceCents).toBe(31990);
      expect(result.overrideDiscountCents).toBe(0);
      expect(result.finalEffectivePriceCents).toBe(31990);
      expect(result.appliedOverrideType).toBe("none");
      expect(result.isExpired).toBe(false);
    });

    it("returns catalog price when override type is explicitly 'none' with null value", () => {
      const result = calculateEffectivePrice({
        catalogPriceCents: CATALOG_STANDARD,
        pricingOverrideType: "none",
        pricingOverrideValue: null,
      });
      expect(result.finalEffectivePriceCents).toBe(31990);
      expect(result.overrideDiscountCents).toBe(0);
      expect(result.appliedOverrideType).toBe("none");
    });

    it("accepts 0 value for 'none' override type", () => {
      const result = calculateEffectivePrice({
        catalogPriceCents: CATALOG_STANDARD,
        pricingOverrideType: "none",
        pricingOverrideValue: 0,
      });
      expect(result.finalEffectivePriceCents).toBe(31990);
    });

    it("rejects non-zero value for 'none' override type", () => {
      expect(() =>
        calculateEffectivePrice({
          catalogPriceCents: CATALOG_STANDARD,
          pricingOverrideType: "none",
          pricingOverrideValue: 500,
        }),
      ).toThrow(PricingEngineError);
    });
  });

  describe("2. Fixed Amount Override", () => {
    it("sets effective price directly to negotiated fixed amount", () => {
      const result = calculateEffectivePrice({
        catalogPriceCents: CATALOG_STANDARD,
        pricingOverrideType: "fixed_amount",
        pricingOverrideValue: 27990, // R$ 279.90
      });
      expect(result.catalogPriceCents).toBe(31990);
      expect(result.baseEffectivePriceCents).toBe(27990);
      expect(result.overrideDiscountCents).toBe(4000); // 31990 - 27990 = 4000
      expect(result.finalEffectivePriceCents).toBe(27990);
      expect(result.appliedOverrideType).toBe("fixed_amount");
      expect(result.isExpired).toBe(false);
    });

    it("allows zero fixed amount (100% discount / free courtesy)", () => {
      const result = calculateEffectivePrice({
        catalogPriceCents: CATALOG_STANDARD,
        pricingOverrideType: "fixed_amount",
        pricingOverrideValue: 0,
      });
      expect(result.baseEffectivePriceCents).toBe(0);
      expect(result.overrideDiscountCents).toBe(31990);
      expect(result.finalEffectivePriceCents).toBe(0);
    });

    it("handles fixed amount higher than catalog price (discount is 0)", () => {
      const result = calculateEffectivePrice({
        catalogPriceCents: CATALOG_STANDARD,
        pricingOverrideType: "fixed_amount",
        pricingOverrideValue: 35000,
      });
      expect(result.finalEffectivePriceCents).toBe(35000);
      expect(result.overrideDiscountCents).toBe(0);
    });
  });

  describe("3. Percentage Override (Basis Points: 0..10000 bps)", () => {
    it("calculates 1% discount (100 bps) correctly", () => {
      const result = calculateEffectivePrice({
        catalogPriceCents: CATALOG_STANDARD, // 31990
        pricingOverrideType: "percentage",
        pricingOverrideValue: 100, // 1%
      });
      // 31990 * 0.99 = 31670.1 => rounds to 31670
      expect(result.finalEffectivePriceCents).toBe(31670);
      expect(result.overrideDiscountCents).toBe(320); // 31990 - 31670 = 320
    });

    it("calculates 7.5% discount (750 bps) correctly", () => {
      const result = calculateEffectivePrice({
        catalogPriceCents: CATALOG_STANDARD,
        pricingOverrideType: "percentage",
        pricingOverrideValue: 750, // 7.5%
      });
      // 31990 * 0.925 = 29590.75 => rounds to 29591
      expect(result.finalEffectivePriceCents).toBe(29591);
      expect(result.overrideDiscountCents).toBe(2399); // 31990 - 29591 = 2399
    });

    it("calculates 15% discount (1500 bps) using canonical roundHalfUp on effective price", () => {
      const result = calculateEffectivePrice({
        catalogPriceCents: CATALOG_STANDARD,
        pricingOverrideType: "percentage",
        pricingOverrideValue: 1500, // 15%
      });
      // 31990 * 0.85 = 27191.5 => roundHalfUp rounds to 27192
      expect(result.finalEffectivePriceCents).toBe(27192);
      expect(result.overrideDiscountCents).toBe(4798); // 31990 - 27192 = 4798
    });

    it("calculates 33.33% discount (3333 bps) correctly", () => {
      const result = calculateEffectivePrice({
        catalogPriceCents: CATALOG_STANDARD,
        pricingOverrideType: "percentage",
        pricingOverrideValue: 3333,
      });
      // 31990 * (10000 - 3333) / 10000 = 31990 * 6667 / 10000 = 213277330 / 10000 = 21327.733 => 21328
      expect(result.finalEffectivePriceCents).toBe(21328);
      expect(result.overrideDiscountCents).toBe(10662);
    });

    it("calculates 100% discount (10000 bps) correctly", () => {
      const result = calculateEffectivePrice({
        catalogPriceCents: CATALOG_STANDARD,
        pricingOverrideType: "percentage",
        pricingOverrideValue: 10000,
      });
      expect(result.finalEffectivePriceCents).toBe(0);
      expect(result.overrideDiscountCents).toBe(31990);
    });
  });

  describe("4. Half-Cent Rounding Boundary Cases (Correction 1)", () => {
    it("proves exact-half-cent boundary rounds up for effective price (1.5% on 100 cents)", () => {
      // Catalog: 100 cents. Discount: 1.5% (150 bps).
      // Effective price: 100 * 0.985 = 98.5 cents.
      // RoundHalfUp on effective price: 98.5 => 99 cents.
      // Discount: 100 - 99 = 1 cent.
      const result = calculateEffectivePrice({
        catalogPriceCents: 100,
        pricingOverrideType: "percentage",
        pricingOverrideValue: 150,
      });
      expect(result.finalEffectivePriceCents).toBe(99);
      expect(result.overrideDiscountCents).toBe(1);
    });

    it("proves slightly below half-cent does not round up (1.51% discount => 98.49 effective => 98)", () => {
      // 100 * (10000 - 151) / 10000 = 98.49 cents => 98 cents.
      const result = calculateEffectivePrice({
        catalogPriceCents: 100,
        pricingOverrideType: "percentage",
        pricingOverrideValue: 151,
      });
      expect(result.finalEffectivePriceCents).toBe(98);
      expect(result.overrideDiscountCents).toBe(2);
    });

    it("proves slightly above half-cent rounds up (1.49% discount => 98.51 effective => 99)", () => {
      // 100 * (10000 - 149) / 10000 = 98.51 cents => 99 cents.
      const result = calculateEffectivePrice({
        catalogPriceCents: 100,
        pricingOverrideType: "percentage",
        pricingOverrideValue: 149,
      });
      expect(result.finalEffectivePriceCents).toBe(99);
      expect(result.overrideDiscountCents).toBe(1);
    });
  });

  describe("5. Safe Integer Arithmetic & BigInt Scale (Correction 2)", () => {
    it("handles large valid integer monetary amounts without precision loss or overflow", () => {
      const largeCatalog = 100_000_000; // R$ 1,000,000.00 (100 million centavos)
      const result = calculateEffectivePrice({
        catalogPriceCents: largeCatalog,
        pricingOverrideType: "percentage",
        pricingOverrideValue: 1500, // 15%
      });
      expect(result.finalEffectivePriceCents).toBe(85_000_000); // R$ 850,000.00
      expect(result.overrideDiscountCents).toBe(15_000_000); // R$ 150,000.00
    });
  });

  describe("6. Input Validation & Error Handling", () => {
    it("rejects negative catalog price", () => {
      expect(() =>
        calculateEffectivePrice({
          catalogPriceCents: -100,
        }),
      ).toThrow(PricingEngineError);
    });

    it("rejects non-integer catalog price", () => {
      expect(() =>
        calculateEffectivePrice({
          catalogPriceCents: 319.9,
        }),
      ).toThrow(PricingEngineError);
    });

    it("rejects basis points > 10000", () => {
      expect(() =>
        calculateEffectivePrice({
          catalogPriceCents: CATALOG_STANDARD,
          pricingOverrideType: "percentage",
          pricingOverrideValue: 10001,
        }),
      ).toThrow(PricingEngineError);
    });

    it("rejects negative basis points", () => {
      expect(() =>
        calculateEffectivePrice({
          catalogPriceCents: CATALOG_STANDARD,
          pricingOverrideType: "percentage",
          pricingOverrideValue: -10,
        }),
      ).toThrow(PricingEngineError);
    });

    it("rejects non-integer basis points", () => {
      expect(() =>
        calculateEffectivePrice({
          catalogPriceCents: CATALOG_STANDARD,
          pricingOverrideType: "percentage",
          pricingOverrideValue: 15.5,
        }),
      ).toThrow(PricingEngineError);
    });

    it("rejects negative fixed amount", () => {
      expect(() =>
        calculateEffectivePrice({
          catalogPriceCents: CATALOG_STANDARD,
          pricingOverrideType: "fixed_amount",
          pricingOverrideValue: -1,
        }),
      ).toThrow(PricingEngineError);
    });

    it("rejects non-integer fixed amount", () => {
      expect(() =>
        calculateEffectivePrice({
          catalogPriceCents: CATALOG_STANDARD,
          pricingOverrideType: "fixed_amount",
          pricingOverrideValue: 279.9,
        }),
      ).toThrow(PricingEngineError);
    });
  });

  describe("7. Temporal Validity Window (Correction 7)", () => {
    const validFrom = "2026-09-01T00:00:00.000Z";
    const validUntil = "2026-10-01T00:00:00.000Z";

    it("evaluates start-inclusive: referenceDate === validFrom is ACTIVE", () => {
      expect(isWithinValidityWindow(validFrom, validUntil, "2026-09-01T00:00:00.000Z")).toBe(true);
      const result = calculateEffectivePrice({
        catalogPriceCents: CATALOG_STANDARD,
        pricingOverrideType: "fixed_amount",
        pricingOverrideValue: 25000,
        validFrom,
        validUntil,
        referenceDate: "2026-09-01T00:00:00.000Z",
      });
      expect(result.finalEffectivePriceCents).toBe(25000);
      expect(result.isExpired).toBe(false);
    });

    it("evaluates end-exclusive: referenceDate === validUntil is EXPIRED", () => {
      expect(isWithinValidityWindow(validFrom, validUntil, "2026-10-01T00:00:00.000Z")).toBe(false);
      const result = calculateEffectivePrice({
        catalogPriceCents: CATALOG_STANDARD,
        pricingOverrideType: "fixed_amount",
        pricingOverrideValue: 25000,
        validFrom,
        validUntil,
        referenceDate: "2026-10-01T00:00:00.000Z",
      });
      // Falls back to catalog price
      expect(result.finalEffectivePriceCents).toBe(31990);
      expect(result.appliedOverrideType).toBe("none");
      expect(result.isExpired).toBe(true);
    });

    it("evaluates referenceDate before validFrom as not active (falls back to catalog)", () => {
      const result = calculateEffectivePrice({
        catalogPriceCents: CATALOG_STANDARD,
        pricingOverrideType: "fixed_amount",
        pricingOverrideValue: 25000,
        validFrom,
        validUntil,
        referenceDate: "2026-08-31T23:59:59.999Z",
      });
      expect(result.finalEffectivePriceCents).toBe(31990);
      expect(result.isExpired).toBe(true);
    });

    it("evaluates referenceDate after validUntil as expired (falls back to catalog)", () => {
      const result = calculateEffectivePrice({
        catalogPriceCents: CATALOG_STANDARD,
        pricingOverrideType: "fixed_amount",
        pricingOverrideValue: 25000,
        validFrom,
        validUntil,
        referenceDate: "2026-10-02T12:00:00.000Z",
      });
      expect(result.finalEffectivePriceCents).toBe(31990);
      expect(result.isExpired).toBe(true);
    });

    it("allows indefinite override when validUntil is null", () => {
      const result = calculateEffectivePrice({
        catalogPriceCents: CATALOG_STANDARD,
        pricingOverrideType: "fixed_amount",
        pricingOverrideValue: 25000,
        validFrom,
        validUntil: null,
        referenceDate: "2030-01-01T00:00:00.000Z",
      });
      expect(result.finalEffectivePriceCents).toBe(25000);
      expect(result.isExpired).toBe(false);
    });
  });
});
