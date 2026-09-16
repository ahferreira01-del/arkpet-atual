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

describe("R37.C2B — Creche Campaign Billing Application Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Financial Application (Section 45)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("1. Financial Application", () => {
    it("1.1 Primary campaign applied: creates invoice_item with promotional total, pricingSource = CAMPAIGN, and snapshot", async () => {
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
          benefitType: "PERCENTAGE_DISCOUNT",
          benefitValue: 2000,
        },
      };

      let selectCallCount = 0;
      const mockTx: any = {
        execute: vi.fn().mockResolvedValue([]),
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => {
              selectCallCount++;
              if (selectCallCount === 1) {
                // select redemptions
                return Promise.resolve([mockRedemption]);
              }
              if (selectCallCount === 2) {
                // select redemption item for update
                return {
                  for: vi.fn().mockResolvedValue([mockItem]),
                };
              }
              if (selectCallCount === 3) {
                // recomputeRedemptionStatus select redemption
                return {
                  for: vi.fn().mockResolvedValue([mockRedemption]),
                };
              }
              if (selectCallCount === 4) {
                // recomputeRedemptionStatus select items
                return Promise.resolve([{ ...mockItem, status: "APPLIED" }]);
              }
              return Promise.resolve([]);
            }),
          })),
        })),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ ...mockItem, status: "APPLIED" }]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue([]),
        }),
      };

      const addChargeSpy = vi.spyOn(BillingService, "addCharge").mockResolvedValue({
        invoiceId: 99,
        invoiceItemId: 991,
      });

      const result = await CrecheCampaignReservationService.applyBookingLineCampaign(mockTx, {
        crecheId,
        tutorId,
        bookingId,
        lineType: "PRIMARY",
        catalogueItemId: 201,
        actualBillableQuantity: 1,
      });

      expect(result.hasCampaign).toBe(true);
      expect(result.applied).toBe(true);
      expect(result.mode).toBe("INVOICE_ITEM");
      expect(result.invoiceId).toBe(99);
      expect(result.invoiceItemId).toBe(991);
      expect(result.finalAmountCents).toBe(8000);

      expect(addChargeSpy).toHaveBeenCalledTimes(1);
      expect(addChargeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          crecheId,
          tutorId,
          amount: "80.00",
          quantity: 1,
          pricingSourceType: "CAMPAIGN",
          appliedCampaignId: 42,
          appliedCampaignRedemptionId: redemptionId,
          appliedCampaignRedemptionItemId: itemId,
          appliedConditionId: null,
          conditionSnapshot: null,
        })
      );
    });

    it("1.2 Booking service campaign applied: creates invoice_item for add-on with promotional total", async () => {
      const crecheId = 1;
      const tutorId = 10;
      const bookingId = 100;
      const redemptionId = 500;
      const itemId = 801;
      const bookingServiceId = 333;

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
        catalogueItemId: 305,
        lineType: "BOOKING_SERVICE",
        bookingServiceId,
        baseUnitPriceCents: 5000,
        effectiveUnitPriceCents: 4000,
        unitDiscountCents: 1000,
        quantity: 1,
        baseLineTotalCents: 5000,
        discountLineTotalCents: 1000,
        finalLineTotalCents: 4000,
        status: "RESERVED",
        applicationMode: null,
        appliedInvoiceId: null,
        appliedInvoiceItemId: null,
        campaignSnapshot: {
          campaignId: 42,
          campaignName: "Banho Promo",
          benefitType: "FIXED_DISCOUNT",
          benefitValue: 1000,
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
              returning: vi.fn().mockResolvedValue([{ ...mockItem, status: "APPLIED" }]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue([]),
        }),
      };

      const addChargeSpy = vi.spyOn(BillingService, "addCharge").mockResolvedValue({
        invoiceId: 99,
        invoiceItemId: 992,
      });

      const result = await CrecheCampaignReservationService.applyBookingLineCampaign(mockTx, {
        crecheId,
        tutorId,
        bookingId,
        lineType: "BOOKING_SERVICE",
        catalogueItemId: 305,
        bookingServiceId,
        actualBillableQuantity: 1,
      });

      expect(result.hasCampaign).toBe(true);
      expect(result.applied).toBe(true);
      expect(result.mode).toBe("INVOICE_ITEM");
      expect(result.invoiceItemId).toBe(992);
      expect(result.finalAmountCents).toBe(4000);
      expect(addChargeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "service",
          amount: "40.00",
          pricingSourceType: "CAMPAIGN",
        })
      );
    });

    it("1.3 Non-campaign booking returns hasCampaign: false, allowing standard catalog billing", async () => {
      const mockTx: any = {
        execute: vi.fn().mockResolvedValue([]),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
      };

      const result = await CrecheCampaignReservationService.applyBookingLineCampaign(mockTx, {
        crecheId: 1,
        tutorId: 10,
        bookingId: 999,
        lineType: "PRIMARY",
        catalogueItemId: 101,
        actualBillableQuantity: 1,
      });

      expect(result.hasCampaign).toBe(false);
      expect(result.applied).toBe(false);
      expect(result.mode).toBe(null);
    });

    it("1.4 Honoring frozen promise: campaign state changes after reservation (PAUSED/REVOKED/ENDED) are ignored during billing", async () => {
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
        catalogueItemId: 201,
        lineType: "PRIMARY",
        bookingServiceId: null,
        baseUnitPriceCents: 10000,
        effectiveUnitPriceCents: 7500,
        unitDiscountCents: 2500,
        quantity: 1,
        baseLineTotalCents: 10000,
        discountLineTotalCents: 2500,
        finalLineTotalCents: 7500,
        status: "RESERVED",
        campaignSnapshot: {
          campaignId: 42,
          campaignName: "Promo Revogada Depois",
          benefitType: "FIXED_PROMOTIONAL_PRICE",
          benefitValue: 7500,
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
              returning: vi.fn().mockResolvedValue([{ ...mockItem, status: "APPLIED" }]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue([]),
        }),
      };

      const addChargeSpy = vi.spyOn(BillingService, "addCharge").mockResolvedValue({
        invoiceId: 99,
        invoiceItemId: 993,
      });

      const result = await CrecheCampaignReservationService.applyBookingLineCampaign(mockTx, {
        crecheId,
        tutorId,
        bookingId,
        lineType: "PRIMARY",
        catalogueItemId: 201,
        actualBillableQuantity: 1,
      });

      expect(result.applied).toBe(true);
      expect(result.finalAmountCents).toBe(7500);
      expect(addChargeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: "75.00",
        })
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Line Lifecycle & Header Recomputation (Sections 46, 47)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("2. Line Lifecycle & Header Recomputation", () => {
    it("2.1 Header status: RESERVED when 0 APPLIED and at least 1 RESERVED", async () => {
      let selectCount = 0;
      const mockTx: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => {
              selectCount++;
              if (selectCount === 1) {
                return { for: vi.fn().mockResolvedValue([{ id: 1, status: "PARTIALLY_APPLIED" }]) };
              }
              return Promise.resolve([
                { id: 10, status: "RESERVED" },
                { id: 11, status: "RELEASED" },
              ]);
            }),
          })),
        })),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 1, status: "RESERVED" }]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue([]),
        }),
      };

      const header = await CrecheCampaignReservationService.recomputeRedemptionStatus(mockTx, 1);
      expect(header?.status).toBe("RESERVED");
    });

    it("2.2 Header status: PARTIALLY_APPLIED when at least 1 APPLIED and at least 1 RESERVED", async () => {
      let selectCount = 0;
      const mockTx: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => {
              selectCount++;
              if (selectCount === 1) {
                return { for: vi.fn().mockResolvedValue([{ id: 1, status: "RESERVED" }]) };
              }
              return Promise.resolve([
                { id: 10, status: "APPLIED" },
                { id: 11, status: "RESERVED" },
              ]);
            }),
          })),
        })),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 1, status: "PARTIALLY_APPLIED" }]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue([]),
        }),
      };

      const header = await CrecheCampaignReservationService.recomputeRedemptionStatus(mockTx, 1);
      expect(header?.status).toBe("PARTIALLY_APPLIED");
    });

    it("2.3 Header status: APPLIED when 0 RESERVED and at least 1 APPLIED", async () => {
      let selectCount = 0;
      const mockTx: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => {
              selectCount++;
              if (selectCount === 1) {
                return { for: vi.fn().mockResolvedValue([{ id: 1, status: "PARTIALLY_APPLIED" }]) };
              }
              return Promise.resolve([
                { id: 10, status: "APPLIED" },
                { id: 11, status: "APPLIED" },
              ]);
            }),
          })),
        })),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 1, status: "APPLIED" }]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue([]),
        }),
      };

      const header = await CrecheCampaignReservationService.recomputeRedemptionStatus(mockTx, 1);
      expect(header?.status).toBe("APPLIED");
    });

    it("2.4 Header status: APPLIED when mix of APPLIED and RELEASED lines (0 RESERVED)", async () => {
      let selectCount = 0;
      const mockTx: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => {
              selectCount++;
              if (selectCount === 1) {
                return { for: vi.fn().mockResolvedValue([{ id: 1, status: "PARTIALLY_APPLIED" }]) };
              }
              return Promise.resolve([
                { id: 10, status: "APPLIED" },
                { id: 11, status: "RELEASED" },
              ]);
            }),
          })),
        })),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 1, status: "APPLIED" }]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue([]),
        }),
      };

      const header = await CrecheCampaignReservationService.recomputeRedemptionStatus(mockTx, 1);
      expect(header?.status).toBe("APPLIED");
    });

    it("2.5 Header status: RELEASED when all lines RELEASED and 0 APPLIED", async () => {
      let selectCount = 0;
      const mockTx: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => {
              selectCount++;
              if (selectCount === 1) {
                return { for: vi.fn().mockResolvedValue([{ id: 1, status: "RESERVED" }]) };
              }
              return Promise.resolve([
                { id: 10, status: "RELEASED" },
                { id: 11, status: "RELEASED" },
              ]);
            }),
          })),
        })),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 1, status: "RELEASED" }]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue([]),
        }),
      };

      const header = await CrecheCampaignReservationService.recomputeRedemptionStatus(mockTx, 1);
      expect(header?.status).toBe("RELEASED");
    });

    it("2.6 Idempotency: Retrying monetary line application performs logical replay without creating duplicate invoice items", async () => {
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
        status: "APPLIED",
      };

      const mockAlreadyAppliedItem = {
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
        status: "APPLIED",
        applicationMode: "INVOICE_ITEM",
        appliedInvoiceId: 77,
        appliedInvoiceItemId: 771,
        campaignSnapshot: {
          campaignId: 42,
          campaignName: "Verão 20% OFF",
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
              if (selectCallCount === 2) return { for: vi.fn().mockResolvedValue([mockAlreadyAppliedItem]) };
              return Promise.resolve([]);
            }),
          })),
        })),
        update: vi.fn(),
        insert: vi.fn(),
      };

      const addChargeSpy = vi.spyOn(BillingService, "addCharge");

      const result = await CrecheCampaignReservationService.applyBookingLineCampaign(mockTx, {
        crecheId,
        tutorId,
        bookingId,
        lineType: "PRIMARY",
        catalogueItemId: 201,
        actualBillableQuantity: 1,
      });

      expect(result.hasCampaign).toBe(true);
      expect(result.applied).toBe(true);
      expect(result.replayed).toBe(true);
      expect(result.mode).toBe("INVOICE_ITEM");
      expect(result.invoiceId).toBe(77);
      expect(result.invoiceItemId).toBe(771);
      expect(result.finalAmountCents).toBe(8000);

      expect(addChargeSpy).not.toHaveBeenCalled();
      expect(mockTx.update).not.toHaveBeenCalled();
      expect(mockTx.insert).not.toHaveBeenCalled();
    });

    it("2.7 Idempotency: Retrying zero-value complimentary line performs logical replay without creating duplicate audits or invoices", async () => {
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
        status: "APPLIED",
      };

      const mockAlreadyComplimentaryItem = {
        id: itemId,
        redemptionId,
        catalogueItemId: 201,
        lineType: "PRIMARY",
        bookingServiceId: null,
        baseUnitPriceCents: 10000,
        effectiveUnitPriceCents: 0,
        unitDiscountCents: 10000,
        quantity: 1,
        baseLineTotalCents: 10000,
        discountLineTotalCents: 10000,
        finalLineTotalCents: 0,
        status: "APPLIED",
        applicationMode: "COMPLIMENTARY_ZERO_VALUE",
        appliedInvoiceId: null,
        appliedInvoiceItemId: null,
        campaignSnapshot: {
          campaignId: 42,
          campaignName: "100% OFF Cortesia",
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
              if (selectCallCount === 2) return { for: vi.fn().mockResolvedValue([mockAlreadyComplimentaryItem]) };
              return Promise.resolve([]);
            }),
          })),
        })),
        update: vi.fn(),
        insert: vi.fn(),
      };

      const addChargeSpy = vi.spyOn(BillingService, "addCharge");

      const result = await CrecheCampaignReservationService.applyBookingLineCampaign(mockTx, {
        crecheId,
        tutorId,
        bookingId,
        lineType: "PRIMARY",
        catalogueItemId: 201,
        actualBillableQuantity: 1,
      });

      expect(result.hasCampaign).toBe(true);
      expect(result.applied).toBe(true);
      expect(result.replayed).toBe(true);
      expect(result.mode).toBe("COMPLIMENTARY_ZERO_VALUE");
      expect(result.invoiceId).toBe(null);
      expect(result.invoiceItemId).toBe(null);
      expect(result.finalAmountCents).toBe(0);

      expect(addChargeSpy).not.toHaveBeenCalled();
      expect(mockTx.update).not.toHaveBeenCalled();
      expect(mockTx.insert).not.toHaveBeenCalled();
    });

    it("2.8 Terminal State: RELEASED line cannot be APPLIED", async () => {
      const mockRedemption = {
        id: 500,
        crecheId: 1,
        tutorId: 10,
        bookingId: 100,
        campaignId: 42,
        status: "RELEASED",
      };

      const mockReleasedItem = {
        id: 800,
        redemptionId: 500,
        catalogueItemId: 201,
        lineType: "PRIMARY",
        status: "RELEASED",
        releaseReason: "covered_by_prepaid_credit",
      };

      let selectCallCount = 0;
      const mockTx: any = {
        execute: vi.fn().mockResolvedValue([]),
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => {
              selectCallCount++;
              if (selectCallCount === 1) return Promise.resolve([mockRedemption]);
              if (selectCallCount === 2) return { for: vi.fn().mockResolvedValue([mockReleasedItem]) };
              return Promise.resolve([]);
            }),
          })),
        })),
      };

      const result = await CrecheCampaignReservationService.applyBookingLineCampaign(mockTx, {
        crecheId: 1,
        tutorId: 10,
        bookingId: 100,
        lineType: "PRIMARY",
        catalogueItemId: 201,
        actualBillableQuantity: 1,
      });

      expect(result.hasCampaign).toBe(true);
      expect(result.applied).toBe(false);
      expect(result.released).toBe(true);
      expect(result.releaseReason).toBe("covered_by_prepaid_credit");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Pre-paid Credits Precedence & Partial Credits (Section 48)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("3. Pre-paid Credits Precedence & Partial Credits", () => {
    it("3.1 100% Package/Day credit coverage: releases primary campaign reservation, 0 invoice_item created", async () => {
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
        catalogueItemId: 201,
        lineType: "PRIMARY",
        baseUnitPriceCents: 10000,
        effectiveUnitPriceCents: 8000,
        unitDiscountCents: 2000,
        status: "RESERVED",
        campaignSnapshot: { campaignId: 42 },
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
              if (selectCallCount === 4) return Promise.resolve([{ ...mockItem, status: "RELEASED" }]);
              return Promise.resolve([]);
            }),
          })),
        })),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ ...mockItem, status: "RELEASED" }]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue([]),
        }),
      };

      const addChargeSpy = vi.spyOn(BillingService, "addCharge");

      // actualBillableQuantity = 0 indicates that credits covered 100% of the days
      const result = await CrecheCampaignReservationService.applyBookingLineCampaign(mockTx, {
        crecheId,
        tutorId,
        bookingId,
        lineType: "PRIMARY",
        catalogueItemId: 201,
        actualBillableQuantity: 0,
      });

      expect(result.hasCampaign).toBe(true);
      expect(result.applied).toBe(false);
      expect(result.released).toBe(true);
      expect(result.releaseReason).toBe("covered_by_prepaid_credit");
      expect(addChargeSpy).not.toHaveBeenCalled();
    });

    it("3.2 Partial Credit: 5 reserved, 2 covered by credit, 3 billable -> charges 3 × promotional unit price", async () => {
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
        catalogueItemId: 201,
        lineType: "PRIMARY",
        baseUnitPriceCents: 5000,
        effectiveUnitPriceCents: 4000, // R$ 40 unit promo price
        unitDiscountCents: 1000,
        quantity: 5,
        baseLineTotalCents: 25000,
        discountLineTotalCents: 5000,
        finalLineTotalCents: 20000,
        status: "RESERVED",
        campaignSnapshot: { campaignId: 42, campaignName: "Promo Diárias" },
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
              returning: vi.fn().mockResolvedValue([{ ...mockItem, status: "APPLIED" }]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue([]),
        }),
      };

      const addChargeSpy = vi.spyOn(BillingService, "addCharge").mockResolvedValue({
        invoiceId: 99,
        invoiceItemId: 994,
      });

      // 3 billable days
      const result = await CrecheCampaignReservationService.applyBookingLineCampaign(mockTx, {
        crecheId,
        tutorId,
        bookingId,
        lineType: "PRIMARY",
        catalogueItemId: 201,
        actualBillableQuantity: 3,
      });

      expect(result.applied).toBe(true);
      expect(result.mode).toBe("INVOICE_ITEM");
      expect(result.finalAmountCents).toBe(12000); // 3 * 4000 = 12000 cents (R$ 120,00)

      expect(addChargeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: "40.00",
          quantity: 3,
          pricingSourceType: "CAMPAIGN",
        })
      );
    });

    it("3.3 Partial Credit + 100% OFF promo: 5 units, 2 by credit, 3 billable -> applies 3 complimentary, 0 invoice_item", async () => {
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
        catalogueItemId: 201,
        lineType: "PRIMARY",
        baseUnitPriceCents: 8000,
        effectiveUnitPriceCents: 0, // 100% OFF
        unitDiscountCents: 8000,
        quantity: 5,
        baseLineTotalCents: 40000,
        discountLineTotalCents: 40000,
        finalLineTotalCents: 0,
        status: "RESERVED",
        campaignSnapshot: { campaignId: 42, campaignName: "100% OFF" },
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
              returning: vi.fn().mockResolvedValue([{ ...mockItem, status: "APPLIED" }]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue([]),
        }),
      };

      const addChargeSpy = vi.spyOn(BillingService, "addCharge");

      // 3 remaining units to apply complimentary promo to
      const result = await CrecheCampaignReservationService.applyBookingLineCampaign(mockTx, {
        crecheId,
        tutorId,
        bookingId,
        lineType: "PRIMARY",
        catalogueItemId: 201,
        actualBillableQuantity: 3,
      });

      expect(result.applied).toBe(true);
      expect(result.mode).toBe("COMPLIMENTARY_ZERO_VALUE");
      expect(result.invoiceId).toBe(null);
      expect(result.invoiceItemId).toBe(null);
      expect(result.finalAmountCents).toBe(0);
      expect(addChargeSpy).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Zero-Price Contract (Option 2 — Complimentary Application) (Section 49)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("4. Zero-Price Contract (Option 2 — Complimentary Application)", () => {
    it("4.1 100% Percentage Discount: applies as COMPLIMENTARY_ZERO_VALUE, consumes capacity, 0 invoice_item", async () => {
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
        catalogueItemId: 201,
        lineType: "PRIMARY",
        bookingServiceId: null,
        baseUnitPriceCents: 10000,
        effectiveUnitPriceCents: 0,
        unitDiscountCents: 10000,
        quantity: 1,
        baseLineTotalCents: 10000,
        discountLineTotalCents: 10000,
        finalLineTotalCents: 0,
        status: "RESERVED",
        campaignSnapshot: {
          campaignId: 42,
          campaignName: "100% OFF Integral",
          benefitType: "PERCENTAGE_DISCOUNT",
          benefitValue: 10000,
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
              returning: vi.fn().mockResolvedValue([{ ...mockItem, status: "APPLIED" }]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue([]),
        }),
      };

      const addChargeSpy = vi.spyOn(BillingService, "addCharge");

      const result = await CrecheCampaignReservationService.applyBookingLineCampaign(mockTx, {
        crecheId,
        tutorId,
        bookingId,
        lineType: "PRIMARY",
        catalogueItemId: 201,
        actualBillableQuantity: 1,
      });

      expect(result.applied).toBe(true);
      expect(result.mode).toBe("COMPLIMENTARY_ZERO_VALUE");
      expect(result.invoiceId).toBe(null);
      expect(result.invoiceItemId).toBe(null);
      expect(result.finalAmountCents).toBe(0);

      // Contract 2: PROIBIDO CRIAR FATURA FICTÍCIA
      expect(addChargeSpy).not.toHaveBeenCalled();

      // Check audit emission with complimentary mode
      expect(mockTx.insert).toHaveBeenCalled();
    });

    it("4.2 Fixed promotional price R$ 0,00 applies as COMPLIMENTARY_ZERO_VALUE", async () => {
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
        catalogueItemId: 201,
        lineType: "PRIMARY",
        baseUnitPriceCents: 9000,
        effectiveUnitPriceCents: 0, // R$ 0 fixed price
        unitDiscountCents: 9000,
        quantity: 1,
        baseLineTotalCents: 9000,
        discountLineTotalCents: 9000,
        finalLineTotalCents: 0,
        status: "RESERVED",
        campaignSnapshot: {
          campaignId: 42,
          campaignName: "Primeira Diária Grátis",
          benefitType: "FIXED_PROMOTIONAL_PRICE",
          benefitValue: 0,
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
              returning: vi.fn().mockResolvedValue([{ ...mockItem, status: "APPLIED" }]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue([]),
        }),
      };

      const result = await CrecheCampaignReservationService.applyBookingLineCampaign(mockTx, {
        crecheId,
        tutorId,
        bookingId,
        lineType: "PRIMARY",
        catalogueItemId: 201,
        actualBillableQuantity: 1,
      });

      expect(result.applied).toBe(true);
      expect(result.mode).toBe("COMPLIMENTARY_ZERO_VALUE");
      expect(result.finalAmountCents).toBe(0);
    });

    it("4.3 BillingService retains strict amount > 0 check and rejects R$ 0 charges", async () => {
      vi.restoreAllMocks();
      await expect(
        BillingService.addCharge({
          crecheId: 1,
          tutorId: 10,
          amount: 0,
          description: "Teste zero",
        })
      ).rejects.toThrow("Valor inválido (0)");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Concurrency, Atomicity & Fail-Closed (Section 50)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("5. Concurrency, Atomicity & Fail-Closed", () => {
    it("5.1 Global Lock Order: acquireTutorCampaignLock is called BEFORE addCharge/financial lock", async () => {
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
        catalogueItemId: 201,
        lineType: "PRIMARY",
        baseUnitPriceCents: 10000,
        effectiveUnitPriceCents: 8000,
        unitDiscountCents: 2000,
        quantity: 1,
        baseLineTotalCents: 10000,
        discountLineTotalCents: 2000,
        finalLineTotalCents: 8000,
        status: "RESERVED",
        campaignSnapshot: { campaignId: 42 },
      };

      const callOrder: string[] = [];
      let selectCount = 0;

      const mockTx: any = {
        execute: vi.fn().mockImplementation(() => {
          callOrder.push("CAMPAIGN_LOCK");
          return Promise.resolve([]);
        }),
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => {
              selectCount++;
              if (selectCount === 1) {
                callOrder.push("SELECT_REDEMPTIONS");
                return Promise.resolve([mockRedemption]);
              }
              if (selectCount === 2) {
                callOrder.push("SELECT_ITEM_FOR_UPDATE");
                return { for: vi.fn().mockResolvedValue([mockItem]) };
              }
              if (selectCount === 3) {
                return { for: vi.fn().mockResolvedValue([mockRedemption]) };
              }
              if (selectCount === 4) {
                return Promise.resolve([{ ...mockItem, status: "APPLIED" }]);
              }
              return Promise.resolve([]);
            }),
          })),
        })),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ ...mockItem, status: "APPLIED" }]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue([]),
        }),
      };

      vi.spyOn(BillingService, "addCharge").mockImplementation(async () => {
        callOrder.push("BILLING_ADD_CHARGE");
        return { invoiceId: 1, invoiceItemId: 10 };
      });

      await CrecheCampaignReservationService.applyBookingLineCampaign(mockTx, {
        crecheId,
        tutorId,
        bookingId,
        lineType: "PRIMARY",
        catalogueItemId: 201,
        actualBillableQuantity: 1,
      });

      expect(callOrder[0]).toBe("CAMPAIGN_LOCK");
      expect(callOrder).toContain("BILLING_ADD_CHARGE");
      expect(callOrder.indexOf("CAMPAIGN_LOCK")).toBeLessThan(
        callOrder.indexOf("BILLING_ADD_CHARGE")
      );
    });

    it("5.2 Broken reserved promise (missing or corrupted snapshot) FAILS CLOSED with CrecheCampaignConflictError", async () => {
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

      const mockCorruptedItem = {
        id: itemId,
        redemptionId,
        catalogueItemId: 201,
        lineType: "PRIMARY",
        baseUnitPriceCents: 10000,
        effectiveUnitPriceCents: 12000, // INVALID: effective > base price!
        unitDiscountCents: -2000,
        status: "RESERVED",
        campaignSnapshot: null, // CORRUPTED
      };

      let selectCallCount = 0;
      const mockTx: any = {
        execute: vi.fn().mockResolvedValue([]),
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => {
              selectCallCount++;
              if (selectCallCount === 1) return Promise.resolve([mockRedemption]);
              return { for: vi.fn().mockResolvedValue([mockCorruptedItem]) };
            }),
          })),
        })),
      };

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
  // 6. Security & Tenant Boundaries (Section 52)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("6. Security & Tenant Boundaries", () => {
    it("6.1 Cross-tenant redemption application is rejected with CrecheCampaignValidationError", async () => {
      const mockRedemption = {
        id: 500,
        crecheId: 999, // DIFFERENT CRECHE!
        tutorId: 10,
        bookingId: 100,
        campaignId: 42,
        status: "RESERVED",
      };

      const mockItem = {
        id: 800,
        redemptionId: 500,
        catalogueItemId: 201,
        lineType: "PRIMARY",
        status: "RESERVED",
      };

      let selectCallCount = 0;
      const mockTx: any = {
        execute: vi.fn().mockResolvedValue([]),
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => {
              selectCallCount++;
              if (selectCallCount === 1) return Promise.resolve([mockRedemption]);
              return { for: vi.fn().mockResolvedValue([mockItem]) };
            }),
          })),
        })),
      };

      await expect(
        CrecheCampaignReservationService.applyBookingLineCampaign(mockTx, {
          crecheId: 1, // Caller creche is 1
          tutorId: 10,
          bookingId: 100,
          lineType: "PRIMARY",
          catalogueItemId: 201,
          actualBillableQuantity: 1,
        })
      ).rejects.toThrow(CrecheCampaignValidationError);
    });

    it("6.2 Redemption item catalogue item mismatch is rejected with CrecheCampaignValidationError", async () => {
      const mockRedemption = {
        id: 500,
        crecheId: 1,
        tutorId: 10,
        bookingId: 100,
        campaignId: 42,
        status: "RESERVED",
      };

      const mockItem = {
        id: 800,
        redemptionId: 500,
        catalogueItemId: 201, // Reserved for item 201
        lineType: "PRIMARY",
        status: "RESERVED",
      };

      let selectCallCount = 0;
      const mockTx: any = {
        execute: vi.fn().mockResolvedValue([]),
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation(() => ({
            where: vi.fn().mockImplementation(() => {
              selectCallCount++;
              if (selectCallCount === 1) return Promise.resolve([mockRedemption]);
              return { for: vi.fn().mockResolvedValue([mockItem]) };
            }),
          })),
        })),
      };

      await expect(
        CrecheCampaignReservationService.applyBookingLineCampaign(mockTx, {
          crecheId: 1,
          tutorId: 10,
          bookingId: 100,
          lineType: "PRIMARY",
          catalogueItemId: 999, // Mismatched catalogue item!
          actualBillableQuantity: 1,
        })
      ).rejects.toThrow(CrecheCampaignValidationError);
    });
  });
});
