import { describe, it, expect } from "vitest";
import {
  applyPercentageDiscount,
  applyFixedDiscount,
  applyCustomPrice,
  resolveBasePriceCents,
  decimalStringToCents,
  centsToDecimalString,
  calculateResolvedSnapshot,
} from "../services/tutorCommercialPricing.js";

describe("TutorCommercialPricing - Pure Math & Snapshot Unit Tests (R37.B)", () => {
  describe("1. Currency Conversion Helpers", () => {
    it("converts decimal strings and numbers to cents accurately", () => {
      expect(decimalStringToCents("50.00")).toBe(5000);
      expect(decimalStringToCents("49.99")).toBe(4999);
      expect(decimalStringToCents(50)).toBe(5000);
      expect(decimalStringToCents(0)).toBe(0);
      expect(decimalStringToCents(null)).toBe(0);
      expect(decimalStringToCents(undefined)).toBe(0);
      expect(decimalStringToCents("invalid")).toBe(0);
    });

    it("converts integer cents to decimal strings accurately", () => {
      expect(centsToDecimalString(5000)).toBe("50.00");
      expect(centsToDecimalString(4999)).toBe("49.99");
      expect(centsToDecimalString(50)).toBe("0.50");
      expect(centsToDecimalString(0)).toBe("0.00");
    });
  });

  describe("2. Percentage Discount with BigInt roundHalfUp", () => {
    it("calculates standard 10% discount (1000 bps) on R$ 50.00", () => {
      const { effectiveUnitPriceCents, unitDiscountCents } = applyPercentageDiscount(5000, 1000);
      expect(unitDiscountCents).toBe(500); // R$ 5.00
      expect(effectiveUnitPriceCents).toBe(4500); // R$ 45.00
    });

    it("calculates 15% discount (1500 bps) on R$ 75.50", () => {
      // 7550 * 1500 = 11325000. (11325000 + 5000) / 10000 = 1133 cents = R$ 11.33
      const { effectiveUnitPriceCents, unitDiscountCents } = applyPercentageDiscount(7550, 1500);
      expect(unitDiscountCents).toBe(1133);
      expect(effectiveUnitPriceCents).toBe(6417); // 7550 - 1133 = 6417
    });

    it("handles exact half-cent rounding up", () => {
      // 105 cents with 500 bps (5%): 105 * 500 = 52500. (52500 + 5000) / 10000 = 57500 / 10000 = 5 cents
      // 110 cents with 500 bps: 110 * 500 = 55000. (55000 + 5000) / 10000 = 60000 / 10000 = 6 cents (half-cent rounds up)
      const res = applyPercentageDiscount(110, 500);
      expect(res.unitDiscountCents).toBe(6);
      expect(res.effectiveUnitPriceCents).toBe(104);
    });

    it("handles 0% discount (0 bps)", () => {
      const res = applyPercentageDiscount(5000, 0);
      expect(res.unitDiscountCents).toBe(0);
      expect(res.effectiveUnitPriceCents).toBe(5000);
    });

    it("handles 100% discount (10000 bps)", () => {
      const res = applyPercentageDiscount(5000, 10000);
      expect(res.unitDiscountCents).toBe(5000);
      expect(res.effectiveUnitPriceCents).toBe(0);
    });
  });

  describe("3. Fixed Discount with Zero Clamping", () => {
    it("applies fixed discount of R$ 10.00 (1000 cents) on R$ 50.00", () => {
      const res = applyFixedDiscount(5000, 1000);
      expect(res.unitDiscountCents).toBe(1000);
      expect(res.effectiveUnitPriceCents).toBe(4000);
    });

    it("clamps fixed discount to base price when discount exceeds base price (cannot be negative)", () => {
      const res = applyFixedDiscount(3000, 5000); // R$ 30 base, R$ 50 discount
      expect(res.unitDiscountCents).toBe(3000);
      expect(res.effectiveUnitPriceCents).toBe(0);
    });

    it("handles 0 fixed discount", () => {
      const res = applyFixedDiscount(5000, 0);
      expect(res.unitDiscountCents).toBe(0);
      expect(res.effectiveUnitPriceCents).toBe(5000);
    });
  });

  describe("4. Custom Price Override", () => {
    it("sets effective unit price directly to custom price of R$ 42.00", () => {
      const res = applyCustomPrice(5000, 4200);
      expect(res.effectiveUnitPriceCents).toBe(4200);
      expect(res.unitDiscountCents).toBe(800);
    });

    it("handles custom price higher than base price", () => {
      const res = applyCustomPrice(5000, 6000);
      expect(res.effectiveUnitPriceCents).toBe(6000);
      expect(res.unitDiscountCents).toBe(0);
    });

    it("handles custom price of 0 (free tier agreement)", () => {
      const res = applyCustomPrice(5000, 0);
      expect(res.effectiveUnitPriceCents).toBe(0);
      expect(res.unitDiscountCents).toBe(5000);
    });
  });

  describe("5. Pet Size Price Resolution", () => {
    const serviceItem = {
      basePrice: "60.00",
      priceSmall: "50.00",
      priceMedium: "65.00",
      priceLarge: "80.00",
    };

    it("resolves priceSmall when petSize is 'small'", () => {
      expect(resolveBasePriceCents(serviceItem, "small")).toBe(5000);
    });

    it("resolves priceMedium when petSize is 'medium'", () => {
      expect(resolveBasePriceCents(serviceItem, "medium")).toBe(6500);
    });

    it("resolves priceLarge when petSize is 'large'", () => {
      expect(resolveBasePriceCents(serviceItem, "large")).toBe(8000);
    });

    it("falls back to basePrice when petSize is omitted or null", () => {
      expect(resolveBasePriceCents(serviceItem, null)).toBe(6000);
      expect(resolveBasePriceCents(serviceItem, undefined)).toBe(6000);
    });

    it("falls back to basePrice when specific size price is null in item", () => {
      const itemWithNoSmall = {
        basePrice: "70.00",
        priceSmall: null,
      };
      expect(resolveBasePriceCents(itemWithNoSmall, "small")).toBe(7000);
    });
  });

  describe("6. Strict Separation: Unit Metrics vs Line Metrics Snapshot", () => {
    it("builds snapshot strictly separating unit from line totals with quantity = 3", () => {
      const snapshot = calculateResolvedSnapshot({
        baseUnitPriceCents: 5000, // R$ 50.00
        conditionType: "PERCENTAGE_DISCOUNT",
        percentageBps: 1000, // 10%
        quantity: 3,
        catalogueItemId: 42,
        appliedConditionId: 101,
        petSize: "small",
        snapshotTimestamp: "2026-09-11T12:00:00.000Z",
      });

      // Pricing source
      expect(snapshot.pricingSourceType).toBe("TUTOR_CONDITION");
      expect(snapshot.appliedConditionId).toBe(101);

      // Unit metrics
      expect(snapshot.baseUnitPriceCents).toBe(5000);
      expect(snapshot.effectiveUnitPriceCents).toBe(4500);
      expect(snapshot.unitDiscountCents).toBe(500);
      expect(snapshot.baseUnitPrice).toBe("50.00");
      expect(snapshot.effectiveUnitPrice).toBe("45.00");
      expect(snapshot.unitDiscount).toBe("5.00");

      // Line metrics (multiplied by quantity = 3)
      expect(snapshot.quantity).toBe(3);
      expect(snapshot.baseLineTotalCents).toBe(15000); // 50.00 * 3 = 150.00
      expect(snapshot.discountLineTotalCents).toBe(1500); // 5.00 * 3 = 15.00
      expect(snapshot.finalLineTotalCents).toBe(13500); // 45.00 * 3 = 135.00
      expect(snapshot.baseLineTotal).toBe("150.00");
      expect(snapshot.discountLineTotal).toBe("15.00");
      expect(snapshot.finalLineTotal).toBe("135.00");

      // Durable explanation payload
      expect(snapshot.conditionSnapshot).toEqual({
        conditionId: 101,
        conditionType: "PERCENTAGE_DISCOUNT",
        value: {
          customPriceCents: null,
          percentageBps: 1000,
          fixedDiscountCents: null,
        },
        baseUnitPriceCents: 5000,
        effectiveUnitPriceCents: 4500,
        unitDiscountCents: 500,
        quantity: 3,
        baseLineTotalCents: 15000,
        discountLineTotalCents: 1500,
        finalLineTotalCents: 13500,
        catalogueItemId: 42,
        petSize: "small",
        snapshotTimestamp: "2026-09-11T12:00:00.000Z",
      });
    });

    it("builds fallback snapshot when no condition applies (CATALOG)", () => {
      const snapshot = calculateResolvedSnapshot({
        baseUnitPriceCents: 8000,
        quantity: 2,
        catalogueItemId: 15,
      });

      expect(snapshot.pricingSourceType).toBe("CATALOG");
      expect(snapshot.appliedConditionId).toBeNull();
      expect(snapshot.baseUnitPriceCents).toBe(8000);
      expect(snapshot.effectiveUnitPriceCents).toBe(8000);
      expect(snapshot.unitDiscountCents).toBe(0);
      expect(snapshot.quantity).toBe(2);
      expect(snapshot.baseLineTotalCents).toBe(16000);
      expect(snapshot.discountLineTotalCents).toBe(0);
      expect(snapshot.finalLineTotalCents).toBe(16000);
      expect(snapshot.conditionSnapshot).toBeNull();
    });
  });
});
