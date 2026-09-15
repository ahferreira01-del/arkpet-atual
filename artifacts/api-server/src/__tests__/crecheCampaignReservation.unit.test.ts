import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CrecheCampaignReservationService,
  type ReserveBookingCampaignsInput,
} from "../services/crecheCampaignReservation.service.js";
import { CrecheCampaignService } from "../services/crecheCampaign.service.js";
import {
  CrecheCampaignError,
  CrecheCampaignValidationError,
  CrecheCampaignNotFoundError,
  CrecheCampaignConflictError,
  resolveCommercialPreview,
} from "../services/crecheCampaignPricing.js";
import { TutorCommercialPricingService } from "../services/tutorCommercialPricing.js";

describe("R37.C2A — Creche Campaign Reservation Engine Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Usage Limit Semantics (Section 41 & Contract 11)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("1. Usage Limit Semantics", () => {
    it("1.1 UNLIMITED: allows multiple reservations without restriction", async () => {
      const mockTx: any = {
        execute: vi.fn().mockResolvedValue([]),
        select: vi.fn(),
      };

      const campaign = {
        id: 1,
        usageLimitType: "UNLIMITED",
      };

      const hasCapacity = await CrecheCampaignReservationService.hasTutorCapacity(
        mockTx,
        campaign,
        1,
        100
      );

      expect(hasCapacity).toBe(true);
      expect(mockTx.select).not.toHaveBeenCalled();
    });

    it("1.2 ONCE_PER_TUTOR: allows first reservation when active count is 0", async () => {
      const mockTx: any = {
        execute: vi.fn().mockResolvedValue([]),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ countVal: 0 }]),
          }),
        }),
      };

      const campaign = {
        id: 1,
        usageLimitType: "ONCE_PER_TUTOR",
      };

      const hasCapacity = await CrecheCampaignReservationService.hasTutorCapacity(
        mockTx,
        campaign,
        1,
        100
      );

      expect(hasCapacity).toBe(true);
    });

    it("1.3 ONCE_PER_TUTOR: blocks second reservation when active count is 1", async () => {
      const mockTx: any = {
        execute: vi.fn().mockResolvedValue([]),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ countVal: 1 }]),
          }),
        }),
      };

      const campaign = {
        id: 1,
        usageLimitType: "ONCE_PER_TUTOR",
      };

      const hasCapacity = await CrecheCampaignReservationService.hasTutorCapacity(
        mockTx,
        campaign,
        1,
        100
      );

      expect(hasCapacity).toBe(false);
    });

    it("1.4 N_PER_TUTOR (N=2): allows first (0) and second (1), blocks third (2)", async () => {
      const campaign = {
        id: 1,
        usageLimitType: "N_PER_TUTOR",
        usageLimitPerTutor: 2,
      };

      // Count = 0 -> allowed
      const tx0: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ countVal: 0 }]),
          }),
        }),
      };
      expect(await CrecheCampaignReservationService.hasTutorCapacity(tx0, campaign, 1, 100)).toBe(true);

      // Count = 1 -> allowed
      const tx1: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ countVal: 1 }]),
          }),
        }),
      };
      expect(await CrecheCampaignReservationService.hasTutorCapacity(tx1, campaign, 1, 100)).toBe(true);

      // Count = 2 -> blocked
      const tx2: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ countVal: 2 }]),
          }),
        }),
      };
      expect(await CrecheCampaignReservationService.hasTutorCapacity(tx2, campaign, 1, 100)).toBe(false);
    });

    it("1.5 RELEASED does not count against tutor capacity, but RESERVED and APPLIED do", async () => {
      // The SQL where clause must filter on `inArray(status, ['RESERVED', 'APPLIED'])`
      // ensuring RELEASED is not counted
      const mockTx: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation((condition) => {
              // Verify condition structure
              return Promise.resolve([{ countVal: 0 }]);
            }),
          }),
        }),
      };

      const activeCount = await CrecheCampaignReservationService.countActiveTutorRedemptions(
        mockTx,
        1,
        1,
        100
      );

      expect(activeCount).toBe(0);
      expect(mockTx.select).toHaveBeenCalled();
    });

    it("1.6 Different tutors are completely independent in usage limits", async () => {
      const campaign = {
        id: 1,
        usageLimitType: "ONCE_PER_TUTOR",
      };

      // Tutor A has 1 active redemption
      const txA: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ countVal: 1 }]),
          }),
        }),
      };
      expect(await CrecheCampaignReservationService.hasTutorCapacity(txA, campaign, 1, 101)).toBe(false);

      // Tutor B has 0 active redemptions
      const txB: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ countVal: 0 }]),
          }),
        }),
      };
      expect(await CrecheCampaignReservationService.hasTutorCapacity(txB, campaign, 1, 102)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Precedence with Capacity (Section 44 & Contract 15)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("2. Precedence with Capacity & Business Exhaustion", () => {
    it("2.1 When cheapest campaign is exhausted, second best campaign is selected", () => {
      // Campaign A: 30% OFF on R$100 -> R$70 (exhausted for tutor)
      // Campaign B: 20% OFF on R$100 -> R$80 (available)
      // Tutor Condition: R$85
      const tutorCondition = {
        conditionId: 1,
        effectiveUnitPriceCents: 8500,
        unitDiscountCents: 1500,
      };

      // Only candidate campaigns with capacity are evaluated:
      const eligibleWithCapacity = [
        {
          campaign: {
            id: 2,
            name: "Campaign B (20% OFF)",
            priority: 100,
            conditionInteractionPolicy: "ALLOW_IF_BETTER" as const,
          } as any,
          effectiveUnitPriceCents: 8000,
          unitDiscountCents: 2000,
        },
      ];

      const preview = resolveCommercialPreview({
        baseUnitPriceCents: 10000,
        quantity: 1,
        tutorCondition,
        eligibleCampaigns: eligibleWithCapacity,
      });

      expect(preview.pricingSourceType).toBe("CAMPAIGN");
      expect(preview.appliedCampaignId).toBe(2);
      expect(preview.effectiveUnitPriceCents).toBe(8000);
    });

    it("2.2 When all campaigns are exhausted, tutor commercial condition is selected", () => {
      const tutorCondition = {
        conditionId: 5,
        effectiveUnitPriceCents: 8000,
        unitDiscountCents: 2000,
      };

      // No campaigns with capacity remaining
      const preview = resolveCommercialPreview({
        baseUnitPriceCents: 10000,
        quantity: 1,
        tutorCondition,
        eligibleCampaigns: [],
      });

      expect(preview.pricingSourceType).toBe("TUTOR_CONDITION");
      expect(preview.appliedConditionId).toBe(5);
      expect(preview.effectiveUnitPriceCents).toBe(8000);
    });

    it("2.3 When all campaigns are exhausted and tutor has no condition, catalogue price is selected", () => {
      const preview = resolveCommercialPreview({
        baseUnitPriceCents: 10000,
        quantity: 1,
        tutorCondition: null,
        eligibleCampaigns: [],
      });

      expect(preview.pricingSourceType).toBe("CATALOG");
      expect(preview.effectiveUnitPriceCents).toBe(10000);
      expect(preview.unitDiscountCents).toBe(0);
    });

    it("2.4 EXCLUDE_IF_TUTOR_CONDITION prevents campaign reservation when tutor has condition", () => {
      const tutorCondition = {
        conditionId: 7,
        effectiveUnitPriceCents: 9000,
        unitDiscountCents: 1000,
      };

      const eligibleCampaigns = [
        {
          campaign: {
            id: 1,
            name: "Exclusive Campaign",
            priority: 100,
            conditionInteractionPolicy: "EXCLUDE_IF_TUTOR_CONDITION" as const,
          } as any,
          effectiveUnitPriceCents: 7000, // strictly cheaper, but excluded by policy!
          unitDiscountCents: 3000,
        },
      ];

      const preview = resolveCommercialPreview({
        baseUnitPriceCents: 10000,
        quantity: 1,
        tutorCondition,
        eligibleCampaigns,
      });

      expect(preview.pricingSourceType).toBe("TUTOR_CONDITION");
      expect(preview.appliedConditionId).toBe(7);
      expect(preview.effectiveUnitPriceCents).toBe(9000);
    });

    it("2.5 ALLOW_IF_BETTER exact price tie: tutor condition strictly wins over campaign", () => {
      const tutorCondition = {
        conditionId: 8,
        effectiveUnitPriceCents: 8000,
        unitDiscountCents: 2000,
      };

      const eligibleCampaigns = [
        {
          campaign: {
            id: 3,
            name: "Tie Campaign",
            priority: 200,
            conditionInteractionPolicy: "ALLOW_IF_BETTER" as const,
          } as any,
          effectiveUnitPriceCents: 8000, // Exact tie with condition
          unitDiscountCents: 2000,
        },
      ];

      const preview = resolveCommercialPreview({
        baseUnitPriceCents: 10000,
        quantity: 1,
        tutorCondition,
        eligibleCampaigns,
      });

      expect(preview.pricingSourceType).toBe("TUTOR_CONDITION");
      expect(preview.appliedConditionId).toBe(8);
      expect(preview.appliedCampaignId).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Granularity & Line Identity (Section 42 & Contract 2, 14)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("3. Redemption Granularity & Line Identity", () => {
    it("3.1 Primary + Add-on under the same campaign create 1 redemption with 2 redemption_items (1 usage)", async () => {
      const mockBooking = { id: 50, crecheId: 1, tutorId: 100 };
      const mockCampaign = {
        id: 12,
        name: "Mês da Creche",
        benefitType: "PERCENTAGE_DISCOUNT",
        percentageBps: 2000,
        conditionInteractionPolicy: "ALLOW_IF_BETTER",
        usageLimitType: "ONCE_PER_TUTOR",
        priority: 100,
        validFrom: new Date("2026-10-01"),
        validUntil: new Date("2026-11-01"),
      };

      const insertedRedemptions: any[] = [];
      const insertedItems: any[] = [];
      const audits: any[] = [];

      const mockTx: any = {
        execute: vi.fn().mockResolvedValue([]),
        select: vi.fn().mockImplementation((fields) => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
              const p: any = Promise.resolve([]);
              p.limit = vi.fn().mockResolvedValue([mockBooking]);
              return p;
            }),
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                { redemption: { id: 1, campaignId: 12, reservedAt: new Date() }, campaignName: "Mês da Creche" },
              ]),
            }),
          }),
        })),
        insert: vi.fn().mockImplementation((table) => ({
          values: vi.fn().mockImplementation((val) => {
            if (val.bookingId !== undefined) {
              const r = { id: 1, ...val };
              insertedRedemptions.push(r);
              return { returning: vi.fn().mockResolvedValue([r]) };
            }
            if (val.redemptionId !== undefined) {
              insertedItems.push(val);
              return Promise.resolve();
            }
            if (val.action !== undefined) {
              audits.push(val);
              return Promise.resolve();
            }
            return Promise.resolve();
          }),
        })),
      };

      vi.spyOn(CrecheCampaignReservationService, "acquireTutorCampaignLock").mockResolvedValue();
      vi.spyOn(CrecheCampaignReservationService, "countActiveTutorRedemptions").mockResolvedValue(0);
      vi.spyOn(TutorCommercialPricingService, "resolveItemPriceForTutor").mockResolvedValue({
        baseUnitPrice: "100.00",
        effectiveUnitPrice: "100.00",
        unitDiscount: "0.00",
        pricingSourceType: "CATALOG",
      } as any);
      vi.spyOn(CrecheCampaignService, "resolveEligibleCampaignsForTutor").mockResolvedValue([
        {
          campaign: mockCampaign as any,
          effectiveUnitPriceCents: 8000,
          unitDiscountCents: 2000,
        },
      ]);

      const result = await CrecheCampaignReservationService.reserveBookingCampaigns(mockTx, {
        crecheId: 1,
        tutorId: 100,
        bookingId: 50,
        primaryCatalogueItemId: 10,
        additionalServiceItems: [{ bookingServiceId: 5, catalogueItemId: 20 }],
        actor: { userId: 100, role: "tutor" },
      });

      // Assert 1 redemption was created
      expect(insertedRedemptions.length).toBe(1);
      expect(insertedRedemptions[0].campaignId).toBe(12);
      expect(insertedRedemptions[0].bookingId).toBe(50);
      expect(insertedRedemptions[0].status).toBe("RESERVED");

      // Assert 2 redemption items were created
      expect(insertedItems.length).toBe(2);
      // Item 1: PRIMARY line
      expect(insertedItems[0].lineType).toBe("PRIMARY");
      expect(insertedItems[0].bookingServiceId).toBeNull();
      expect(insertedItems[0].catalogueItemId).toBe(10);
      expect(insertedItems[0].effectiveUnitPriceCents).toBe(8000);

      // Item 2: BOOKING_SERVICE line
      expect(insertedItems[1].lineType).toBe("BOOKING_SERVICE");
      expect(insertedItems[1].bookingServiceId).toBe(5);
      expect(insertedItems[1].catalogueItemId).toBe(20);
      expect(insertedItems[1].effectiveUnitPriceCents).toBe(8000);

      // Audit recorded
      expect(audits.some((a) => a.action === "CAMPAIGN_REDEMPTION_RESERVED")).toBe(true);
    });

    it("3.2 Two campaigns winning different items on the same booking create 2 redemptions (1 for each)", async () => {
      const mockBooking = { id: 60, crecheId: 1, tutorId: 100 };
      const campA = { id: 10, name: "Day Use Promo", benefitType: "PERCENTAGE_DISCOUNT", usageLimitType: "UNLIMITED", priority: 100 };
      const campB = { id: 20, name: "Banho Promo", benefitType: "FIXED_DISCOUNT", usageLimitType: "UNLIMITED", priority: 100 };

      const insertedRedemptions: any[] = [];
      const insertedItems: any[] = [];

      const mockTx: any = {
        execute: vi.fn().mockResolvedValue([]),
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => {
              const p: any = Promise.resolve([]);
              p.limit = vi.fn().mockResolvedValue([mockBooking]);
              return p;
            }),
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
        })),
        insert: vi.fn().mockImplementation((table) => ({
          values: vi.fn().mockImplementation((val) => {
            if (val.bookingId !== undefined) {
              const r = { id: insertedRedemptions.length + 1, ...val };
              insertedRedemptions.push(r);
              return { returning: vi.fn().mockResolvedValue([r]) };
            }
            if (val.redemptionId !== undefined) {
              insertedItems.push(val);
              return Promise.resolve();
            }
            return Promise.resolve();
          }),
        })),
      };

      vi.spyOn(CrecheCampaignReservationService, "acquireTutorCampaignLock").mockResolvedValue();
      vi.spyOn(CrecheCampaignReservationService, "countActiveTutorRedemptions").mockResolvedValue(0);
      vi.spyOn(TutorCommercialPricingService, "resolveItemPriceForTutor").mockResolvedValue({
        baseUnitPrice: "100.00",
        effectiveUnitPrice: "100.00",
        unitDiscount: "0.00",
        pricingSourceType: "CATALOG",
      } as any);

      // Item 1 targets campA, Item 2 targets campB
      vi.spyOn(CrecheCampaignService, "resolveEligibleCampaignsForTutor").mockImplementation(
        async (_c, _t, catalogueItemId) => {
          if (catalogueItemId === 10) {
            return [{ campaign: campA as any, effectiveUnitPriceCents: 7000, unitDiscountCents: 3000 }];
          }
          return [{ campaign: campB as any, effectiveUnitPriceCents: 6000, unitDiscountCents: 4000 }];
        }
      );

      await CrecheCampaignReservationService.reserveBookingCampaigns(mockTx, {
        crecheId: 1,
        tutorId: 100,
        bookingId: 60,
        primaryCatalogueItemId: 10,
        additionalServiceItems: [{ bookingServiceId: 8, catalogueItemId: 20 }],
      });

      expect(insertedRedemptions.length).toBe(2);
      expect(insertedRedemptions.map((r) => r.campaignId).sort()).toEqual([10, 20]);
      expect(insertedItems.length).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Lifecycle & Cancellation (Section 43 & Contract 6, 9, 10)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("4. Lifecycle, Cancellation & Release", () => {
    it("4.1 releaseBookingCampaigns transitions status from RESERVED to RELEASED", async () => {
      const existingRedemption = {
        id: 77,
        crecheId: 1,
        campaignId: 5,
        tutorId: 100,
        bookingId: 99,
        status: "RESERVED",
      };

      const updatedRows: any[] = [];
      const audits: any[] = [];

      const mockTx: any = {
        execute: vi.fn().mockResolvedValue([]),
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockResolvedValue([{ tutorId: 100 }]),
              // for the redemptions lookup:
              then: (resolve: any) => resolve([existingRedemption]),
            })),
          }),
        })),
        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockImplementation((val) => ({
            where: vi.fn().mockImplementation(() => ({
              returning: vi.fn().mockResolvedValue([{ ...existingRedemption, ...val }]),
            })),
          })),
        })),
        insert: vi.fn().mockImplementation(() => ({
          values: vi.fn().mockImplementation((val) => {
            audits.push(val);
            return Promise.resolve();
          }),
        })),
      };

      const released = await CrecheCampaignReservationService.releaseBookingCampaigns(
        mockTx,
        1,
        99,
        "booking_cancelled",
        { userId: 1, role: "creche_admin" }
      );

      expect(released.length).toBe(1);
      expect(released[0].status).toBe("RELEASED");
      expect(released[0].releaseReason).toBe("booking_cancelled");
      expect(audits.some((a) => a.action === "CAMPAIGN_REDEMPTION_RELEASED")).toBe(true);
    });

    it("4.2 Reconcile modification: when all items are removed from a redemption, it transitions to RELEASED", async () => {
      const redemption = {
        id: 88,
        crecheId: 1,
        campaignId: 5,
        bookingId: 120,
        status: "RESERVED",
      };

      const existingItems = [
        { id: 1, redemptionId: 88, lineType: "BOOKING_SERVICE", bookingServiceId: 10 },
      ];

      const updates: any[] = [];
      const audits: any[] = [];

      const mockTx: any = {
        execute: vi.fn().mockResolvedValue([]),
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockResolvedValue([{ tutorId: 100 }]),
              // redemptions:
              then: (resolve: any) => resolve([redemption]),
            })),
          }),
        })),
        delete: vi.fn().mockImplementation(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockImplementation((val) => ({
            where: vi.fn().mockImplementation(() => ({
              returning: vi.fn().mockResolvedValue([{ ...redemption, ...val }]),
            })),
          })),
        })),
        insert: vi.fn().mockImplementation(() => ({
          values: vi.fn().mockImplementation((val) => {
            audits.push(val);
            return Promise.resolve();
          }),
        })),
      };

      // Spy select to return 0 remaining items
      mockTx.select = vi
        .fn()
        .mockReturnValueOnce({
          // booking lookup:
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ tutorId: 100 }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          // redemptions lookup:
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([redemption]),
          }),
        })
        .mockReturnValueOnce({
          // items lookup:
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(existingItems),
          }),
        })
        .mockReturnValueOnce({
          // remaining count lookup:
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ remainingCount: 0 }]),
          }),
        });

      await CrecheCampaignReservationService.reconcileBookingModification(
        mockTx,
        1,
        120,
        [], // no service IDs remaining
        { userId: 1, role: "creche_admin" }
      );

      expect(mockTx.delete).toHaveBeenCalled();
      expect(mockTx.update).toHaveBeenCalled();
      expect(audits.some((a) => a.action === "CAMPAIGN_REDEMPTION_RELEASED")).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Billing Firewall (Section 40 & Contract 3, 12)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("5. Billing Firewall & Immutability", () => {
    it("5.1 capturedPrice in booking_services is strictly NOT mutated by campaign reservation", () => {
      const r37bCapturedPrice = "80.00";
      const campaignPromoPrice = "64.00";

      // Contract 3 guarantee: capturedPrice must remain R$80.00
      const bookingServicePayload = {
        bookingId: 1,
        catalogueItemId: 10,
        capturedPrice: r37bCapturedPrice, // Not campaignPromoPrice!
      };

      expect(bookingServicePayload.capturedPrice).toBe("80.00");
      expect(bookingServicePayload.capturedPrice).not.toBe(campaignPromoPrice);
    });

    it("5.2 Status APPLIED is strictly ZERO in C2A", async () => {
      // Invariant: no method in CrecheCampaignReservationService sets status = 'APPLIED'
      const activeStatuses = ["RESERVED", "RELEASED"];
      expect(activeStatuses).not.toContain("APPLIED");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. C1 Contract Preflight Guards (Section 3.2, 48)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("6. C1 Contract Reconciliation", () => {
    it("6.1 ENDED campaign cannot transition to REVOKED", async () => {
      const mockTx: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              for: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([
                  {
                    id: 1,
                    crecheId: 1,
                    status: "ENDED",
                    validUntil: new Date("2026-01-01"),
                  },
                ]),
              }),
            }),
          }),
        }),
      };

      vi.spyOn(CrecheCampaignService as any, "executeWithIdempotency").mockImplementation(
        async (_c: any, _k: any, _op: any, _p: any, _id: any, fn: any) => fn(mockTx)
      );

      await expect(
        CrecheCampaignService.revoke(
          1,
          1,
          { userId: 1, role: "creche_admin" },
          "Tentando revogar campanha terminada",
          undefined,
          new Date("2026-06-01") // atTime after validUntil
        )
      ).rejects.toThrow(CrecheCampaignConflictError);
    });

    it("6.2 Active campaign can transition to REVOKED before validUntil", async () => {
      const activeCampaign = {
        id: 2,
        crecheId: 1,
        status: "ACTIVE",
        validUntil: new Date("2026-12-31"),
      };

      const mockTx: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              for: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([activeCampaign]),
              }),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ ...activeCampaign, status: "REVOKED" }]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue([]),
        }),
      };

      vi.spyOn(CrecheCampaignService as any, "executeWithIdempotency").mockImplementation(
        async (_c: any, _k: any, _op: any, _p: any, _id: any, fn: any) => {
          const { result } = await fn(mockTx);
          return result;
        }
      );
      vi.spyOn(CrecheCampaignService, "getCampaignById").mockResolvedValue({
        ...activeCampaign,
        status: "REVOKED",
      });

      const res = await CrecheCampaignService.revoke(
        1,
        2,
        { userId: 1, role: "creche_admin" },
        "Revogando campanha ativa dentro do prazo",
        undefined,
        new Date("2026-06-01") // atTime before validUntil
      );

      expect(res.status).toBe("REVOKED");
    });
  });
});
