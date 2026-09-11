import { describe, it, expect } from "vitest";
import {
  TutorCommercialPricingService,
  TutorCommercialForbiddenError,
} from "../services/tutorCommercialPricing.js";

describe("TutorCommercialSecurity - Role & Boundary Unit Tests (R37.B)", () => {
  it("allows creche_admin to manage tutor commercial conditions", () => {
    expect(() =>
      TutorCommercialPricingService.assertCanManage({
        userId: 1,
        role: "creche_admin",
      })
    ).not.toThrow();
  });

  it("allows system to manage tutor commercial conditions", () => {
    expect(() =>
      TutorCommercialPricingService.assertCanManage({
        userId: 0,
        role: "system",
      })
    ).not.toThrow();
  });

  it("denies staff from mutating tutor commercial conditions", () => {
    expect(() =>
      TutorCommercialPricingService.assertCanManage({
        userId: 2,
        role: "staff",
      })
    ).toThrow(TutorCommercialForbiddenError);
  });

  it("denies tutor from mutating tutor commercial conditions", () => {
    expect(() =>
      TutorCommercialPricingService.assertCanManage({
        userId: 3,
        role: "tutor",
      })
    ).toThrow(TutorCommercialForbiddenError);
  });

  it("denies master_admin from direct operational mutations (Correction 4)", () => {
    expect(() =>
      TutorCommercialPricingService.assertCanManage({
        userId: 4,
        role: "master_admin",
      })
    ).toThrow(TutorCommercialForbiddenError);
  });
});
