import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  assertConditionTenantMatch,
  assertConditionFullSnapshot,
  transitionActiveCondition,
  CrossTenantConditionError,
  InvalidConditionSnapshotError,
} from "../services/commercialConditions.js";

describe("Commercial Conditions & Tenant Pointer Safety Unit Tests (R36.C)", () => {
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

  describe("assertConditionFullSnapshot (Full-Snapshot Invariant)", () => {
    it("accepts a complete, valid condition snapshot", () => {
      expect(() =>
        assertConditionFullSnapshot({
          crecheId: 5,
          status: "draft",
          validFrom: new Date(),
          pricingOverrideType: "fixed_price",
          pricingOverrideValue: 15000,
          entitlementPetLimit: 25,
        }),
      ).not.toThrow();
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
    let mockTxState: {
      conditions: Map<number, any>;
      subscriptions: Map<number, any>;
      updateLog: string[];
    };

    beforeEach(() => {
      mockTxState = {
        conditions: new Map([
          [
            1,
            {
              id: 1,
              crecheId: 10,
              status: "active",
              validFrom: new Date(),
              pricingOverrideType: "none",
            },
          ],
          [
            2,
            {
              id: 2,
              crecheId: 10,
              status: "draft",
              validFrom: new Date(),
              pricingOverrideType: "fixed_price",
              pricingOverrideValue: 20000,
            },
          ],
          [
            3,
            {
              id: 3,
              crecheId: 99, // Creche 99 (cross-tenant condition)
              status: "draft",
              validFrom: new Date(),
              pricingOverrideType: "none",
            },
          ],
        ]),
        subscriptions: new Map([
          [
            100,
            {
              id: 100,
              crecheId: 10,
              planId: 2,
              activeConditionId: null, // Legacy subscription starts with null
            },
          ],
        ]),
        updateLog: [],
      };
    });

    function createMockTxDb() {
      const tx = {
        select: vi.fn().mockImplementation((fields) => ({
          from: vi.fn().mockImplementation((table) => ({
            where: vi.fn().mockImplementation((condition) => ({
              limit: vi.fn().mockImplementation(() => {
                // Return appropriate mock data based on query
                const tableName = (table as any)?._?.name ?? "";
                if (tableName === "subscriptions") {
                  for (const sub of mockTxState.subscriptions.values()) {
                    return Promise.resolve([sub]);
                  }
                }
                // Conditions table
                return Promise.resolve([]);
              }),
            })),
          })),
        })),
        update: vi.fn().mockImplementation((table) => ({
          set: vi.fn().mockImplementation((updates) => ({
            where: vi.fn().mockImplementation(() => {
              const tableName = (table as any)?._?.name ?? "";
              if (updates.status === "superseded") {
                mockTxState.updateLog.push("supersede_previous");
              } else if (updates.status === "active") {
                mockTxState.updateLog.push("activate_new");
              } else if (updates.activeConditionId !== undefined) {
                mockTxState.updateLog.push("update_subscription_pointer");
              }
              return Promise.resolve([{ rowCount: 1 }]);
            }),
          })),
        })),
        transaction: vi.fn().mockImplementation(async (callback) => {
          return await callback(tx);
        }),
      };

      // Custom mock for transitionActiveCondition queries
      tx.select = vi.fn().mockImplementation(() => ({
        from: vi.fn().mockImplementation((table) => ({
          where: vi.fn().mockImplementation(() => ({
            limit: vi.fn().mockImplementation(() => {
              return Promise.resolve([]);
            }),
          })),
        })),
      }));

      return tx;
    }

    it("verifies transitionActiveCondition supersedes old before activating new", async () => {
      // Setup dedicated mock database
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
                    pricingOverrideType: "fixed_price",
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
