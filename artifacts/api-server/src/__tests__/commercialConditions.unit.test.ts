import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  assertConditionTenantMatch,
  assertConditionFullSnapshot,
  assertConditionCanActivate,
  validatePricingOverride,
  transitionActiveCondition,
  CrossTenantConditionError,
  InvalidConditionSnapshotError,
  InvalidPricingOverrideError,
} from "../services/commercialConditions.js";

describe("Commercial Conditions & Tenant Pointer Safety Unit Tests (R36.C1)", () => {
  describe("assertConditionTenantMatch (Cross-Tenant Pointer Guard)", () => {
    it("passes when subscription crecheId matches condition crecheId", () => {
      expect(() => assertConditionTenantMatch(42, 42)).not.toThrow();
    });

    it("throws CrossTenantConditionError when subscription crecheId differs from condition crecheId", () => {
      expect(() => assertConditionTenantMatch(1, 2)).toThrow(CrossTenantConditionError);
      expect(() => assertConditionTenantMatch(10, 99)).toThrow(
        /Cross-tenant commercial condition violation/,
      );
    });
  });

  describe("validatePricingOverride (Pricing Override Contract Alignment)", () => {
    it("accepts 'none' with null, undefined, or 0", () => {
      expect(() => validatePricingOverride("none", null)).not.toThrow();
      expect(() => validatePricingOverride("none", undefined)).not.toThrow();
      expect(() => validatePricingOverride("none", 0)).not.toThrow();
      expect(() => validatePricingOverride(null, null)).not.toThrow();
    });

    it("rejects 'none' with non-zero value", () => {
      expect(() => validatePricingOverride("none", 1500)).toThrow(InvalidPricingOverrideError);
    });

    it("accepts 'fixed_amount' with non-negative integer centavos", () => {
      expect(() => validatePricingOverride("fixed_amount", 19990)).not.toThrow();
      expect(() => validatePricingOverride("fixed_amount", 0)).not.toThrow();
    });

    it("rejects 'fixed_amount' with negative values, floating points, or null", () => {
      expect(() => validatePricingOverride("fixed_amount", -100)).toThrow(InvalidPricingOverrideError);
      expect(() => validatePricingOverride("fixed_amount", 199.9)).toThrow(InvalidPricingOverrideError);
      expect(() => validatePricingOverride("fixed_amount", null)).toThrow(InvalidPricingOverrideError);
    });

    it("accepts 'percentage' with integer basis points in range 0..10000", () => {
      // 0% = 0 bps, 7.5% = 750 bps, 15% = 1500 bps, 100% = 10000 bps
      expect(() => validatePricingOverride("percentage", 0)).not.toThrow();
      expect(() => validatePricingOverride("percentage", 750)).not.toThrow();
      expect(() => validatePricingOverride("percentage", 1500)).not.toThrow();
      expect(() => validatePricingOverride("percentage", 10000)).not.toThrow();
    });

    it("rejects 'percentage' exceeding 10000 bps, negative values, or floats", () => {
      expect(() => validatePricingOverride("percentage", 10001)).toThrow(InvalidPricingOverrideError);
      expect(() => validatePricingOverride("percentage", -50)).toThrow(InvalidPricingOverrideError);
      expect(() => validatePricingOverride("percentage", 15.5)).toThrow(InvalidPricingOverrideError);
      expect(() => validatePricingOverride("percentage", null)).toThrow(InvalidPricingOverrideError);
    });

    it("rejects unsupported override types", () => {
      expect(() => validatePricingOverride("fixed_price", 100)).toThrow(InvalidPricingOverrideError);
      expect(() => validatePricingOverride("custom_discount_pct", 15)).toThrow(InvalidPricingOverrideError);
    });
  });

  describe("assertConditionFullSnapshot (Full-Snapshot Invariant & Lifecycle Alignment)", () => {
    it("accepts a complete, valid condition snapshot with fixed_amount", () => {
      expect(() =>
        assertConditionFullSnapshot({
          crecheId: 5,
          status: "draft",
          validFrom: new Date(),
          pricingOverrideType: "fixed_amount",
          pricingOverrideValue: 15000,
          entitlementPetLimit: 25,
        }),
      ).not.toThrow();
    });

    it("accepts valid canonical lifecycle states: pending_activation, active, activation_failed, superseded, cancelled, abandoned", () => {
      const statuses = [
        "draft",
        "pending_activation",
        "active",
        "activation_failed",
        "superseded",
        "cancelled",
        "abandoned",
      ] as const;

      for (const status of statuses) {
        expect(() =>
          assertConditionFullSnapshot({
            crecheId: 5,
            status,
            validFrom: new Date(),
            pricingOverrideType: "percentage",
            pricingOverrideValue: 1500, // 15% in basis points
          }),
        ).not.toThrow();
      }
    });

    it("rejects obsolete pending_acceptance condition status", () => {
      expect(() =>
        assertConditionFullSnapshot({
          crecheId: 5,
          status: "pending_acceptance" as any,
          validFrom: new Date(),
          pricingOverrideType: "none",
        }),
      ).toThrow(/Invalid condition status 'pending_acceptance'/);
    });

    it("accepts baseline snapshot with pricingOverrideType 'none'", () => {
      expect(() =>
        assertConditionFullSnapshot({
          crecheId: 5,
          status: "active",
          validFrom: new Date(),
          pricingOverrideType: "none",
        }),
      ).not.toThrow();
    });

    it("rejects snapshot missing crecheId", () => {
      expect(() =>
        assertConditionFullSnapshot({
          status: "draft",
          validFrom: new Date(),
          pricingOverrideType: "none",
        }),
      ).toThrow(InvalidConditionSnapshotError);
    });

    it("rejects snapshot missing status", () => {
      expect(() =>
        assertConditionFullSnapshot({
          crecheId: 5,
          validFrom: new Date(),
          pricingOverrideType: "none",
        }),
      ).toThrow(InvalidConditionSnapshotError);
    });

    it("rejects snapshot missing validFrom", () => {
      expect(() =>
        assertConditionFullSnapshot({
          crecheId: 5,
          status: "draft",
          pricingOverrideType: "none",
        }),
      ).toThrow(InvalidConditionSnapshotError);
    });

    it("rejects snapshot missing pricingOverrideType (sparse patch forbidden)", () => {
      expect(() =>
        assertConditionFullSnapshot({
          crecheId: 5,
          status: "draft",
          validFrom: new Date(),
        }),
      ).toThrow(InvalidConditionSnapshotError);
    });

    it("rejects non-positive entitlementPetLimit", () => {
      expect(() =>
        assertConditionFullSnapshot({
          crecheId: 5,
          status: "draft",
          validFrom: new Date(),
          pricingOverrideType: "none",
          entitlementPetLimit: 0,
        }),
      ).toThrow(/must be a positive integer/);

      expect(() =>
        assertConditionFullSnapshot({
          crecheId: 5,
          status: "draft",
          validFrom: new Date(),
          pricingOverrideType: "none",
          entitlementPetLimit: -5,
        }),
      ).toThrow(/must be a positive integer/);
    });
  });

  describe("transitionActiveCondition (Atomic Transition Order Invariant)", () => {
    it("verifies transitionActiveCondition supersedes old before activating new", async () => {
      const actions: string[] = [];

      const tx: any = {
        select: vi.fn(),
        update: vi.fn(),
        transaction: vi.fn().mockImplementation(async (cb) => cb(tx)),
      };

      // Mock sub query
      tx.select
        .mockReturnValueOnce({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([{ id: 100, crecheId: 10 }]),
            }),
          }),
        })
        // Mock newCond query
        .mockReturnValueOnce({
          from: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([
                  {
                    id: 2,
                    crecheId: 10,
                    status: "draft",
                    validFrom: new Date(),
                    pricingOverrideType: "fixed_amount",
                    pricingOverrideValue: 20000,
                  },
                ]),
            }),
          }),
        })
        // Mock currentActive query
        .mockReturnValueOnce({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([{ id: 1 }]),
            }),
          }),
        });

      tx.update.mockImplementation((table: any) => ({
        set: (updates: any) => ({
          where: () => {
            if (updates.status === "superseded") {
              actions.push("superseded_old");
            } else if (updates.status === "active") {
              actions.push("activated_new");
            } else if (updates.activeConditionId !== undefined) {
              actions.push("updated_subscription_pointer");
            }
            return Promise.resolve([{ rowCount: 1 }]);
          },
        }),
      }));

      const result = await transitionActiveCondition(10, 2, tx);

      expect(result.previousConditionId).toBe(1);
      expect(result.activeConditionId).toBe(2);

      // Verify sequence: superseded old happened BEFORE activated new!
      expect(actions).toEqual([
        "superseded_old",
        "activated_new",
        "updated_subscription_pointer",
      ]);
    });

    it("rejects cross-tenant condition activation", async () => {
      const tx: any = {
        select: vi.fn(),
        update: vi.fn(),
        transaction: vi.fn().mockImplementation(async (cb) => cb(tx)),
      };

      // Subscription creche is 10, condition creche is 99
      tx.select
        .mockReturnValueOnce({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([{ id: 100, crecheId: 10 }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: () => ({
            where: () => ({
              limit: () =>
                Promise.resolve([
                  {
                    id: 3,
                    crecheId: 99, // Creche mismatch!
                    status: "draft",
                    validFrom: new Date(),
                    pricingOverrideType: "none",
                  },
                ]),
            }),
          }),
        });

      await expect(transitionActiveCondition(10, 3, tx)).rejects.toThrow(
        CrossTenantConditionError,
      );
    });
  });
});
