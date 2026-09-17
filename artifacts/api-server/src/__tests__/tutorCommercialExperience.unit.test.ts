import { describe, it, expect, vi } from "vitest";
import {
  TutorCommercialExperienceService,
} from "../services/tutorCommercialExperience.service.js";
import { CrecheCampaignService } from "../services/crecheCampaign.service.js";
import { CrecheCampaignReservationService } from "../services/crecheCampaignReservation.service.js";
import { TutorCommercialPricingService } from "../services/tutorCommercialPricing.js";

describe("TutorCommercialExperienceService — Unit Tests (R37.D)", () => {
  describe("1. Server-Authoritative Commercial Offers Read Model", () => {
    it("returns formatted promotional offers with explainability and statusLabel", async () => {
      const mockClient = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([
                {
                  id: 201,
                  name: "Diária Day Care",
                  itemType: "day_use",
                  price: "100.00",
                },
              ]),
            }),
          }),
        }),
      };

      vi.spyOn(TutorCommercialPricingService, "resolveItemPriceForTutor").mockResolvedValueOnce({
        appliedConditionId: null,
        baseUnitPrice: "100.00",
        effectiveUnitPrice: "100.00",
        unitDiscount: "0.00",
        pricingSourceType: "CATALOG",
      } as any);

      vi.spyOn(CrecheCampaignService, "resolveEligibleCampaignsForTutor").mockResolvedValueOnce([
        {
          campaign: {
            id: 88,
            name: "Promoção Volta às Aulas",
            benefitType: "PERCENTAGE_DISCOUNT",
            conditionInteractionPolicy: "EXCLUDE_IF_TUTOR_CONDITION",
            validUntil: new Date("2026-10-31T23:59:59.000Z"),
          } as any,
          effectiveUnitPriceCents: 8000,
          unitDiscountCents: 2000,
        },
      ]);

      vi.spyOn(CrecheCampaignReservationService, "hasTutorCapacity").mockResolvedValueOnce(true);

      const result = await TutorCommercialExperienceService.getTutorCommercialOffers(
        1,
        42,
        { client: mockClient }
      );

      expect(result.tutorId).toBe(42);
      expect(result.crecheId).toBe(1);
      expect(result.offers).toHaveLength(1);

      const offer = result.offers[0];
      expect(offer.catalogueItemId).toBe(201);
      expect(offer.catalogueItemName).toBe("Diária Day Care");
      expect(offer.pricingSourceType).toBe("CAMPAIGN");
      expect(offer.campaignId).toBe(88);
      expect(offer.campaignName).toBe("Promoção Volta às Aulas");
      expect(offer.basePrice).toBe("100.00");
      expect(offer.effectivePrice).toBe("80.00");
      expect(offer.discountAmount).toBe("20.00");
      expect(offer.discountPercentage).toBe(20);
      expect(offer.statusLabel).toBe("Oferta disponível");
      expect(offer.isComplimentaryZeroValue).toBe(false);
    });

    it("correctly identifies complimentary zero-value offers (100% OFF)", async () => {
      const mockClient = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([
                {
                  id: 301,
                  name: "Avaliação Comportamental",
                  itemType: "service",
                  price: "150.00",
                },
              ]),
            }),
          }),
        }),
      };

      vi.spyOn(TutorCommercialPricingService, "resolveItemPriceForTutor").mockResolvedValueOnce({
        appliedConditionId: null,
        baseUnitPrice: "150.00",
        effectiveUnitPrice: "150.00",
        unitDiscount: "0.00",
        pricingSourceType: "CATALOG",
      } as any);

      vi.spyOn(CrecheCampaignService, "resolveEligibleCampaignsForTutor").mockResolvedValueOnce([
        {
          campaign: {
            id: 99,
            name: "Primeira Avaliação Grátis",
            benefitType: "PERCENTAGE_DISCOUNT",
            conditionInteractionPolicy: "EXCLUDE_IF_TUTOR_CONDITION",
            validUntil: new Date("2026-12-31T23:59:59.000Z"),
          } as any,
          effectiveUnitPriceCents: 0,
          unitDiscountCents: 15000,
        },
      ]);

      vi.spyOn(CrecheCampaignReservationService, "hasTutorCapacity").mockResolvedValueOnce(true);

      const result = await TutorCommercialExperienceService.getTutorCommercialOffers(
        1,
        42,
        { client: mockClient }
      );

      expect(result.offers).toHaveLength(1);
      const offer = result.offers[0];
      expect(offer.effectivePrice).toBe("0.00");
      expect(offer.discountAmount).toBe("150.00");
      expect(offer.discountPercentage).toBe(100);
      expect(offer.isComplimentaryZeroValue).toBe(true);
      expect(offer.statusLabel).toBe("Cortesia promocional (100% OFF)");
    });

    it("filters out campaigns when tutor has exceeded capacity limit", async () => {
      const mockClient = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([
                {
                  id: 201,
                  name: "Diária Day Care",
                  itemType: "day_use",
                  price: "100.00",
                },
              ]),
            }),
          }),
        }),
      };

      vi.spyOn(TutorCommercialPricingService, "resolveItemPriceForTutor").mockResolvedValueOnce({
        appliedConditionId: null,
        baseUnitPrice: "100.00",
        effectiveUnitPrice: "100.00",
        unitDiscount: "0.00",
        pricingSourceType: "CATALOG",
      } as any);

      vi.spyOn(CrecheCampaignService, "resolveEligibleCampaignsForTutor").mockResolvedValueOnce([
        {
          campaign: {
            id: 88,
            name: "Promoção Esgotada para este Tutor",
            benefitType: "PERCENTAGE_DISCOUNT",
            conditionInteractionPolicy: "EXCLUDE_IF_TUTOR_CONDITION",
          } as any,
          effectiveUnitPriceCents: 8000,
          unitDiscountCents: 2000,
        },
      ]);

      // hasTutorCapacity returns FALSE -> tutor already reached limit
      vi.spyOn(CrecheCampaignReservationService, "hasTutorCapacity").mockResolvedValueOnce(false);

      const result = await TutorCommercialExperienceService.getTutorCommercialOffers(
        1,
        42,
        { client: mockClient }
      );

      // No promotional offer should be returned
      expect(result.offers).toHaveLength(0);
    });
  });

  describe("2. IDOR Defense & Role Boundaries (Tutor Identity Lock)", () => {
    it("locks tutor to their own session user.id when querying commercial offers", async () => {
      const { resolveTargetTutorId } = await import("../routes/tutorCommercialOffers.routes.js");
      const targetTutorId = resolveTargetTutorId({ id: 77, role: "tutor" }, 77);
      expect(targetTutorId).toBe(77);
    });

    it("locks tutor to session user.id even if tutorId query param is omitted", async () => {
      const { resolveTargetTutorId } = await import("../routes/tutorCommercialOffers.routes.js");
      const targetTutorId = resolveTargetTutorId({ id: 77, role: "tutor" }, undefined);
      expect(targetTutorId).toBe(77);
    });

    it("strictly rejects tutor attempting to view another tutor's offers with 403 Forbidden", async () => {
      const { resolveTargetTutorId } = await import("../routes/tutorCommercialOffers.routes.js");
      expect(() =>
        resolveTargetTutorId({ id: 77, role: "tutor" }, 88)
      ).toThrow();
    });

    it("allows creche_admin to view a specific tutor's offers", async () => {
      const { resolveTargetTutorId } = await import("../routes/tutorCommercialOffers.routes.js");
      const targetTutorId = resolveTargetTutorId({ id: 1, role: "creche_admin", crecheId: 1 }, 88, 1);
      expect(targetTutorId).toBe(88);
    });

    it("strictly rejects master_admin from accessing commercial offers with 403 Forbidden", async () => {
      const { resolveTargetTutorId } = await import("../routes/tutorCommercialOffers.routes.js");
      expect(() =>
        resolveTargetTutorId({ id: 999, role: "master_admin" }, 88, 1)
      ).toThrow();
    });

    it("strictly rejects creche_admin when crecheId does not match routeCrecheId with 403 Forbidden", async () => {
      const { resolveTargetTutorId } = await import("../routes/tutorCommercialOffers.routes.js");
      expect(() =>
        resolveTargetTutorId({ id: 1, role: "creche_admin", crecheId: 2 }, 88, 1)
      ).toThrow();
    });

    it("strictly rejects tutor when crecheId does not match routeCrecheId with 403 Forbidden", async () => {
      const { resolveTargetTutorId } = await import("../routes/tutorCommercialOffers.routes.js");
      expect(() =>
        resolveTargetTutorId({ id: 77, role: "tutor", crecheId: 2 }, 77, 1)
      ).toThrow();
    });
  });

  describe("3. Zero Stacking & Commercial Interaction Regression (R37.D0.1)", () => {
    it("ALLOW_IF_BETTER: base=100, condition=80, campaign=70 -> result=70 (NEVER 50)", async () => {
      const { resolveCommercialPreview } = await import("../services/crecheCampaignPricing.js");

      const condition = {
        conditionId: 10,
        type: "FIXED_DISCOUNT" as const,
        discountAmount: "20.00",
        effectiveUnitPriceCents: 8000,
        unitDiscountCents: 2000,
      };

      const campaign = {
        campaign: {
          id: 55,
          name: "Campanha Super Desconto",
          benefitType: "FIXED_DISCOUNT" as const,
          conditionInteractionPolicy: "ALLOW_IF_BETTER" as const,
          priority: 100,
        } as any,
        effectiveUnitPriceCents: 7000,
        unitDiscountCents: 3000,
      };

      const result = resolveCommercialPreview({
        baseUnitPriceCents: 10000, // Base unit price R$ 100,00
        quantity: 1,               // Quantity 1
        tutorCondition: condition,
        eligibleCampaigns: [campaign],
      });

      // Best price wins: 70.00. NEVER stacked (100 - 20 - 30 = 50 is impossible)
      expect(result.pricingSourceType).toBe("CAMPAIGN");
      expect(result.effectiveUnitPriceCents).toBe(7000);
      expect(result.unitDiscountCents).toBe(3000);
      expect(result.finalLineTotalCents).toBe(7000);
      expect(result.appliedCampaignId).toBe(55);
      expect(result.appliedConditionId).toBeNull();
    });

    it("ALLOW_IF_BETTER: condition=70, campaign=70 -> tie strictly goes to TUTOR_CONDITION", async () => {
      const { resolveCommercialPreview } = await import("../services/crecheCampaignPricing.js");

      const condition = {
        conditionId: 10,
        type: "FIXED_DISCOUNT" as const,
        discountAmount: "30.00",
        effectiveUnitPriceCents: 7000,
        unitDiscountCents: 3000,
      };

      const campaign = {
        campaign: {
          id: 55,
          name: "Campanha Empate",
          benefitType: "FIXED_DISCOUNT" as const,
          conditionInteractionPolicy: "ALLOW_IF_BETTER" as const,
          priority: 100,
        } as any,
        effectiveUnitPriceCents: 7000,
        unitDiscountCents: 3000,
      };

      const result = resolveCommercialPreview({
        baseUnitPriceCents: 10000,
        quantity: 1,
        tutorCondition: condition,
        eligibleCampaigns: [campaign],
      });

      // Exact tie: individual tutor condition wins unconditionally
      expect(result.pricingSourceType).toBe("TUTOR_CONDITION");
      expect(result.effectiveUnitPriceCents).toBe(7000);
      expect(result.unitDiscountCents).toBe(3000);
      expect(result.appliedConditionId).toBe(10);
      expect(result.appliedCampaignId).toBeNull();
    });

    it("EXCLUDE_IF_TUTOR_CONDITION: tutor condition unconditionally wins even if campaign is cheaper", async () => {
      const { resolveCommercialPreview } = await import("../services/crecheCampaignPricing.js");

      const condition = {
        conditionId: 10,
        type: "FIXED_DISCOUNT" as const,
        discountAmount: "20.00",
        effectiveUnitPriceCents: 8000,
        unitDiscountCents: 2000,
      };

      const campaign = {
        campaign: {
          id: 55,
          name: "Campanha Barata Porém Excludente",
          benefitType: "FIXED_DISCOUNT" as const,
          conditionInteractionPolicy: "EXCLUDE_IF_TUTOR_CONDITION" as const,
          priority: 100,
        } as any,
        effectiveUnitPriceCents: 6000,
        unitDiscountCents: 4000,
      };

      const result = resolveCommercialPreview({
        baseUnitPriceCents: 10000,
        quantity: 1,
        tutorCondition: condition,
        eligibleCampaigns: [campaign],
      });

      // Condition wins unconditionally because campaign excludes tutor with condition
      expect(result.pricingSourceType).toBe("TUTOR_CONDITION");
      expect(result.effectiveUnitPriceCents).toBe(8000);
      expect(result.appliedConditionId).toBe(10);
      expect(result.appliedCampaignId).toBeNull();
    });
  });
});

