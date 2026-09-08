import { describe, it, expect, vi } from "vitest";
import {
  calculateCadenceDuration,
  resolveOrCreateCampaignStripePrice,
  executeStripeCampaignSchedule,
  releaseCampaignSchedule,
  ExistingStripeScheduleUnsupportedError,
  StripeCampaignScheduleError,
} from "../services/stripeCampaignSchedule.js";
import { subscriptionsTable, plansTable } from "@workspace/db/schema";
import type Stripe from "stripe";

describe("stripeCampaignSchedule service", () => {
  describe("calculateCadenceDuration", () => {
    it("should calculate exact durations for month interval", () => {
      expect(calculateCadenceDuration("month", 1)).toEqual({
        interval: "month",
        intervalCount: 1,
        totalDurationMonths: 1,
      });
      expect(calculateCadenceDuration("month", 3)).toEqual({
        interval: "month",
        intervalCount: 3,
        totalDurationMonths: 3,
      });
      expect(calculateCadenceDuration("month", 6)).toEqual({
        interval: "month",
        intervalCount: 6,
        totalDurationMonths: 6,
      });
    });

    it("should calculate exact durations for quarter interval (3 months per cycle)", () => {
      expect(calculateCadenceDuration("quarter", 1)).toEqual({
        interval: "month",
        intervalCount: 3,
        totalDurationMonths: 3,
      });
      expect(calculateCadenceDuration("quarter", 2)).toEqual({
        interval: "month",
        intervalCount: 6,
        totalDurationMonths: 6,
      });
    });

    it("should calculate exact durations for semester interval (6 months per cycle)", () => {
      expect(calculateCadenceDuration("semester", 1)).toEqual({
        interval: "month",
        intervalCount: 6,
        totalDurationMonths: 6,
      });
      expect(calculateCadenceDuration("semester", 2)).toEqual({
        interval: "month",
        intervalCount: 12,
        totalDurationMonths: 12,
      });
    });

    it("should calculate exact durations for year interval", () => {
      expect(calculateCadenceDuration("year", 1)).toEqual({
        interval: "year",
        intervalCount: 1,
        totalDurationMonths: 12,
      });
      expect(calculateCadenceDuration("year", 2)).toEqual({
        interval: "year",
        intervalCount: 2,
        totalDurationMonths: 24,
      });
    });
  });

  describe("executeStripeCampaignSchedule", () => {
    it("should fail closed with ExistingStripeScheduleUnsupportedError if subscription has unknown schedule", async () => {
      const mockStripe: any = {
        subscriptions: {
          retrieve: vi.fn().mockResolvedValue({
            id: "sub_123",
            schedule: "sub_sched_unknown_external_456",
          }),
        },
        subscriptionSchedules: {
          retrieve: vi.fn().mockResolvedValue({
            id: "sub_sched_unknown_external_456",
            metadata: {},
          }),
        },
      };

      const mockDb: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(async () => {
                if (table === subscriptionsTable) return [{ id: 1, planId: 10 }];
                if (table === plansTable) return [{ id: 10, stripeProductId: "prod_1" }];
                return [];
              }),
            })),
          })),
        })),
      };

      await expect(
        executeStripeCampaignSchedule({
          assignedBenefitId: 1,
          campaignId: 10,
          crecheId: 100,
          stripeSubscriptionId: "sub_123",
          billingInterval: "month",
          billingCycles: 3,
          promotionalPriceCents: 15000,
          restorationPriceCents: 20000,
          stripeClient: mockStripe,
          dbClient: mockDb,
        }),
      ).rejects.toThrow(ExistingStripeScheduleUnsupportedError);
    });

    it("should execute two-step schedule pattern and update phases preserving Phase 0", async () => {
      const currentPeriodEnd = Math.floor(Date.now() / 1000) + 86400 * 15;
      const mockSub: any = {
        id: "sub_123",
        status: "active",
        schedule: null,
        current_period_end: currentPeriodEnd,
        items: {
          data: [
            {
              id: "si_item_1",
              price: {
                id: "price_original_monthly",
                product: "prod_arkpet_daycare",
              },
            },
          ],
        },
      };

      const mockScheduleCreated: any = {
        id: "sub_sched_test_789",
        phases: [
          {
            start_date: currentPeriodEnd - 86400 * 15,
            end_date: currentPeriodEnd,
            items: [{ price: "price_original_monthly", quantity: 1 }],
          },
        ],
      };

      const mockPricesList = { data: [] };
      const mockCreatedPromoPrice = { id: "price_promo_test_150" };
      const mockCreatedRestorePrice = { id: "price_restore_test_200" };

      const updateScheduleSpy = vi.fn().mockResolvedValue({
        id: "sub_sched_test_789",
        status: "active",
      });

      const mockStripe: any = {
        subscriptions: {
          retrieve: vi.fn().mockResolvedValue(mockSub),
        },
        prices: {
          list: vi.fn().mockResolvedValue(mockPricesList),
          create: vi.fn().mockImplementation((params) => {
            if (params.unit_amount === 15000) return Promise.resolve(mockCreatedPromoPrice);
            return Promise.resolve(mockCreatedRestorePrice);
          }),
        },
        subscriptionSchedules: {
          create: vi.fn().mockResolvedValue(mockScheduleCreated),
          update: updateScheduleSpy,
        },
      };

      const mockDb: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(async () => {
                if (table === subscriptionsTable) return [{ id: 1, planId: 10 }];
                if (table === plansTable) return [{ id: 10, stripeProductId: "prod_arkpet_daycare" }];
                return [];
              }),
            })),
          })),
        })),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      };

      const res = await executeStripeCampaignSchedule({
        assignedBenefitId: 1,
        campaignId: 10,
        crecheId: 100,
        stripeSubscriptionId: "sub_123",
        billingInterval: "month",
        billingCycles: 3,
        promotionalPriceCents: 15000,
        restorationPriceCents: 20000,
        stripeClient: mockStripe,
        dbClient: mockDb,
      });

      expect(res.stripeScheduleId).toBe("sub_sched_test_789");
      expect(res.promotionalStripePriceId).toBe("price_promo_test_150");
      expect(res.restorationStripePriceId).toBe("price_restore_test_200");

      // Verify create called with from_subscription and metadata
      expect(mockStripe.subscriptionSchedules.create).toHaveBeenCalledWith(
        expect.objectContaining({
          from_subscription: "sub_123",
          metadata: expect.objectContaining({
            scope: "arkpet_commercial_campaign",
            assignedBenefitId: "1",
          }),
        }),
        expect.anything(),
      );

      // Verify db checkpoint update occurred before phase update
      expect(mockDb.update).toHaveBeenCalled();

      // Verify update called with preserved phase 0, promotional phase 1, and restoration phase 2
      expect(updateScheduleSpy).toHaveBeenCalledWith(
        "sub_sched_test_789",
        expect.objectContaining({
          phases: expect.arrayContaining([
            expect.objectContaining({
              start_date: mockScheduleCreated.phases[0].start_date,
              end_date: mockScheduleCreated.phases[0].end_date,
            }),
            expect.objectContaining({
              items: [{ price: "price_promo_test_150", quantity: 1 }],
              proration_behavior: "none",
              duration: { interval: "month", interval_count: 3 },
            }),
            expect.objectContaining({
              items: [{ price: "price_restore_test_200", quantity: 1 }],
              proration_behavior: "none",
            }),
          ]),
        }),
        expect.anything(),
      );
    });

    it("should survive crash during phase update (R36.F1 Section 11, 12): retains pending_activation, then retry reuses schedule", async () => {
      const currentPeriodEnd = Math.floor(Date.now() / 1000) + 86400 * 15;
      const mockSub: any = {
        id: "sub_123",
        status: "active",
        schedule: null,
        current_period_end: currentPeriodEnd,
        items: {
          data: [{ id: "si_1", price: { id: "price_orig", product: "prod_1" } }],
        },
      };

      const mockScheduleCreated: any = {
        id: "sub_sched_crash_111",
        metadata: {
          scope: "arkpet_commercial_campaign",
          assignedBenefitId: "2",
        },
        phases: [
          {
            start_date: currentPeriodEnd - 86400 * 15,
            end_date: currentPeriodEnd,
            items: [{ price: "price_orig", quantity: 1 }],
          },
        ],
      };

      let dbUpdates: any[] = [];
      const mockDb: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(async () => {
                if (table === subscriptionsTable) return [{ id: 2, planId: 10 }];
                if (table === plansTable) return [{ id: 10, stripeProductId: "prod_1" }];
                return [];
              }),
            })),
          })),
        })),
        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockImplementation((fields) => {
            dbUpdates.push(fields);
            return {
              where: vi.fn().mockResolvedValue([{ id: 2 }]),
            };
          }),
        })),
      };

      // 1st Attempt: update throws an error (crash)
      const mockStripeCrash: any = {
        subscriptions: {
          retrieve: vi.fn().mockResolvedValue(mockSub),
        },
        prices: {
          list: vi.fn().mockResolvedValue({ data: [] }),
          create: vi.fn().mockImplementation((p) => Promise.resolve({ id: `price_${p.unit_amount}` })),
        },
        subscriptionSchedules: {
          create: vi.fn().mockResolvedValue(mockScheduleCreated),
          retrieve: vi.fn().mockResolvedValue(mockScheduleCreated),
          update: vi.fn().mockRejectedValue(new Error("Stripe API Phase Update Timeout")),
        },
      };

      await expect(
        executeStripeCampaignSchedule({
          assignedBenefitId: 2,
          campaignId: 10,
          crecheId: 100,
          stripeSubscriptionId: "sub_123",
          billingInterval: "month",
          billingCycles: 3,
          promotionalPriceCents: 15000,
          restorationPriceCents: 20000,
          stripeClient: mockStripeCrash,
          dbClient: mockDb,
        }),
      ).rejects.toThrow("Stripe API Phase Update Timeout");

      // Verify that after crash, stripeScheduleId was checkpointed but status was NOT set to 'scheduled'
      expect(dbUpdates.length).toBe(1);
      expect(dbUpdates[0].stripeScheduleId).toBe("sub_sched_crash_111");
      expect(dbUpdates[0].status).toBeUndefined(); // Remains pending_activation!

      // 2nd Attempt (Retry): retry with existingStripeScheduleId
      dbUpdates = [];
      const mockStripeRetry: any = {
        subscriptions: {
          retrieve: vi.fn().mockResolvedValue({
            ...mockSub,
            schedule: "sub_sched_crash_111",
          }),
        },
        prices: {
          create: vi.fn().mockImplementation((p) => Promise.resolve({ id: `price_${p.unit_amount}` })),
          list: vi.fn().mockResolvedValue({
            data: [
              { id: "price_15000", unit_amount: 15000 },
              { id: "price_20000", unit_amount: 20000 },
            ],
          }),
        },
        subscriptionSchedules: {
          create: vi.fn(), // MUST NOT BE CALLED ON RETRY
          retrieve: vi.fn().mockResolvedValue(mockScheduleCreated),
          update: vi.fn().mockResolvedValue({ id: "sub_sched_crash_111", status: "active" }),
        },
      };

      const retryRes = await executeStripeCampaignSchedule({
        assignedBenefitId: 2,
        campaignId: 10,
        crecheId: 100,
        stripeSubscriptionId: "sub_123",
        billingInterval: "month",
        billingCycles: 3,
        promotionalPriceCents: 15000,
        restorationPriceCents: 20000,
        existingStripeScheduleId: "sub_sched_crash_111",
        stripeClient: mockStripeRetry,
        dbClient: mockDb,
      });

      expect(retryRes.stripeScheduleId).toBe("sub_sched_crash_111");
      expect(mockStripeRetry.subscriptionSchedules.create).not.toHaveBeenCalled();
      expect(mockStripeRetry.subscriptionSchedules.update).toHaveBeenCalled();
      // Final update set status to scheduled
      expect(dbUpdates.some((u) => u.status === "scheduled")).toBe(true);
    });
  });

  describe("releaseCampaignSchedule", () => {
    it("should release schedule successfully", async () => {
      const mockStripe: any = {
        subscriptionSchedules: {
          retrieve: vi.fn().mockResolvedValue({ id: "sched_123", status: "active" }),
          release: vi.fn().mockResolvedValue({ id: "sched_123", status: "released" }),
        },
      };

      await expect(releaseCampaignSchedule("sched_123", mockStripe)).resolves.not.toThrow();
      expect(mockStripe.subscriptionSchedules.release).toHaveBeenCalledWith("sched_123");
    });

    it("should ignore already released schedules", async () => {
      const mockStripe: any = {
        subscriptionSchedules: {
          retrieve: vi.fn().mockResolvedValue({ id: "sched_123", status: "released" }),
          release: vi.fn().mockResolvedValue({ id: "sched_123", status: "released" }),
        },
      };

      await expect(releaseCampaignSchedule("sched_123", mockStripe)).resolves.not.toThrow();
    });
  });
});
