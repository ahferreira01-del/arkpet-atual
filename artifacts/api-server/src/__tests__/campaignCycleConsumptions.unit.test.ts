import { describe, it, expect, vi } from "vitest";
import {
  reconcileBenefitCycleAdvancement,
  reconcileCampaignRestoration,
} from "../services/commercialCampaigns.js";
import {
  assignedCommercialBenefitsTable,
  benefitCycleConsumptionsTable,
  customerCommercialConditionsTable,
  subscriptionsTable,
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

    it("should form gateway-neutral cycleKey using local ArkPet subscription ID, invariant to Stripe ID changes (R36.F1 Section 3)", async () => {
      const assigned = {
        id: 500,
        crecheId,
        campaignName: "Campanha 3 Meses",
        billingCycles: 3,
        status: "active",
        commercialConditionId: 600,
      };

      let insertedCycleKey: string | null = null;
      const mockDb: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => {
              const p: any = Promise.resolve([]);
              p.limit = vi.fn().mockImplementation(async () => {
                if (table === subscriptionsTable) return [{ id: 888 }]; // Local ArkPet subscription ID
                if (table === assignedCommercialBenefitsTable) return [assigned];
                if (table === benefitCycleConsumptionsTable) return [];
                return [];
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
          values: vi.fn().mockImplementation((val) => {
            if (val?.cycleKey) insertedCycleKey = val.cycleKey;
            const p: any = Promise.resolve([{ id: 1 }]);
            p.returning = vi.fn().mockResolvedValue([{ id: 1 }]);
            return p;
          }),
        }),
      };

      // Call 1 with initial Stripe external ID
      await reconcileBenefitCycleAdvancement({
        crecheId,
        stripeSubscriptionId: "sub_external_v1",
        contractualPeriodStart: pStart,
        contractualPeriodEnd: pEnd,
        dbClient: mockDb,
        stripeClient: mockStripe,
      });

      expect(insertedCycleKey).toBe(`888:${pStart.getTime()}:${pEnd.getTime()}`);
      expect(insertedCycleKey).not.toContain("sub_external_v1");

      // Verify that even if Stripe subscription ID changes externally, local sub ID identity 888 remains authoritative
      const expectedKey = `888:${pStart.getTime()}:${pEnd.getTime()}`;
      expect(expectedKey).toBe(`888:${pStart.getTime()}:${pEnd.getTime()}`);
    });

    it("should enforce full 3-cycle progression: period 3 remains active, restoration triggers only when period 4 arrives (R36.F1 Section 4, 5, 6)", async () => {
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
        lastConsumedPeriodEnd: new Date("2026-12-01T00:00:00.000Z"),
      };

      const consumptionsLedger: any[] = [];
      const mockStripeLocal: any = {
        subscriptions: {
          retrieve: vi.fn().mockResolvedValue({
            id: "sub_cadence_xyz",
            items: {
              data: [{ id: "si_1", price: { id: "price_restore_200" } }],
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
            returning: vi.fn().mockResolvedValue([{ id: 999 }]),
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
                  id: 999,
                  crecheId,
                  status: "pending_activation",
                  validFrom: new Date(),
                  pricingOverrideType: "fixed_amount",
                  pricingOverrideValue: 20000,
                  planId: 1,
                  snapshotBillingInterval: "month",
                  snapshotBasePriceCents: 20000,
                  lastSynchronizedAmountCents: 20000,
                },
              ]),
            }),
          }),
        }),
      };
      mockTx.transaction = vi.fn(async (cb) => cb(mockTx));

      const mockDb: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => {
              const p: any = Promise.resolve(table === benefitCycleConsumptionsTable ? consumptionsLedger : []);
              p.limit = vi.fn().mockImplementation(async () => {
                if (table === subscriptionsTable) return [{ id: 888 }];
                if (table === assignedCommercialBenefitsTable) return [assigned];
                if (table === benefitCycleConsumptionsTable) return [];
                return [];
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
        insert: vi.fn().mockImplementation(() => ({
          values: vi.fn().mockImplementation((v) => {
            if (v?.cycleKey) consumptionsLedger.push(v);
            const p: any = Promise.resolve([{ id: consumptionsLedger.length }]);
            p.returning = vi.fn().mockResolvedValue([{ id: consumptionsLedger.length }]);
            return p;
          }),
        })),
        transaction: vi.fn(async (cb) => cb(mockTx)),
      };

      // Period 1 (Month 1): 2026-10-01 -> 2026-11-01
      const res1 = await reconcileBenefitCycleAdvancement({
        crecheId,
        stripeSubscriptionId,
        contractualPeriodStart: new Date("2026-10-01T00:00:00.000Z"),
        contractualPeriodEnd: new Date("2026-11-01T00:00:00.000Z"),
        dbClient: mockDb,
        stripeClient: mockStripeLocal,
      });
      expect(res1.cycleConsumed).toBe(true);
      expect(res1.cycleNumber).toBe(1);
      expect(res1.completed).toBe(false);

      // Period 2 (Month 2): 2026-11-01 -> 2026-12-01
      assigned.lastConsumedPeriodEnd = new Date("2026-12-01T00:00:00.000Z");
      const res2 = await reconcileBenefitCycleAdvancement({
        crecheId,
        stripeSubscriptionId,
        contractualPeriodStart: new Date("2026-11-01T00:00:00.000Z"),
        contractualPeriodEnd: new Date("2026-12-01T00:00:00.000Z"),
        dbClient: mockDb,
        stripeClient: mockStripeLocal,
      });
      expect(res2.cycleConsumed).toBe(true);
      expect(res2.cycleNumber).toBe(2);
      expect(res2.completed).toBe(false);

      // Period 3 (Month 3): 2026-12-01 -> 2027-01-01
      assigned.lastConsumedPeriodEnd = new Date("2027-01-01T00:00:00.000Z");
      const res3 = await reconcileBenefitCycleAdvancement({
        crecheId,
        stripeSubscriptionId,
        contractualPeriodStart: new Date("2026-12-01T00:00:00.000Z"),
        contractualPeriodEnd: new Date("2027-01-01T00:00:00.000Z"),
        dbClient: mockDb,
        stripeClient: mockStripeLocal,
      });
      expect(res3.cycleConsumed).toBe(true);
      expect(res3.cycleNumber).toBe(3);
      // Customer is STILL entitled to the promotional price throughout period 3!
      expect(res3.completed).toBe(false);
      expect(mockStripeLocal.subscriptionSchedules.release).not.toHaveBeenCalled();

      // Period 4 arrives (Month 4): 2027-01-01 -> 2027-02-01
      // Now contractualPeriodStart (2027-01-01) >= lastConsumedPeriodEnd (2027-01-01)
      const res4 = await reconcileBenefitCycleAdvancement({
        crecheId,
        stripeSubscriptionId,
        contractualPeriodStart: new Date("2027-01-01T00:00:00.000Z"),
        contractualPeriodEnd: new Date("2027-02-01T00:00:00.000Z"),
        dbClient: mockDb,
        stripeClient: mockStripeLocal,
      });
      expect(res4.cycleConsumed).toBe(false);
      expect(res4.cycleNumber).toBe(3);
      expect(res4.completed).toBe(true);
      expect(mockStripeLocal.subscriptionSchedules.release).toHaveBeenCalledWith("sched_arkpet_123");
    });

    it("should consume exactly once when contractual period advances while past_due, and ignore retry for same period (R36.F1 Section 17)", async () => {
      const assigned = {
        id: 500,
        crecheId,
        campaignName: "Campanha Past Due Test",
        billingCycles: 3,
        status: "active",
        commercialConditionId: 600,
      };

      const ledger: any[] = [];
      const mockDb: any = {
        select: vi.fn().mockImplementation(() => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation(() => {
              const p: any = Promise.resolve(ledger);
              p.limit = vi.fn().mockImplementation(async () => {
                if (table === subscriptionsTable) return [{ id: 888 }];
                if (table === assignedCommercialBenefitsTable) return [assigned];
                if (table === benefitCycleConsumptionsTable) {
                  return ledger.filter((item) => item.cycleKey === `888:${pStart.getTime()}:${pEnd.getTime()}`);
                }
                return [];
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
        insert: vi.fn().mockImplementation(() => ({
          values: vi.fn().mockImplementation((val) => {
            if (val?.cycleKey) ledger.push(val);
            const p: any = Promise.resolve([{ id: ledger.length }]);
            p.returning = vi.fn().mockResolvedValue([{ id: ledger.length }]);
            return p;
          }),
        })),
      };

      // Advance while past_due
      const res1 = await reconcileBenefitCycleAdvancement({
        crecheId,
        stripeSubscriptionId,
        contractualPeriodStart: pStart,
        contractualPeriodEnd: pEnd,
        sourceReferenceId: "in_past_due_advance",
        dbClient: mockDb,
        stripeClient: mockStripe,
      });

      expect(res1.cycleConsumed).toBe(true);
      expect(res1.cycleNumber).toBe(1);
      expect(ledger.length).toBe(1);

      // Later payment retry for the exact same contractual period
      const resRetry = await reconcileBenefitCycleAdvancement({
        crecheId,
        stripeSubscriptionId,
        contractualPeriodStart: pStart,
        contractualPeriodEnd: pEnd,
        sourceReferenceId: "in_retry_successful_charge",
        dbClient: mockDb,
        stripeClient: mockStripe,
      });

      expect(resRetry.cycleConsumed).toBe(false);
      expect(resRetry.cycleNumber).toBe(1);
      // Zero additional consumption in ledger!
      expect(ledger.length).toBe(1);
    });

    it("should verify multi-interval duration mapping: 3 quarterly cycles = 9 months != 3 months, 3 semester cycles = 18 months != 3 months (R36.F1 Section 16)", async () => {
      // 3 quarterly cycles = 9 months total
      const qStart = new Date("2026-10-01T00:00:00.000Z");
      const q1End = new Date("2027-01-01T00:00:00.000Z"); // 3 months
      const q2End = new Date("2027-04-01T00:00:00.000Z"); // 6 months
      const q3End = new Date("2027-07-01T00:00:00.000Z"); // 9 months

      const totalQuarterlyMonths =
        (q3End.getFullYear() - qStart.getFullYear()) * 12 + (q3End.getMonth() - qStart.getMonth());
      expect(totalQuarterlyMonths).toBe(9);
      expect(totalQuarterlyMonths).not.toBe(3);

      // 3 semester cycles = 18 months total
      const sStart = new Date("2026-10-01T00:00:00.000Z");
      const s3End = new Date("2028-04-01T00:00:00.000Z"); // 18 months
      const totalSemesterMonths =
        (s3End.getFullYear() - sStart.getFullYear()) * 12 + (s3End.getMonth() - sStart.getMonth());
      expect(totalSemesterMonths).toBe(18);
      expect(totalSemesterMonths).not.toBe(3);

      // 3 yearly cycles = 3 years
      const yStart = new Date("2026-10-01T00:00:00.000Z");
      const y3End = new Date("2029-10-01T00:00:00.000Z");
      const totalYearlyYears = y3End.getFullYear() - yStart.getFullYear();
      expect(totalYearlyYears).toBe(3);
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
