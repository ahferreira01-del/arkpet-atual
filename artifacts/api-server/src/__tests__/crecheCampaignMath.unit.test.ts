import { describe, it, expect } from "vitest";
import {
  calculateCampaignPrice,
  validateItemPricesForFixedPromotionalPrice,
  CrecheCampaignValidationError,
  type CampaignBenefitInput,
  type CatalogueItemSalePrices,
} from "../services/crecheCampaignPricing.js";

describe("crecheCampaignPricing - Pure Math & Size Pricing Validation", () => {
  describe("PERCENTAGE_DISCOUNT", () => {
    it("should calculate 10% discount correctly (1000 bps)", () => {
      const benefit: CampaignBenefitInput = {
        benefitType: "PERCENTAGE_DISCOUNT",
        percentageBps: 1000,
      };
      const result = calculateCampaignPrice(10000, benefit); // R$ 100,00
      expect(result.baseUnitPriceCents).toBe(10000);
      expect(result.effectiveUnitPriceCents).toBe(9000); // R$ 90,00
      expect(result.unitDiscountCents).toBe(1000); // R$ 10,00
      expect(result.baseUnitPrice).toBe("100.00");
      expect(result.effectiveUnitPrice).toBe("90.00");
      expect(result.unitDiscount).toBe("10.00");
      expect(result.finalLineTotalCents).toBe(9000);
    });

    it("should calculate 15% discount on R$ 50,00 (1500 bps)", () => {
      const benefit: CampaignBenefitInput = {
        benefitType: "PERCENTAGE_DISCOUNT",
        percentageBps: 1500,
      };
      const result = calculateCampaignPrice(5000, benefit); // R$ 50,00
      expect(result.effectiveUnitPriceCents).toBe(4250); // R$ 42,50
      expect(result.unitDiscountCents).toBe(750); // R$ 7,50
    });

    it("should handle 100% discount (10000 bps) resulting in 0 price", () => {
      const benefit: CampaignBenefitInput = {
        benefitType: "PERCENTAGE_DISCOUNT",
        percentageBps: 10000,
      };
      const result = calculateCampaignPrice(12000, benefit);
      expect(result.effectiveUnitPriceCents).toBe(0);
      expect(result.unitDiscountCents).toBe(12000);
      expect(result.effectiveUnitPrice).toBe("0.00");
    });

    it("should handle rounding properly with 33.33% (3333 bps)", () => {
      const benefit: CampaignBenefitInput = {
        benefitType: "PERCENTAGE_DISCOUNT",
        percentageBps: 3333,
      };
      const result = calculateCampaignPrice(10000, benefit); // 100.00
      expect(result.unitDiscountCents).toBe(3333);
      expect(result.effectiveUnitPriceCents).toBe(6667);
    });

    it("should reject percentage bps < 1 or > 10000", () => {
      expect(() =>
        calculateCampaignPrice(10000, {
          benefitType: "PERCENTAGE_DISCOUNT",
          percentageBps: 0,
        })
      ).toThrow(CrecheCampaignValidationError);

      expect(() =>
        calculateCampaignPrice(10000, {
          benefitType: "PERCENTAGE_DISCOUNT",
          percentageBps: 10001,
        })
      ).toThrow(CrecheCampaignValidationError);
    });
  });

  describe("FIXED_DISCOUNT", () => {
    it("should calculate fixed discount of R$ 20,00 on R$ 100,00", () => {
      const benefit: CampaignBenefitInput = {
        benefitType: "FIXED_DISCOUNT",
        fixedDiscountCents: 2000,
      };
      const result = calculateCampaignPrice(10000, benefit);
      expect(result.effectiveUnitPriceCents).toBe(8000);
      expect(result.unitDiscountCents).toBe(2000);
      expect(result.effectiveUnitPrice).toBe("80.00");
    });

    it("should cap fixed discount at base price when discount > basePrice (cannot produce negative price)", () => {
      const benefit: CampaignBenefitInput = {
        benefitType: "FIXED_DISCOUNT",
        fixedDiscountCents: 15000, // R$ 150,00 discount on R$ 100,00
      };
      const result = calculateCampaignPrice(10000, benefit);
      expect(result.effectiveUnitPriceCents).toBe(0);
      expect(result.unitDiscountCents).toBe(10000);
      expect(result.effectiveUnitPrice).toBe("0.00");
    });

    it("should reject fixed discount <= 0", () => {
      expect(() =>
        calculateCampaignPrice(10000, {
          benefitType: "FIXED_DISCOUNT",
          fixedDiscountCents: 0,
        })
      ).toThrow(CrecheCampaignValidationError);

      expect(() =>
        calculateCampaignPrice(10000, {
          benefitType: "FIXED_DISCOUNT",
          fixedDiscountCents: -500,
        })
      ).toThrow(CrecheCampaignValidationError);
    });
  });

  describe("FIXED_PROMOTIONAL_PRICE", () => {
    it("should set exact promotional price of R$ 65,00 on R$ 100,00", () => {
      const benefit: CampaignBenefitInput = {
        benefitType: "FIXED_PROMOTIONAL_PRICE",
        fixedPromotionalPriceCents: 6500,
      };
      const result = calculateCampaignPrice(10000, benefit);
      expect(result.effectiveUnitPriceCents).toBe(6500);
      expect(result.unitDiscountCents).toBe(3500);
      expect(result.effectiveUnitPrice).toBe("65.00");
      expect(result.unitDiscount).toBe("35.00");
    });

    it("should allow promotional price equal to base price (0 discount)", () => {
      const benefit: CampaignBenefitInput = {
        benefitType: "FIXED_PROMOTIONAL_PRICE",
        fixedPromotionalPriceCents: 10000,
      };
      const result = calculateCampaignPrice(10000, benefit);
      expect(result.effectiveUnitPriceCents).toBe(10000);
      expect(result.unitDiscountCents).toBe(0);
    });

    it("should reject promotional price higher than base price", () => {
      const benefit: CampaignBenefitInput = {
        benefitType: "FIXED_PROMOTIONAL_PRICE",
        fixedPromotionalPriceCents: 11000, // R$ 110,00 on R$ 100,00
      };
      expect(() => calculateCampaignPrice(10000, benefit)).toThrow(
        CrecheCampaignValidationError
      );
    });

    it("should reject negative promotional price", () => {
      const benefit: CampaignBenefitInput = {
        benefitType: "FIXED_PROMOTIONAL_PRICE",
        fixedPromotionalPriceCents: -100,
      };
      expect(() => calculateCampaignPrice(10000, benefit)).toThrow(
        CrecheCampaignValidationError
      );
    });
  });

  describe("Quantity Multipliers", () => {
    it("should scale line totals proportionally with quantity", () => {
      const benefit: CampaignBenefitInput = {
        benefitType: "PERCENTAGE_DISCOUNT",
        percentageBps: 2000, // 20%
      };
      const result = calculateCampaignPrice(5000, benefit, { quantity: 4 });
      expect(result.quantity).toBe(4);
      expect(result.baseUnitPriceCents).toBe(5000);
      expect(result.effectiveUnitPriceCents).toBe(4000);
      expect(result.unitDiscountCents).toBe(1000);
      expect(result.baseLineTotalCents).toBe(20000);
      expect(result.discountLineTotalCents).toBe(4000);
      expect(result.finalLineTotalCents).toBe(16000);
      expect(result.finalLineTotal).toBe("160.00");
    });
  });

  describe("validateItemPricesForFixedPromotionalPrice - Size Pricing Rules (Requirement 1)", () => {
    const multiSizeItem: CatalogueItemSalePrices = {
      id: 1,
      name: "Diária Creche Completa",
      itemType: "service",
      crecheId: 10,
      basePrice: "100.00",
      priceSmall: "80.00",
      priceMedium: "100.00",
      priceLarge: "120.00",
    };

    it("should reject fixed promotional price (R$ 85,00) higher than lowest variant price (R$ 80,00)", () => {
      // 85.00 is lower than base (100) and large (120), but higher than small (80).
      // A promotional price must NOT increase the price for ANY variant!
      expect(() =>
        validateItemPricesForFixedPromotionalPrice(multiSizeItem, 8500)
      ).toThrow(CrecheCampaignValidationError);
    });

    it("should allow fixed promotional price equal to lowest variant price (R$ 80,00)", () => {
      expect(() =>
        validateItemPricesForFixedPromotionalPrice(multiSizeItem, 8000)
      ).not.toThrow();
    });

    it("should allow fixed promotional price lower than lowest variant price (R$ 75,00)", () => {
      expect(() =>
        validateItemPricesForFixedPromotionalPrice(multiSizeItem, 7500)
      ).not.toThrow();
    });

    it("should validate correctly for item with only basePrice", () => {
      const singlePriceItem: CatalogueItemSalePrices = {
        id: 2,
        name: "Banho Simples",
        itemType: "service",
        crecheId: 10,
        basePrice: "60.00",
      };

      expect(() =>
        validateItemPricesForFixedPromotionalPrice(singlePriceItem, 5000)
      ).not.toThrow();

      expect(() =>
        validateItemPricesForFixedPromotionalPrice(singlePriceItem, 6500)
      ).toThrow(CrecheCampaignValidationError);
    });

    it("should reject item with no prices defined", () => {
      const noPriceItem: CatalogueItemSalePrices = {
        id: 3,
        name: "Item Sem Preço",
        itemType: "service",
        crecheId: 10,
        basePrice: null as any,
      };

      expect(() =>
        validateItemPricesForFixedPromotionalPrice(noPriceItem, 5000)
      ).toThrow(CrecheCampaignValidationError);
    });
  });
});
