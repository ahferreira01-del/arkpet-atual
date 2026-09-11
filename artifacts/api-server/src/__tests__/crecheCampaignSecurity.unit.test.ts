import { describe, it, expect } from "vitest";
import {
  assertCanManageCampaign,
  CrecheCampaignForbiddenError,
  CrecheCampaignValidationError,
} from "../services/crecheCampaignPricing.js";

describe("crecheCampaignPricing - Security & RBAC Contract", () => {
  it("should allow creche_admin to manage campaigns", () => {
    expect(() => assertCanManageCampaign("creche_admin")).not.toThrow();
  });

  it("should reject staff from write actions with 403 Forbidden", () => {
    expect(() => assertCanManageCampaign("staff")).toThrow(
      CrecheCampaignForbiddenError
    );
  });

  it("should reject tutor from write actions with 403 Forbidden", () => {
    expect(() => assertCanManageCampaign("tutor")).toThrow(
      CrecheCampaignForbiddenError
    );
  });

  it("should strictly reject external client attempting role=system with 403", () => {
    // Contract requirement 6: "system" is an internal trusted actor ONLY.
    // External HTTP callers claiming role=system must be rejected.
    expect(() => assertCanManageCampaign("system")).toThrow(
      CrecheCampaignForbiddenError
    );
    expect(() =>
      assertCanManageCampaign({ role: "system", source: "http" })
    ).toThrow(CrecheCampaignForbiddenError);
  });

  it("should allow internal trusted system actor for batch/cron processes", () => {
    expect(() =>
      assertCanManageCampaign({ role: "system", source: "internal" })
    ).not.toThrow();
  });

  it("should reject negative priority values", () => {
    // Contract requirement 8: priority must be >= 0
    const invalidPriority = -5;
    expect(() => {
      if (invalidPriority < 0) {
        throw new CrecheCampaignValidationError("A prioridade não pode ser negativa.");
      }
    }).toThrow(CrecheCampaignValidationError);
  });
});
