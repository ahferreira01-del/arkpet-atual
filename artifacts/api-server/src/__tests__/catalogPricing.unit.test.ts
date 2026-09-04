import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { commercialRouter } from "../routes/commercial.js";
import {
  resolveCatalogPlanPrice,
  normalizeBillingInterval,
  CatalogPriceResolutionError,
} from "../services/catalogPricing.js";
import { computeIntervalPrice, BILLING_INTERVALS, type BillingInterval } from "@workspace/db";
import { db } from "@workspace/db";
import { calculateEffectivePrice } from "../services/pricingEngine.js";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const mDb: any = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn((cb) => cb(mDb)),
  };
  return {
    ...actual,
    db: mDb,
  };
});

vi.mock("../middlewares/authenticate.js", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    if (!req.user) {
      req.user = { id: 1, role: "master_admin", email: "master@arkpet.com.br" };
    }
    next();
  },
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Sem permissão" });
      return;
    }
    next();
  },
}));

vi.mock("../services/commercialAudit.js", () => ({
  logCommercialAudit: vi.fn().mockResolvedValue({ id: 101 }),
  CommercialAuditError: class CommercialAuditError extends Error {},
}));

describe("R36.D2 — Catalog Price Source & Billing Interval Lock Unit Tests", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.resetAllMocks();
    app = express();
    app.use(express.json());
    app.use("/api/creches/:crecheId/commercial", commercialRouter);
  });

  describe("1. Billing Interval Normalizer", () => {
    it("normalizes standard and legacy interval names correctly", () => {
      expect(normalizeBillingInterval("month")).toBe("month");
      expect(normalizeBillingInterval("monthly")).toBe("month");
      expect(normalizeBillingInterval("MONTHLY")).toBe("month");
      expect(normalizeBillingInterval("quarter")).toBe("quarter");
      expect(normalizeBillingInterval("quarterly")).toBe("quarter");
      expect(normalizeBillingInterval("semester")).toBe("semester");
      expect(normalizeBillingInterval("semiannual")).toBe("semester");
      expect(normalizeBillingInterval("semestral")).toBe("semester");
      expect(normalizeBillingInterval("year")).toBe("year");
      expect(normalizeBillingInterval("yearly")).toBe("year");
      expect(normalizeBillingInterval("annual")).toBe("year");
    });

    it("rejects unsupported or malformed intervals with null", () => {
      expect(normalizeBillingInterval("weekly")).toBeNull();
      expect(normalizeBillingInterval("daily")).toBeNull();
      expect(normalizeBillingInterval("")).toBeNull();
      expect(normalizeBillingInterval(null)).toBeNull();
      expect(normalizeBillingInterval(undefined)).toBeNull();
      expect(normalizeBillingInterval(123)).toBeNull();
    });
  });

  describe("2. Multi-Interval Golden Suite (Section 14)", () => {
    const intervals: BillingInterval[] = ["month", "quarter", "semester", "year"];
    const explicitPrices: Record<BillingInterval, number> = {
      month: 31990,
      quarter: 89990,
      semester: 169990,
      year: 319900,
    };

    const mockPlan = {
      id: 10,
      name: "Plano Golden Multi-Interval",
      priceBrl: 31990,
      petLimit: 30,
      stripePriceId: "price_month_123",
      stripeProductId: "prod_123",
      isActive: true,
      createdAt: new Date(),
      description: "Test plan",
    };

    it("resolves Priority A explicit stored interval prices from planPricesTable", async () => {
      for (const interval of intervals) {
        const expectedPrice = explicitPrices[interval];
        const mockDb = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([
                  {
                    id: 100,
                    planId: 10,
                    interval,
                    priceBrl: expectedPrice,
                    stripePriceId: "price_" + interval + "_123",
                    isActive: true,
                  },
                ]),
              }),
            }),
          }),
        };

        const resolved = await resolveCatalogPlanPrice(mockPlan, interval, mockDb);
        expect(resolved.planId).toBe(10);
        expect(resolved.interval).toBe(interval);
        expect(resolved.catalogPriceCents).toBe(expectedPrice);
        expect(resolved.source).toBe("plan_prices");
      }
    });

    it("resolves Priority B derived prices via computeIntervalPrice when planPricesTable is empty", async () => {
      for (const interval of intervals) {
        const expectedDerived = computeIntervalPrice(mockPlan.priceBrl, interval);
        const mockDb = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        };

        const resolved = await resolveCatalogPlanPrice(mockPlan, interval, mockDb);
        expect(resolved.planId).toBe(10);
        expect(resolved.interval).toBe(interval);
        expect(resolved.catalogPriceCents).toBe(expectedDerived);
        expect(resolved.source).toBe("derived");
      }
    });

    it("verifies GET /support read model resolves interval-specific catalog price", async () => {
      // 1. Creche
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, name: "Creche Alpha", status: "active" }]),
          }),
        }),
      } as any);

      // 2. Subscription with billingInterval: "year"
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([
              {
                id: 10,
                status: "active",
                planId: 10,
                billingInterval: "year",
                stripeCustomerId: "cus_yr",
                stripeSubscriptionId: "sub_yr",
                activeConditionId: null,
              },
            ]),
          }),
        }),
      } as any);

      // 3. Plan
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([mockPlan]),
          }),
        }),
      } as any);

      // 4. Plan Prices query -> explicit annual price 319900
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([
              { id: 104, planId: 10, interval: "year", priceBrl: 319900 },
            ]),
          }),
        }),
      } as any);

      // 5. Active pets
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([{ total: 15 }]),
        }),
      } as any);

      // 6. Latest draft (none)
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            orderBy: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([]),
            }),
          }),
        }),
      } as any);

      const res = await request(app).get("/api/creches/1/commercial/support");
      expect(res.status).toBe(200);
      expect(res.body.subscription.billingInterval).toBe("year");
      expect(res.body.plan.billingInterval).toBe("year");
      expect(res.body.plan.priceCents).toBe(319900);
      expect(res.body.pricing.catalogPriceCents).toBe(319900);
      expect(res.body.pricing.finalEffectivePriceCents).toBe(319900);
    });

    it("verifies POST /preview-price resolves interval-specific catalog and preview pricing", async () => {
      // 1. Plan query
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([mockPlan]),
          }),
        }),
      } as any);

      // 2. Plan prices query -> explicit quarter price 89990
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([
              { id: 102, planId: 10, interval: "quarter", priceBrl: 89990 },
            ]),
          }),
        }),
      } as any);

      // 3. Active pets query
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([{ total: 8 }]),
        }),
      } as any);

      const res = await request(app)
        .post("/api/creches/1/commercial/preview-price")
        .send({
          planId: 10,
          billingInterval: "quarter",
          pricingOverrideType: "percentage",
          pricingOverrideValue: 1000, // 10% discount
        });

      expect(res.status).toBe(200);
      expect(res.body.billingInterval).toBe("quarter");
      expect(res.body.catalogPriceCents).toBe(89990);
      // 10% of 89990 is 8999 discount -> 80991
      expect(res.body.proposedEffectivePriceCents).toBe(80991);
      expect(res.body.absoluteDifferenceCents).toBe(8999);
    });
  });

  describe("3. Regression Test — No Silent Free Price (Section 15)", () => {
    it("fails closed with CatalogPriceResolutionError when paid plan has missing / corrupted price", async () => {
      const brokenPlan = {
        id: 99,
        name: "Broken Plan",
        priceBrl: null as any,
        petLimit: 20,
      };

      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      };

      await expect(resolveCatalogPlanPrice(brokenPlan as any, "month", mockDb)).rejects.toThrow(
        CatalogPriceResolutionError,
      );
    });

    it("returns HTTP 422 catalog_price_missing on POST /preview-price when price cannot be resolved", async () => {
      const brokenPlan = {
        id: 99,
        name: "Broken Plan",
        priceBrl: null as any,
        petLimit: 20,
      };

      // 1. Plan query
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([brokenPlan]),
          }),
        }),
      } as any);

      // 2. Plan prices query (empty)
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      } as any);

      const res = await request(app)
        .post("/api/creches/1/commercial/preview-price")
        .send({ planId: 99, billingInterval: "month" });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe("catalog_price_missing");
      expect(res.body.message).toContain("Authoritative catalog price");
    });
  });

  describe("4. Explicit Zero Price Test (Section 14 & Invariant 5)", () => {
    it("preserves explicit zero price (e.g. Trial or custom free tier) without error", async () => {
      const freePlan = {
        id: 0,
        name: "Trial Gratuito",
        priceBrl: 0,
        petLimit: 15,
        isActive: true,
      };

      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      };

      const resolved = await resolveCatalogPlanPrice(freePlan as any, "month", mockDb);
      expect(resolved.catalogPriceCents).toBe(0);
      expect(resolved.source).toBe("derived");
    });
  });

  describe("5. Existing Checkout Parity Characterization (Section 16)", () => {
    it("strictly agrees with billing.ts checkout price logic across all intervals", async () => {
      const samplePlan = {
        id: 5,
        name: "Commercial Plan",
        priceBrl: 49990,
        petLimit: 50,
      };

      const mockPlanPrices = [
        { planId: 5, interval: "month", priceBrl: 49990 },
        { planId: 5, interval: "quarter", priceBrl: 139990 },
        { planId: 5, interval: "semester", priceBrl: 269990 },
        { planId: 5, interval: "year", priceBrl: 499900 },
      ];

      for (const interval of BILLING_INTERVALS) {
        const matchingPlanPrice = mockPlanPrices.find((p) => p.interval === interval);
        // billing.ts checkout formula:
        const checkoutExpected = matchingPlanPrice?.priceBrl ?? computeIntervalPrice(samplePlan.priceBrl, interval);

        const mockDb = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(matchingPlanPrice ? [matchingPlanPrice] : []),
              }),
            }),
          }),
        };

        const resolved = await resolveCatalogPlanPrice(samplePlan as any, interval, mockDb);
        expect(resolved.catalogPriceCents).toBe(checkoutExpected);
      }
    });
  });

  describe("6. Percentage Dynamic Base vs Snapshot Base (Section 10)", () => {
    it("recalculates active percentage override against CURRENT catalog price, not historical snapshot", () => {
      const historicalSnapshotBase = 319900;
      const updatedCatalogPrice = 349900;
      const basisPoints = 1500; // 15%

      // Snapshot calculation at draft time
      const draftEffective = calculateEffectivePrice({
        catalogPriceCents: historicalSnapshotBase,
        pricingOverrideType: "percentage",
        pricingOverrideValue: basisPoints,
      });
      expect(draftEffective.finalEffectivePriceCents).toBe(271915);

      // Dynamic calculation when catalog price later changes
      const updatedEffective = calculateEffectivePrice({
        catalogPriceCents: updatedCatalogPrice,
        pricingOverrideType: "percentage",
        pricingOverrideValue: basisPoints,
      });
      // 15% discount on 349900 = 52485 -> 297415
      expect(updatedEffective.finalEffectivePriceCents).toBe(297415);
      expect(updatedEffective.overrideDiscountCents).toBe(52485);
    });
  });

  describe("7. Fixed Amount Override Invariance (Section 11)", () => {
    it("maintains absolute negotiated fixed amount regardless of catalog price changes", () => {
      const negotiatedFixedAmount = 24990;

      const calcBefore = calculateEffectivePrice({
        catalogPriceCents: 31990,
        pricingOverrideType: "fixed_amount",
        pricingOverrideValue: negotiatedFixedAmount,
      });
      expect(calcBefore.finalEffectivePriceCents).toBe(24990);

      // Later catalog price increase
      const calcAfter = calculateEffectivePrice({
        catalogPriceCents: 38990,
        pricingOverrideType: "fixed_amount",
        pricingOverrideValue: negotiatedFixedAmount,
      });
      expect(calcAfter.finalEffectivePriceCents).toBe(24990);
      expect(calcAfter.overrideDiscountCents).toBe(14000);
    });
  });

  describe("8. Pet Limit Succession Pricing Preservation (Section 13)", () => {
    it("preserves active percentage override terms and basis points without converting to fixed price", async () => {
      const KEY = "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";

      // 1. Creche exists
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, name: "Creche Alpha" }]),
          }),
        }),
      } as any);

      // 2. Subscription with activeConditionId = 50
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([
              { id: 1, crecheId: 1, planId: 2, billingInterval: "year", activeConditionId: 50 },
            ]),
          }),
        }),
      } as any);

      // 3. Active pets = 10
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([{ total: 10 }]),
        }),
      } as any);

      // 4. Idempotency query -> empty
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      } as any);

      // 5. Active condition resolution (fetch current active condition)
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([
              {
                id: 50,
                crecheId: 1,
                planId: 2,
                pricingOverrideType: "percentage",
                pricingOverrideValue: 1500, // 15%
                entitlementPetLimit: 25,
                snapshotBillingInterval: "year",
                snapshotBasePriceCents: 319900,
                status: "active",
                validFrom: new Date(),
                validUntil: null,
              },
            ]),
          }),
        }),
      } as any);

      // Inside transitionActiveCondition:
      // - fetch sub
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, crecheId: 1 }]),
          }),
        }),
      } as any);
      // - fetch draft condition
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([
              {
                id: 51,
                crecheId: 1,
                planId: 2,
                pricingOverrideType: "percentage",
                pricingOverrideValue: 1500,
                entitlementPetLimit: 45,
                snapshotBillingInterval: "year",
                snapshotBasePriceCents: 319900,
                status: "draft",
                validFrom: new Date(),
              },
            ]),
          }),
        }),
      } as any);
      // - fetch current active in transaction
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 50, status: "active" }]),
          }),
        }),
      } as any);

      // - insert returning
      let insertedSnapshot: any = null;
      vi.mocked(db.insert).mockReturnValueOnce({
        values: vi.fn().mockImplementationOnce((vals: any) => {
          insertedSnapshot = vals;
          return {
            returning: vi.fn().mockResolvedValueOnce([
              {
                id: 51,
                ...vals,
              },
            ]),
          };
        }),
      } as any);

      // - update condition returning
      vi.mocked(db.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue({}),
        }),
      } as any);

      // - fetch activated condition
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([
              {
                id: 51,
                crecheId: 1,
                planId: 2,
                pricingOverrideType: "percentage",
                pricingOverrideValue: 1500,
                entitlementPetLimit: 45,
                snapshotBillingInterval: "year",
                snapshotBasePriceCents: 319900,
                status: "active",
              },
            ]),
          }),
        }),
      } as any);

      const res = await request(app)
        .post("/api/creches/1/commercial/pet-limit-override")
        .set("X-Idempotency-Key", KEY)
        .send({
          entitlementPetLimit: 45,
          reason: "Expanding capacity while preserving annual percentage contract",
        });

      expect(res.status).toBe(201);
      expect(insertedSnapshot).toBeDefined();
      // Crucial invariant: must preserve percentage type and basis points, NOT converting to a fixed amount
      expect(insertedSnapshot.pricingOverrideType).toBe("percentage");
      expect(insertedSnapshot.pricingOverrideValue).toBe(1500);
      expect(insertedSnapshot.snapshotBillingInterval).toBe("year");
      expect(insertedSnapshot.entitlementPetLimit).toBe(45);
    });
  });
});
