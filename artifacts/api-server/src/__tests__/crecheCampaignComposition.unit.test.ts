import { describe, it, expect } from "vitest";
import {
  pickWinningCampaign,
  resolveCommercialPreview,
} from "../services/crecheCampaignPricing.js";

describe("crecheCampaignPricing - Composition & Precedence Contract", () => {
  describe("pickWinningCampaign", () => {
    it("should choose the campaign with greatest financial advantage (lowest price)", () => {
      const candidates = [
        {
          campaign: { id: 1, priority: 100, name: "Campanha 10%" },
          effectiveUnitPriceCents: 9000,
          unitDiscountCents: 1000,
        },
        {
          campaign: { id: 2, priority: 100, name: "Campanha 20%" },
          effectiveUnitPriceCents: 8000,
          unitDiscountCents: 2000,
        },
      ];
      const winner = pickWinningCampaign(candidates as any);
      expect(winner?.campaign.id).toBe(2);
      expect(winner?.effectiveUnitPriceCents).toBe(8000);
    });

    it("should break price tie using highest priority (higher number = higher priority)", () => {
      const candidates = [
        {
          campaign: { id: 10, priority: 100, name: "Campanha P100" },
          effectiveUnitPriceCents: 8000,
          unitDiscountCents: 2000,
        },
        {
          campaign: { id: 20, priority: 200, name: "Campanha P200" },
          effectiveUnitPriceCents: 8000,
          unitDiscountCents: 2000,
        },
      ];
      const winner = pickWinningCampaign(candidates as any);
      expect(winner?.campaign.id).toBe(20); // Priority 200 wins
    });

    it("should break price and priority tie using lowest campaignId (older first)", () => {
      const candidates = [
        {
          campaign: { id: 50, priority: 100, name: "Campanha 50" },
          effectiveUnitPriceCents: 8000,
          unitDiscountCents: 2000,
        },
        {
          campaign: { id: 30, priority: 100, name: "Campanha 30" },
          effectiveUnitPriceCents: 8000,
          unitDiscountCents: 2000,
        },
      ];
      const winner = pickWinningCampaign(candidates as any);
      expect(winner?.campaign.id).toBe(30); // Smaller ID wins
    });

    it("should return null for empty candidates list", () => {
      expect(pickWinningCampaign([])).toBeNull();
    });
  });

  describe("resolveCommercialPreview - Interaction Policies", () => {
    const basePriceCents = 10000; // R$ 100,00

    it("should use CATALOG when tutor has no condition and no campaign", () => {
      const preview = resolveCommercialPreview({
        baseUnitPriceCents: basePriceCents,
        quantity: 1,
        tutorCondition: null,
        eligibleCampaigns: [],
      });
      expect(preview.pricingSourceType).toBe("CATALOG");
      expect(preview.effectiveUnitPriceCents).toBe(10000);
      expect(preview.unitDiscountCents).toBe(0);
      expect(preview.appliedConditionId).toBeNull();
      expect(preview.appliedCampaignId).toBeNull();
    });

    it("should apply campaign when tutor has no condition", () => {
      const preview = resolveCommercialPreview({
        baseUnitPriceCents: basePriceCents,
        quantity: 1,
        tutorCondition: null,
        eligibleCampaigns: [
          {
            campaign: {
              id: 1,
              name: "Promo Verão",
              priority: 100,
              interactionPolicy: "ALLOW_IF_BETTER",
            } as any,
            effectiveUnitPriceCents: 8500,
            unitDiscountCents: 1500,
          },
        ],
      });
      expect(preview.pricingSourceType).toBe("CAMPAIGN");
      expect(preview.appliedCampaignId).toBe(1);
      expect(preview.effectiveUnitPriceCents).toBe(8500);
      expect(preview.unitDiscountCents).toBe(1500);
    });

    it("EXCLUDE_IF_TUTOR_CONDITION: tutor condition always wins, campaign is ignored", () => {
      const preview = resolveCommercialPreview({
        baseUnitPriceCents: basePriceCents,
        quantity: 1,
        tutorCondition: {
          conditionId: 99,
          effectiveUnitPriceCents: 9000, // 10% off
          unitDiscountCents: 1000,
        },
        eligibleCampaigns: [
          {
            campaign: {
              id: 2,
              name: "Super Promo",
              priority: 100,
              interactionPolicy: "EXCLUDE_IF_TUTOR_CONDITION",
            } as any,
            effectiveUnitPriceCents: 7000, // 30% off, cheaper, but policy excludes!
            unitDiscountCents: 3000,
          },
        ],
      });
      expect(preview.pricingSourceType).toBe("TUTOR_CONDITION");
      expect(preview.appliedConditionId).toBe(99);
      expect(preview.appliedCampaignId).toBeNull();
      expect(preview.effectiveUnitPriceCents).toBe(9000);
    });

    it("ALLOW_IF_BETTER: campaign wins if it yields lower price than tutor condition", () => {
      const preview = resolveCommercialPreview({
        baseUnitPriceCents: basePriceCents,
        quantity: 1,
        tutorCondition: {
          conditionId: 99,
          effectiveUnitPriceCents: 9000, // R$ 90,00
          unitDiscountCents: 1000,
        },
        eligibleCampaigns: [
          {
            campaign: {
              id: 5,
              name: "Promo Black Friday",
              priority: 100,
              interactionPolicy: "ALLOW_IF_BETTER",
            } as any,
            effectiveUnitPriceCents: 7500, // R$ 75,00 (better!)
            unitDiscountCents: 2500,
          },
        ],
      });
      expect(preview.pricingSourceType).toBe("CAMPAIGN");
      expect(preview.appliedCampaignId).toBe(5);
      expect(preview.effectiveUnitPriceCents).toBe(7500);
    });

    it("ALLOW_IF_BETTER: tutor condition wins if condition is cheaper than campaign", () => {
      const preview = resolveCommercialPreview({
        baseUnitPriceCents: basePriceCents,
        quantity: 1,
        tutorCondition: {
          conditionId: 99,
          effectiveUnitPriceCents: 7000, // R$ 70,00
          unitDiscountCents: 3000,
        },
        eligibleCampaigns: [
          {
            campaign: {
              id: 6,
              name: "Promo Leve",
              priority: 100,
              interactionPolicy: "ALLOW_IF_BETTER",
            } as any,
            effectiveUnitPriceCents: 8500, // R$ 85,00 (worse)
            unitDiscountCents: 1500,
          },
        ],
      });
      expect(preview.pricingSourceType).toBe("TUTOR_CONDITION");
      expect(preview.appliedConditionId).toBe(99);
      expect(preview.appliedCampaignId).toBeNull();
      expect(preview.effectiveUnitPriceCents).toBe(7000);
    });

    it("ALLOW_IF_BETTER TIE CONTRACT: condition strictly wins when prices are identical", () => {
      const preview = resolveCommercialPreview({
        baseUnitPriceCents: basePriceCents,
        quantity: 1,
        tutorCondition: {
          conditionId: 99,
          effectiveUnitPriceCents: 8000, // R$ 80,00
          unitDiscountCents: 2000,
        },
        eligibleCampaigns: [
          {
            campaign: {
              id: 7,
              name: "Promo Empate",
              priority: 100,
              interactionPolicy: "ALLOW_IF_BETTER",
            } as any,
            effectiveUnitPriceCents: 8000, // R$ 80,00 (tie)
            unitDiscountCents: 2000,
          },
        ],
      });
      // CRITICAL CONTRACT: In case of equal prices, tutor commercial condition PREVAILS!
      expect(preview.pricingSourceType).toBe("TUTOR_CONDITION");
      expect(preview.appliedConditionId).toBe(99);
      expect(preview.appliedCampaignId).toBeNull();
      expect(preview.precedenceExplanation).toContain("Empate exato de preços");
    });
  });
});
