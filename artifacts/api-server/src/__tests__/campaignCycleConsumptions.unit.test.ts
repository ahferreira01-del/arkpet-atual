import { describe, it, expect, vi } from "vitest";
import {
  reconcileBenefitCycleAdvancement,
  reconcileCampaignRestoration,
} from "../services/commercialCampaigns.js";
import {
  assignedCommercialBenefitsTable,
  benefitCycleConsumptionsTable,
  customerCommercialConditionsTable,
} from "@workspace/db/schema";
import type Stripe from "stripe";

describe("campaignCycleConsumptions & restoration reconciliation", () => {
  const crecheId = 200;
  const stripeSubscriptionId = "sub_cadence_xyz";
  const pStart = new Date("2026-10-01T00:00:00.000Z");
  const pEnd = new Date("2026-11-01T00:00:00.000Z");

  const mockStripe: any = {
    subscriptions: {
      retrieve: vi.fn(),
    },
    subscriptionSchedules: {
      retrieve: vi.fn().mockResolvedValue({ id: "sched_arkpet_123", status: "active" }),
      release: vi.fn().mockResolvedValue({ id: "sched_arkpet_123", status: "released" }),
    },
  };

  describe("reconcileBenefitCycleAdvancement", () => {
    it("should return false if creche has no scheduled or active assigned benefit", async () => {
      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      };

      const res = await reconcileBenefitCycleAdvancement({
        crecheId,
        stripeSubscriptionId,
        contractualPeriodStart: pStart,
        contractualPeriodEnd: pEnd,
        dbClient: mockDb,
        stripeClient: mockStripe,
      });

      expect(res.cycleConsumed).toBe(false);
      expect(res.cycleNumber).toBe(0);
    });

    it("should transition scheduled assigned benefit to active and consume cycle 1", async () => {
      const assigned = {
        id: 500,
        crecheId,
        campaignName: "Campanha 3 Meses",
        billingCycles: 3,
        status: "scheduled",
        commercialConditionId: 600,
        targetPlanId: 1,
        targetBillingInterval: "month",
        catalogPriceCents: 20000,
        restorationPriceCents: 20000,
        restorationStripePriceId: "price_restore_standard",
      };

      const mockDb: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => {
              const p: any = Promise.resolve([]);
              p.limit = vi.fn().mockImplementation(async () => {
                if (table === assignedCommercialBenefitsTable) return [assigned];
                if (table === benefitCycleConsumptionsTable) return []; // no prior consumption for this key
                return [
                  {
                    id: 600,
                    crecheId,
                    status: "pending_activation",
                    validFrom: new Date(),
                    pricingOverrideType: "percentage",
                    pricingOverrideValue: 2000,
                  },
                ];
              });
              return p;
            }),
          })),
        })),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: 500 }]),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockImplementation(() => {
            const p: any = Promise.resolve([{ id: 1 }]);
            p.returning = vi.fn().mockResolvedValue([{ id: 1 }]);
            return p;
          }),
        }),
        transaction: vi.fn(async (cb) => cb(mockDb)),
      };

      const res = await reconcileBenefitCycleAdvancement({
        crecheId,
        stripeSubscriptionId,
        contractualPeriodStart: pStart,
        contractualPeriodEnd: pEnd,
        dbClient: mockDb,
        stripeClient: mockStripe,
      });

      expect(res.cycleConsumed).toBe(true);
      expect(res.cycleNumber).toBe(1);
      expect(res.completed).toBe(false);

      // Verify status update to 'active'
      expect(mockDb.update).toHaveBeenCalled();
      // Verify consumption inserted into ledger
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("should be idempotent and not consume cycle if same cycleKey already exists", async () => {
      const assigned = {
        id: 500,
        crecheId,
        campaignName: "Campanha 3 Meses",
        billingCycles: 3,
        status: "active",
        commercialConditionId: 600,
      };

      const existingConsumption = {
        id: 1,
        assignedBenefitId: 500,
        cycleKey: `${stripeSubscriptionId}:${pStart.getTime()}:${pEnd.getTime()}`,
        cycleNumber: 1,
      };

      const mockDb: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => ({
              limit: vi.fn().mockImplementation(async () => {
                if (table === assignedCommercialBenefitsTable) return [assigned];
                if (table === benefitCycleConsumptionsTable) return [existingConsumption];
                return [];
              }),
            })),
          })),
        })),
        insert: vi.fn(),
      };

      const res = await reconcileBenefitCycleAdvancement({
        crecheId,
        stripeSubscriptionId,
        contractualPeriodStart: pStart,
        contractualPeriodEnd: pEnd,
        dbClient: mockDb,
        stripeClient: mockStripe,
      });

      expect(res.cycleConsumed).toBe(false);
      expect(res.cycleNumber).toBe(1);
      expect(mockDb.insert).not.toHaveBeenCalled();
    });
  });

  describe("reconcileCampaignRestoration", () => {
    it("should create successor condition, release schedule, and complete campaign when Stripe price matches restoration price", async () => {
      const assigned = {
        id: 500,
        crecheId,
        campaignName: "Campanha 3 Meses",
        billingCycles: 3,
        status: "active",
        stripeSubscriptionId: "sub_cadence_xyz",
        stripeScheduleId: "sched_arkpet_123",
        targetPlanId: 1,
        targetBillingInterval: "month",
        catalogPriceCents: 20000,
        restorationPriceCents: 20000,
        restorationStripePriceId: "price_restore_200",
      };

      const mockStripeLocal: any = {
        subscriptions: {
          retrieve: vi.fn().mockResolvedValue({
            id: "sub_cadence_xyz",
            items: {
              data: [
                {
                  id: "si_1",
                  price: { id: "price_restore_200" },
                },
              ],
            },
          }),
        },
        subscriptionSchedules: {
          retrieve: vi.fn().mockResolvedValue({ id: "sched_arkpet_123", status: "active" }),
          release: vi.fn().mockResolvedValue({ id: "sched_arkpet_123" }),
        },
      };

      const mockTx: any = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([
              {
                id: 888,
                crecheId,
                status: "pending_activation",
                validFrom: new Date(),
                pricingOverrideType: "fixed_amount",
                pricingOverrideValue: 20000,
              },
            ]),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: 500 }]),
          }),
        }),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  id: 99,
                  crecheId,
                  status: "pending_activation",
                  validFrom: new Date(),
                  pricingOverrideType: "fixed_amount",
                  pricingOverrideValue: 20000,
                },
              ]),
            }),
          }),
        }),
      };
      mockTx.transaction = vi.fn(async (cb) => cb(mockTx));

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([assigned]),
            }),
          }),
        }),
        transaction: vi.fn(async (cb) => cb(mockTx)),
      };

      const res = await reconcileCampaignRestoration({
        assignedBenefitId: 500,
        dbClient: mockDb,
        stripeClient: mockStripeLocal,
      });

      expect(res.completed).toBe(true);
      expect(res.status).toBe("completed");
      expect(mockTx.insert).toHaveBeenCalled();
      expect(mockStripeLocal.subscriptionSchedules.release).toHaveBeenCalledWith("sched_arkpet_123");
    });

    it("should flag restoration_review if Stripe subscription price differs from restoration price", async () => {
      const assigned = {
        id: 500,
        crecheId,
        campaignName: "Campanha 3 Meses",
        billingCycles: 3,
        status: "active",
        stripeSubscriptionId: "sub_cadence_xyz",
        stripeScheduleId: "sched_arkpet_123",
        targetPlanId: 1,
        targetBillingInterval: "month",
        catalogPriceCents: 20000,
        restorationPriceCents: 20000,
        restorationStripePriceId: "price_restore_200",
      };

      const mockStripeLocal: any = {
        subscriptions: {
          retrieve: vi.fn().mockResolvedValue({
            id: "sub_cadence_xyz",
            items: {
              data: [
                {
                  id: "si_1",
                  price: { id: "price_unexpected_something_else" },
                },
              ],
            },
          }),
        },
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([assigned]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: 500 }]),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      };

      const res = await reconcileCampaignRestoration({
        assignedBenefitId: 500,
        dbClient: mockDb,
        stripeClient: mockStripeLocal,
      });

      expect(res.completed).toBe(false);
      expect(res.status).toBe("restoration_review");
      expect(mockDb.update).toHaveBeenCalled();
    });
  });
});
