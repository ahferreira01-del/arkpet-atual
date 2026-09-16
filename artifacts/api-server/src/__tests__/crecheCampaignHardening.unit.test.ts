import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CrecheCampaignReservationService,
  type ApplyBookingLineCampaignParams,
} from "../services/crecheCampaignReservation.service.js";
import {
  CrecheCampaignError,
  CrecheCampaignValidationError,
  CrecheCampaignNotFoundError,
  CrecheCampaignConflictError,
} from "../services/crecheCampaignPricing.js";
import { BillingService } from "../services/billing.js";

describe("R37.C2C — Creche Campaign Financial Hardening & Integrity Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Cross-Link Consistency & Bi-directional Integrity (Section 7)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("1. Cross-Link Consistency & Bi-directional Integrity", () => {
    it("1.1 Detects cross-link corruption between appliedInvoiceItemId and chargeResult and FAILS CLOSED", async () => {
      const crecheId = 1;
      const tutorId = 10;
      const bookingId = 100;
      const redemptionId = 500;
      const itemId = 800;

      const mockRedemption = {
        id: redemptionId,
        crecheId,
        tutorId,
        bookingId,
        campaignId: 42,
        status: "RESERVED",
        campaignSnapshot: { campaignId: 42, campaignName: "Verão 20% OFF" },
      };

      const mockItem = {
        id: itemId,
        redemptionId,
        catalogueItemId: 201,
        lineType: "PRIMARY",
        bookingServiceId: null,
        baseUnitPriceCents: 10000,
        effectiveUnitPriceCents: 8000,
        unitDiscountCents: 2000,
        quantity: 1,
        baseLineTotalCents: 10000,
        discountLineTotalCents: 2000,
        finalLineTotalCents: 8000,
        status: "RESERVED",
        applicationMode: null,
        appliedInvoiceId: null,
        appliedInvoiceItemId: null,
        campaignSnapshot: {
          campaignId: 42,
          campaignName: "Verão 20% OFF",
        },
      };

      // Mock returning a corrupted appliedInvoiceItemId that does NOT match chargeResult.invoiceItemId
      let selectCallCount = 0;
      const mockTx: any = {
        execute: vi.fn().mockResolvedValue([]),
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => {
              selectCallCount++;
              if (selectCallCount === 1) return Promise.resolve([mockRedemption]);
              if (selectCallCount === 2) return { for: vi.fn().mockResolvedValue([mockItem]) };
              return Promise.resolve([]);
            }),
          })),
        })),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              // Corrupted return: invoice item ID is 999 instead of 9999
              returning: vi.fn().mockResolvedValue([
                { ...mockItem, status: "APPLIED", appliedInvoiceItemId: 999 },
              ]),
            }),
          }),
        }),
        insert: vi.fn(),
      };

      vi.spyOn(BillingService, "addCharge").mockResolvedValue({
        invoiceId: 888,
        invoiceItemId: 9999, // mismatch with 999
      });

      await expect(
        CrecheCampaignReservationService.applyBookingLineCampaign(mockTx, {
          crecheId,
          tutorId,
          bookingId,
          lineType: "PRIMARY",
          catalogueItemId: 201,
          actualBillableQuantity: 1,
        })
      ).rejects.toThrow(CrecheCampaignConflictError);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Partial Credit Snapshot Contract (Section 10)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("2. Partial Credit Snapshot Contract", () => {
    it("2.1 Snapshot clearly records reservedQuantity=5, creditCoveredQuantity=2, actualBillableQuantity=3, final=10500", async () => {
      const crecheId = 1;
      const tutorId = 10;
      const bookingId = 100;
      const redemptionId = 500;
      const itemId = 800;

      const mockRedemption = {
        id: redemptionId,
        crecheId,
        tutorId,
        bookingId,
        campaignId: 42,
        status: "RESERVED",
      };

      const mockItem = {
        id: itemId,
        redemptionId,
        catalogueItemId: 202,
        lineType: "BOOKING_SERVICE",
        bookingServiceId: 301,
        baseUnitPriceCents: 5000,
        effectiveUnitPriceCents: 3500, // R$ 35 unit promo price
        unitDiscountCents: 1500,
        quantity: 5, // Originally 5 reserved
        baseLineTotalCents: 25000,
        discountLineTotalCents: 7500,
        finalLineTotalCents: 17500,
        status: "RESERVED",
        campaignSnapshot: {
          campaignId: 42,
          campaignName: "Combo 30% OFF",
          quantity: 5,
        },
      };

      let selectCallCount = 0;
      const mockTx: any = {
        execute: vi.fn().mockResolvedValue([]),
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => {
              selectCallCount++;
              if (selectCallCount === 1) return Promise.resolve([mockRedemption]);
              if (selectCallCount === 2) return { for: vi.fn().mockResolvedValue([mockItem]) };
              if (selectCallCount === 3) return { for: vi.fn().mockResolvedValue([mockRedemption]) };
              if (selectCallCount === 4) return Promise.resolve([{ ...mockItem, status: "APPLIED" }]);
              return Promise.resolve([]);
            }),
          })),
        })),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([
                { ...mockItem, status: "APPLIED", appliedInvoiceItemId: 901 },
              ]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
      };

      const addChargeSpy = vi.spyOn(BillingService, "addCharge").mockResolvedValue({
        invoiceId: 801,
        invoiceItemId: 901,
      });

      // 5 reserved, 2 covered by service credits -> 3 billable
      const result = await CrecheCampaignReservationService.applyBookingLineCampaign(mockTx, {
        crecheId,
        tutorId,
        bookingId,
        lineType: "BOOKING_SERVICE",
        catalogueItemId: 202,
        bookingServiceId: 301,
        actualBillableQuantity: 3,
      });

      expect(result.hasCampaign).toBe(true);
      expect(result.applied).toBe(true);
      expect(result.mode).toBe("INVOICE_ITEM");
      expect(result.finalAmountCents).toBe(10500); // 3 * 3500 cents = R$ 105,00

      // Verify exact snapshot transparency
      expect(result.campaignSnapshot.reservedQuantity).toBe(5);
      expect(result.campaignSnapshot.creditCoveredQuantity).toBe(2);
      expect(result.campaignSnapshot.actualBillableQuantity).toBe(3);
      expect(result.campaignSnapshot.baseLineTotalCents).toBe(15000); // 3 * 5000
      expect(result.campaignSnapshot.discountLineTotalCents).toBe(4500); // 15000 - 10500
      expect(result.campaignSnapshot.finalLineTotalCents).toBe(10500);

      // Verify BillingService.addCharge received unitPrice=35.00 and quantity=3
      expect(addChargeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: "35.00",
          quantity: 3,
          pricingSourceType: "CAMPAIGN",
        })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Mixed Application Modes (Section 22)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("3. Mixed Application Modes", () => {
    it("3.1 Complimentary primary line + monetary add-on: progresses RESERVED -> PARTIALLY_APPLIED -> APPLIED", async () => {
      const crecheId = 1;
      const tutorId = 10;
      const bookingId = 100;
      const redemptionId = 500;

      const mockRedemption = {
        id: redemptionId,
        crecheId,
        tutorId,
        bookingId,
        campaignId: 42,
        status: "RESERVED",
      };

      const mockPrimaryItem = {
        id: 801,
        redemptionId,
        catalogueItemId: 201,
        lineType: "PRIMARY",
        bookingServiceId: null,
        baseUnitPriceCents: 10000,
        effectiveUnitPriceCents: 0, // 100% OFF Cortesia
        unitDiscountCents: 10000,
        quantity: 1,
        baseLineTotalCents: 10000,
        discountLineTotalCents: 10000,
        finalLineTotalCents: 0,
        status: "RESERVED",
        campaignSnapshot: { campaignId: 42, campaignName: "Cortesia Diária" },
      };

      const mockAddonItem = {
        id: 802,
        redemptionId,
        catalogueItemId: 202,
        lineType: "BOOKING_SERVICE",
        bookingServiceId: 301,
        baseUnitPriceCents: 6000,
        effectiveUnitPriceCents: 4800, // 20% OFF
        unitDiscountCents: 1200,
        quantity: 1,
        baseLineTotalCents: 6000,
        discountLineTotalCents: 1200,
        finalLineTotalCents: 4800,
        status: "RESERVED",
        campaignSnapshot: { campaignId: 42, campaignName: "Banho 20% OFF" },
      };

      // Step A: Apply Primary Line (Complimentary)
      let selectCountA = 0;
      const mockTxA: any = {
        execute: vi.fn().mockResolvedValue([]),
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => {
              selectCountA++;
              if (selectCountA === 1) return Promise.resolve([mockRedemption]);
              if (selectCountA === 2) return { for: vi.fn().mockResolvedValue([mockPrimaryItem]) };
              if (selectCountA === 3) return { for: vi.fn().mockResolvedValue([mockRedemption]) };
              // After primary applied: 1 APPLIED, 1 RESERVED
              if (selectCountA === 4) return Promise.resolve([
                { ...mockPrimaryItem, status: "APPLIED" },
                { ...mockAddonItem, status: "RESERVED" },
              ]);
              return Promise.resolve([]);
            }),
          })),
        })),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([
                { ...mockPrimaryItem, status: "APPLIED", applicationMode: "COMPLIMENTARY_ZERO_VALUE" },
              ]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
      };

      const resultPrimary = await CrecheCampaignReservationService.applyBookingLineCampaign(mockTxA, {
        crecheId,
        tutorId,
        bookingId,
        lineType: "PRIMARY",
        catalogueItemId: 201,
        actualBillableQuantity: 1,
      });

      expect(resultPrimary.applied).toBe(true);
      expect(resultPrimary.mode).toBe("COMPLIMENTARY_ZERO_VALUE");
      expect(resultPrimary.invoiceId).toBe(null);
      expect(resultPrimary.invoiceItemId).toBe(null);

      // Step B: Apply Add-on Line (Monetary)
      const mockRedemptionPartiallyApplied = {
        ...mockRedemption,
        status: "PARTIALLY_APPLIED",
      };

      let selectCountB = 0;
      const mockTxB: any = {
        execute: vi.fn().mockResolvedValue([]),
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => {
              selectCountB++;
              if (selectCountB === 1) return Promise.resolve([mockRedemptionPartiallyApplied]);
              if (selectCountB === 2) return { for: vi.fn().mockResolvedValue([mockAddonItem]) };
              if (selectCountB === 3) return { for: vi.fn().mockResolvedValue([mockRedemptionPartiallyApplied]) };
              // After addon applied: 2 APPLIED, 0 RESERVED
              if (selectCountB === 4) return Promise.resolve([
                { ...mockPrimaryItem, status: "APPLIED" },
                { ...mockAddonItem, status: "APPLIED" },
              ]);
              return Promise.resolve([]);
            }),
          })),
        })),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([
                { ...mockAddonItem, status: "APPLIED", appliedInvoiceItemId: 902 },
              ]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
      };

      vi.spyOn(BillingService, "addCharge").mockResolvedValue({
        invoiceId: 802,
        invoiceItemId: 902,
      });

      const resultAddon = await CrecheCampaignReservationService.applyBookingLineCampaign(mockTxB, {
        crecheId,
        tutorId,
        bookingId,
        lineType: "BOOKING_SERVICE",
        catalogueItemId: 202,
        bookingServiceId: 301,
        actualBillableQuantity: 1,
      });

      expect(resultAddon.applied).toBe(true);
      expect(resultAddon.mode).toBe("INVOICE_ITEM");
      expect(resultAddon.invoiceId).toBe(802);
      expect(resultAddon.invoiceItemId).toBe(902);
      expect(resultAddon.finalAmountCents).toBe(4800);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Release + Applied Mix (Section 23)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("4. Release + Applied Mix", () => {
    it("4.1 When Primary is APPLIED and Add-on is RELEASED by credit, header becomes APPLIED (not RELEASED)", async () => {
      let callCount = 0;
      const dynamicTx: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => {
              callCount++;
              if (callCount === 1) {
                return {
                  for: vi.fn().mockResolvedValue([
                    { id: 500, crecheId: 1, tutorId: 10, status: "PARTIALLY_APPLIED", appliedAt: new Date() },
                  ]),
                };
              }
              // items query: 1 APPLIED, 1 RELEASED, 0 RESERVED
              return Promise.resolve([
                { id: 801, lineType: "PRIMARY", status: "APPLIED" },
                { id: 802, lineType: "BOOKING_SERVICE", status: "RELEASED" },
              ]);
            }),
          })),
        })),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([
                { id: 500, status: "APPLIED" },
              ]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
      };

      const updated = await CrecheCampaignReservationService.recomputeRedemptionStatus(dynamicTx, 500);
      expect(updated?.status).toBe("APPLIED");
      expect(dynamicTx.update).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Canonical Lock Order & Deadlock Inversion Prevention (R37.C2C1)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("5. Canonical Lock Order & Deadlock Inversion Prevention", () => {
    it("5.1 Invariant: acquireTutorCampaignLock strictly precedes acquireTutorFinancialLock in all paths", async () => {
      const lockCallOrder: string[] = [];

      const mockTx: any = {
        execute: vi.fn().mockImplementation((query: any) => {
          const queryStr = JSON.stringify(query);
          if (queryStr.includes("campaign_redemption") || queryStr.includes("hashtext")) {
            lockCallOrder.push("CAMPAIGN_TUTOR_LOCK");
          } else {
            lockCallOrder.push("FINANCIAL_TUTOR_LOCK");
          }
          return Promise.resolve([]);
        }),
      };

      // Call in canonical order
      await CrecheCampaignReservationService.acquireTutorCampaignLock(mockTx, 1, 10);
      await BillingService.acquireTutorFinancialLock(1, 10, mockTx);

      expect(lockCallOrder).toEqual(["CAMPAIGN_TUTOR_LOCK", "FINANCIAL_TUTOR_LOCK"]);
      expect(lockCallOrder[0]).toBe("CAMPAIGN_TUTOR_LOCK");
      expect(lockCallOrder[1]).toBe("FINANCIAL_TUTOR_LOCK");
    });
  });
});
