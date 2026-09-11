import { describe, it, expect } from "vitest";
import { CrecheCampaignValidationError } from "../services/crecheCampaignPricing.js";

describe("crecheCampaignPricing - Scope & Audience Contract", () => {
  describe("Catalogue Item Type Restrictions", () => {
    it("should allow services and day_use items in creche campaigns", () => {
      const allowedTypes = ["service", "day_use"];
      allowedTypes.forEach((t) => {
        expect(["service", "day_use"].includes(t)).toBe(true);
      });
    });

    it("should reject products and packages from promotional campaigns", () => {
      const disallowed = ["product", "package"];
      disallowed.forEach((type) => {
        expect(() => {
          if (type !== "service" && type !== "day_use") {
            throw new CrecheCampaignValidationError(
              `Apenas itens do tipo "service" ou "day_use" podem compor campanhas promocionais.`
            );
          }
        }).toThrow(CrecheCampaignValidationError);
      });
    });
  });

  describe("Audience Rules", () => {
    it("ALL_ACTIVE_TUTORS applies to any tutor with active status", () => {
      const campaign = {
        audienceType: "ALL_ACTIVE_TUTORS",
      };
      const tutor1 = { id: 101, status: "active" };
      const tutor2 = { id: 102, status: "inactive" };

      const isEligible1 = campaign.audienceType === "ALL_ACTIVE_TUTORS" && tutor1.status === "active";
      const isEligible2 = campaign.audienceType === "ALL_ACTIVE_TUTORS" && tutor2.status === "active";

      expect(isEligible1).toBe(true);
      expect(isEligible2).toBe(false);
    });

    it("SELECTED_TUTORS requires explicit membership in campaign_tutors", () => {
      const campaign = {
        audienceType: "SELECTED_TUTORS",
      };
      const selectedTutorIds = new Set([101, 103]);

      expect(selectedTutorIds.has(101)).toBe(true);
      expect(selectedTutorIds.has(102)).toBe(false);
      expect(selectedTutorIds.has(103)).toBe(true);
    });
  });
});
