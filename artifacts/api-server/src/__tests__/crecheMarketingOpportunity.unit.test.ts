import { describe, it, expect, vi } from "vitest";
import {
  CrecheMarketingOpportunityService,
} from "../services/crecheMarketingOpportunity.service.js";
import {
  CrecheCampaignForbiddenError,
  CrecheCampaignValidationError,
} from "../services/crecheCampaignPricing.js";
import { CrecheCampaignService } from "../services/crecheCampaign.service.js";

describe("CrecheMarketingOpportunityService — Unit & RBAC Tests (R37.D)", () => {
  describe("1. Security & RBAC Boundaries", () => {
    it("allows creche_admin to view opportunities", () => {
      expect(() =>
        CrecheMarketingOpportunityService.assertCanView("creche_admin")
      ).not.toThrow();
    });

    it("allows staff to view opportunities (read-only)", () => {
      expect(() =>
        CrecheMarketingOpportunityService.assertCanView("staff")
      ).not.toThrow();
    });

    it("denies tutor from viewing opportunities with 403 Forbidden", () => {
      expect(() =>
        CrecheMarketingOpportunityService.assertCanView("tutor")
      ).toThrow(CrecheCampaignForbiddenError);
    });

    it("allows creche_admin to create campaign drafts from opportunities", () => {
      expect(() =>
        CrecheMarketingOpportunityService.assertCanMutate("creche_admin")
      ).not.toThrow();
    });

    it("denies staff from creating campaign drafts with 403 Forbidden", () => {
      expect(() =>
        CrecheMarketingOpportunityService.assertCanMutate("staff")
      ).toThrow(CrecheCampaignForbiddenError);
    });

    it("denies tutor from creating campaign drafts with 403 Forbidden", () => {
      expect(() =>
        CrecheMarketingOpportunityService.assertCanMutate("tutor")
      ).toThrow(CrecheCampaignForbiddenError);
    });

    it("denies master_admin from operational campaign draft mutations with 403 Forbidden", () => {
      expect(() =>
        CrecheMarketingOpportunityService.assertCanMutate("master_admin")
      ).toThrow(CrecheCampaignForbiddenError);
    });
  });

  describe("2. Draft Materialization & Validation Rules", () => {
    it("fails closed when target audience is empty", async () => {
      const mockClient = {};

      vi.spyOn(CrecheMarketingOpportunityService as any, "resolveAllOpportunityTutorIds").mockResolvedValueOnce({
        tutorIds: [],
        criteria: { days: 60 },
      });

      await expect(
        CrecheMarketingOpportunityService.createCampaignDraftFromOpportunity({
          crecheId: 1,
          opportunityType: "INACTIVE_TUTORS",
          days: 60,
          actor: { userId: 10, role: "creche_admin", source: "http" },
          client: mockClient,
        })
      ).rejects.toThrow(CrecheCampaignValidationError);
    });

    it("materializes draft campaign as DRAFT, SELECTED_TUTORS, without publication or notifications", async () => {
      vi.spyOn(CrecheMarketingOpportunityService as any, "resolveAllOpportunityTutorIds").mockResolvedValueOnce({
        tutorIds: [101, 102],
        criteria: { days: 60 },
      });

      const mockAuditInsert = vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
      const mockClient = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([
              { id: 501, name: "Diária Day Care", itemType: "day_use" },
            ]),
          }),
        }),
        insert: mockAuditInsert,
      };

      const mockCreateDraft = vi.spyOn(CrecheCampaignService, "createDraft").mockResolvedValueOnce({
        id: 999,
        crecheId: 1,
        name: "Reativação — Inativos 60 dias",
        description: "Campanha criada a partir da oportunidade CRM",
        benefitType: "PERCENTAGE_DISCOUNT",
        status: "DRAFT",
        audienceType: "SELECTED_TUTORS",
      } as any);

      const campaign = await CrecheMarketingOpportunityService.createCampaignDraftFromOpportunity({
        crecheId: 1,
        opportunityType: "INACTIVE_TUTORS",
        days: 60,
        actor: { userId: 10, role: "creche_admin", source: "http" },
        client: mockClient,
      });

      expect(campaign.id).toBe(999);
      expect(campaign.status).toBe("DRAFT");
      expect(campaign.audienceType).toBe("SELECTED_TUTORS");

      // Verify CrecheCampaignService.createDraft received the full materialized tutor list
      expect(mockCreateDraft).toHaveBeenCalledWith(
        1,
        { userId: 10, role: "creche_admin", source: "http" },
        expect.objectContaining({
          audienceType: "SELECTED_TUTORS",
          selectedTutorIds: [101, 102],
          itemIds: [501],
          usageLimitType: "ONCE_PER_TUTOR",
          usageLimitPerTutor: 1,
        }),
        undefined
      );

      // Verify audit insertion occurred
      expect(mockAuditInsert).toHaveBeenCalled();
    });
  });
});
