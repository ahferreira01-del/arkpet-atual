import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { commercialRouter } from "../routes/commercial.js";
import {
  executeStripeCommercialActivation,
  retryStripeCommercialActivation,
  abandonCommercialCondition,
  executePercentageReprice,
  identifySubscriptionItem,
  resolveOrCreateStripePrice,
  resolveStandardStripePrice,
  validateCadenceEquivalence,
  parseCommercialMetadata,
  ACTIVATION_TIMING_MODES,
  CommercialActivationError,
} from "../services/stripeCommercialActivation.js";
import { resolvePlanByPrice, applyStripeEvent, handleSubscriptionEvent } from "../lib/subscriptionSync.js";
import { db } from "@workspace/db";
import { customerCommercialConditionsTable } from "@workspace/db/schema";
import { getUncachableStripeClient } from "../lib/stripeClient.js";

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

vi.mock("../lib/stripeClient.js", () => ({
  getUncachableStripeClient: vi.fn(),
  getStripeSync: vi.fn(),
}));

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

describe("R36.E & R36.E1 — Stripe Commercial Activation & Gateway Reconciliation Unit Tests", () => {
  let app: express.Express;
  let mockStripe: any;

  beforeEach(() => {
    vi.resetAllMocks();
    mockStripe = {
      prices: {
        create: vi.fn(),
        retrieve: vi.fn().mockResolvedValue({
          id: "price_std",
          product: "prod_pro_xyz",
          currency: "brl",
          recurring: { interval: "month", interval_count: 1 },
        }),
      },
      subscriptions: {
        retrieve: vi.fn(),
        update: vi.fn(),
      },
    };
    vi.mocked(getUncachableStripeClient).mockResolvedValue(mockStripe as any);

    app = express();
    app.use(express.json());
    app.use("/api/creches/:crecheId/commercial", commercialRouter);
  });

  describe("1. Subscription Item Identification & Safety (Section 17)", () => {
    it("identifies single SaaS subscription item correctly", () => {
      const stripeSub: any = {
        id: "sub_123",
        items: {
          data: [
            {
              id: "si_item_1",
              price: { id: "price_standard", product: "prod_pro" },
            },
          ],
        },
      };

      const item = identifySubscriptionItem(stripeSub, "prod_pro");
      expect(item.id).toBe("si_item_1");
    });

    it("fails closed with RECONCILIATION_REQUIRED if 0 subscription items exist", () => {
      const stripeSub: any = {
        id: "sub_123",
        items: { data: [] },
      };

      expect(() => identifySubscriptionItem(stripeSub)).toThrow(CommercialActivationError);
      expect(() => identifySubscriptionItem(stripeSub)).toThrowError(
        /Assinatura Stripe sem itens recorrentes cadastrados/,
      );
    });

    it("fails closed with AMBIGUOUS_SUBSCRIPTION_ITEMS if multiple items exist and cannot be uniquely matched", () => {
      const stripeSub: any = {
        id: "sub_123",
        items: {
          data: [
            { id: "si_1", price: { id: "p1", product: "prod_other" } },
            { id: "si_2", price: { id: "p2", product: "prod_another" } },
          ],
        },
      };

      expect(() => identifySubscriptionItem(stripeSub, "prod_target")).toThrow(CommercialActivationError);
      expect(() => identifySubscriptionItem(stripeSub, "prod_target")).toThrowError(
        /Múltiplos itens recorrentes identificados/,
      );
    });
  });

  describe("2. Standard vs Custom Price Resolution & Cadence (R36.E & R36.E1)", () => {
    it("reuses standard Stripe Price when override is 'none' (standard price reversion)", async () => {
      const mockCondition: any = {
        id: 50,
        crecheId: 1,
        pricingOverrideType: "none",
        pricingOverrideValue: null,
      };
      const mockPlan: any = {
        id: 2,
        name: "Plano Pro",
        stripePriceId: "price_plan_pro_monthly",
        stripeProductId: "prod_pro",
      };

      mockStripe.prices.retrieve.mockResolvedValueOnce({
        id: "price_plan_pro_monthly",
        product: "prod_pro",
        currency: "brl",
        recurring: { interval: "month", interval_count: 1 },
      });

      const mockDb: any = {
        select: vi.fn().mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([{ stripePriceId: "price_plan_pro_monthly" }]),
            }),
          }),
        }),
      };

      const result = await resolveOrCreateStripePrice({
        condition: mockCondition,
        targetPlan: mockPlan,
        interval: "month",
        effectivePriceCents: 31990,
        catalogPriceCents: 31990,
        crecheId: 1,
        stripeClient: mockStripe,
        dbClient: mockDb,
      });

      expect(result.isCustom).toBe(false);
      expect(result.stripePriceId).toBe("price_plan_pro_monthly");
      expect(mockStripe.prices.create).not.toHaveBeenCalled();
    });

    it("creates agreement-scoped custom Stripe Price with metadata and step idempotency key", async () => {
      const mockCondition: any = {
        id: 55,
        crecheId: 1,
        pricingOverrideType: "fixed_amount",
        pricingOverrideValue: 24990,
        agreementId: 12,
      };
      const mockPlan: any = {
        id: 2,
        name: "Plano Pro",
        stripePriceId: "price_std",
        stripeProductId: "prod_pro_123",
      };

      mockStripe.prices.retrieve.mockResolvedValueOnce({
        id: "price_std",
        product: "prod_pro_123",
        currency: "brl",
        recurring: { interval: "month", interval_count: 1 },
      });

      mockStripe.prices.create.mockResolvedValueOnce({
        id: "price_custom_55",
      });

      const mockDb: any = {
        update: vi.fn().mockReturnValueOnce({
          set: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      };

      const result = await resolveOrCreateStripePrice({
        condition: mockCondition,
        targetPlan: mockPlan,
        interval: "month",
        effectivePriceCents: 24990,
        catalogPriceCents: 31990,
        crecheId: 1,
        stripeClient: mockStripe,
        dbClient: mockDb,
      });

      expect(result.isCustom).toBe(true);
      expect(result.stripePriceId).toBe("price_custom_55");
      expect(mockStripe.prices.create).toHaveBeenCalledWith(
        {
          currency: "brl",
          unit_amount: 24990,
          recurring: { interval: "month", interval_count: 1 },
          product: "prod_pro_123",
          metadata: {
            crecheId: "1",
            conditionId: "55",
            agreementId: "12",
            planId: "2",
            billingInterval: "month",
            overrideType: "fixed_amount",
            overrideValue: "24990",
            effectiveAmountCents: "24990",
            scope: "agreement_scoped_commercial",
            environment: expect.any(String),
            custom: "true",
          },
        },
        {
          idempotencyKey: "commercial:55:create-custom-price",
        },
      );
    });

    it("reuses already generated stripePriceId on condition during retry without recreating", async () => {
      const mockCondition: any = {
        id: 55,
        crecheId: 1,
        pricingOverrideType: "fixed_amount",
        pricingOverrideValue: 24990,
        stripePriceId: "price_custom_already_created",
      };
      const mockPlan: any = { id: 2, name: "Plano Pro", stripeProductId: "prod_123" };

      const result = await resolveOrCreateStripePrice({
        condition: mockCondition,
        targetPlan: mockPlan,
        interval: "month",
        effectivePriceCents: 24990,
        catalogPriceCents: 31990,
        crecheId: 1,
        stripeClient: mockStripe,
      });

      expect(result.isCustom).toBe(true);
      expect(result.stripePriceId).toBe("price_custom_already_created");
      expect(mockStripe.prices.create).not.toHaveBeenCalled();
    });

    it("clones quarter custom Price cadence as Stripe month x3 (R36.E1 Section 1, 2, 5)", async () => {
      const mockCondition: any = { id: 60, crecheId: 1, pricingOverrideType: "fixed_amount", pricingOverrideValue: 80000 };
      const mockPlan: any = { id: 2, name: "Plano Pro", stripeProductId: "prod_pro_quarter" };

      mockStripe.prices.retrieve.mockResolvedValueOnce({
        id: "price_quarter_std",
        product: "prod_pro_quarter",
        currency: "brl",
        recurring: { interval: "month", interval_count: 3 },
      });
      mockStripe.prices.create.mockResolvedValueOnce({ id: "price_custom_quarter" });

      const mockDb: any = {
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
      };

      const result = await resolveOrCreateStripePrice({
        condition: mockCondition,
        targetPlan: mockPlan,
        interval: "quarter",
        effectivePriceCents: 80000,
        catalogPriceCents: 90000,
        standardPriceId: "price_quarter_std",
        crecheId: 1,
        stripeClient: mockStripe,
        dbClient: mockDb,
      });

      expect(result.stripePriceId).toBe("price_custom_quarter");
      expect(mockStripe.prices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recurring: { interval: "month", interval_count: 3 },
        }),
        expect.any(Object),
      );
    });

    it("clones semester custom Price cadence as Stripe month x6 (R36.E1 Section 1, 2, 5)", async () => {
      const mockCondition: any = { id: 61, crecheId: 1, pricingOverrideType: "fixed_amount", pricingOverrideValue: 150000 };
      const mockPlan: any = { id: 2, name: "Plano Pro", stripeProductId: "prod_pro_semester" };

      mockStripe.prices.retrieve.mockResolvedValueOnce({
        id: "price_semester_std",
        product: "prod_pro_semester",
        currency: "brl",
        recurring: { interval: "month", interval_count: 6 },
      });
      mockStripe.prices.create.mockResolvedValueOnce({ id: "price_custom_semester" });

      const mockDb: any = {
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
      };

      const result = await resolveOrCreateStripePrice({
        condition: mockCondition,
        targetPlan: mockPlan,
        interval: "semester",
        effectivePriceCents: 150000,
        catalogPriceCents: 170000,
        standardPriceId: "price_semester_std",
        crecheId: 1,
        stripeClient: mockStripe,
        dbClient: mockDb,
      });

      expect(result.stripePriceId).toBe("price_custom_semester");
      expect(mockStripe.prices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recurring: { interval: "month", interval_count: 6 },
        }),
        expect.any(Object),
      );
    });

    it("clones annual custom Price cadence as Stripe year x1 (R36.E1 Section 1, 2, 5)", async () => {
      const mockCondition: any = { id: 62, crecheId: 1, pricingOverrideType: "fixed_amount", pricingOverrideValue: 280000 };
      const mockPlan: any = { id: 2, name: "Plano Pro", stripeProductId: "prod_pro_annual" };

      mockStripe.prices.retrieve.mockResolvedValueOnce({
        id: "price_annual_std",
        product: "prod_pro_annual",
        currency: "brl",
        recurring: { interval: "year", interval_count: 1 },
      });
      mockStripe.prices.create.mockResolvedValueOnce({ id: "price_custom_annual" });

      const mockDb: any = {
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
      };

      const result = await resolveOrCreateStripePrice({
        condition: mockCondition,
        targetPlan: mockPlan,
        interval: "year",
        effectivePriceCents: 280000,
        catalogPriceCents: 320000,
        standardPriceId: "price_annual_std",
        crecheId: 1,
        stripeClient: mockStripe,
        dbClient: mockDb,
      });

      expect(result.stripePriceId).toBe("price_custom_annual");
      expect(mockStripe.prices.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recurring: { interval: "year", interval_count: 1 },
        }),
        expect.any(Object),
      );
    });

    it("fails closed with CADENCE_MISMATCH when Stripe recurring cadence does not match ArkPet interval (R36.E1 Section 3)", () => {
      expect(() =>
        validateCadenceEquivalence("quarter", { interval: "month", interval_count: 1 } as any),
      ).toThrow(CommercialActivationError);

      expect(() =>
        validateCadenceEquivalence("semester", { interval: "month", interval_count: 3 } as any),
      ).toThrow(CommercialActivationError);

      expect(() =>
        validateCadenceEquivalence("month", { interval: "year", interval_count: 1 } as any),
      ).toThrow(CommercialActivationError);
    });

    it("fails closed with STANDARD_STRIPE_PRICE_MISSING when standard price is missing for longer intervals (R36.E1 Section 4)", async () => {
      const mockPlan: any = { id: 2, name: "Plano Pro", stripePriceId: "price_monthly_only" };
      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      };

      await expect(
        resolveStandardStripePrice({
          targetPlan: mockPlan,
          interval: "quarter",
          stripeClient: mockStripe,
          dbClient: mockDb,
        }),
      ).rejects.toThrow(/Preço padrão do Stripe não configurado para o plano 'Plano Pro' no período 'quarter'/);
    });
  });

  describe("3. Two-Phase Orchestration & Stripe Activation (Section 18, 19, 20, 21)", () => {
    it("fails closed when subscription has no stripeSubscriptionId (STRIPE_RECURRING_SUBSCRIPTION_REQUIRED)", async () => {
      const mockCondition = {
        id: 76,
        crecheId: 1,
        planId: 2,
        pricingOverrideType: "fixed_amount",
        pricingOverrideValue: 20000,
        status: "draft",
        executionRequirement: "STRIPE_REQUIRED",
      };
      const mockSub = {
        id: 1,
        crecheId: 1,
        planId: 2,
        stripeSubscriptionId: null, // manual/PIX account
      };

      const mockDb: any = {
        select: vi
          .fn()
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({
                limit: vi.fn().mockResolvedValueOnce([mockCondition]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({
                limit: vi.fn().mockResolvedValueOnce([mockSub]),
              }),
            }),
          }),
      };

      await expect(
        executeStripeCommercialActivation({
          crecheId: 1,
          conditionId: 76,
          prorationMode: ACTIVATION_TIMING_MODES.EFFECTIVE_NOW_PRORATE,
          reason: "Ativação em conta sem Stripe",
          idempotencyKey: "11111111-1111-4111-8111-111111111111",
          dbClient: mockDb,
          stripeClient: mockStripe,
        }),
      ).rejects.toThrow(/não possui uma assinatura recorrente Stripe vinculada/);
    });

    it("executes two-phase activation successfully for fixed custom price with always_invoice proration", async () => {
      const mockCondition = {
        id: 77,
        crecheId: 1,
        planId: 2,
        pricingOverrideType: "fixed_amount",
        pricingOverrideValue: 19990,
        status: "draft",
        executionRequirement: "STRIPE_REQUIRED",
      };
      const mockSub = {
        id: 1,
        crecheId: 1,
        planId: 2,
        billingInterval: "month",
        stripeSubscriptionId: "sub_live_123",
        activeConditionId: null,
      };
      const mockPlan = {
        id: 2,
        name: "Plano Pro",
        priceBrl: 31990,
        stripePriceId: "price_std",
        stripeProductId: "prod_pro_xyz",
      };
      const mockPlanPrices = [
        { id: 1, planId: 2, interval: "month", priceBrl: 31990, stripePriceId: "price_std" },
      ];

      mockStripe.prices.retrieve.mockResolvedValue({
        id: "price_std",
        product: "prod_pro_xyz",
        currency: "brl",
        recurring: { interval: "month", interval_count: 1 },
      });
      mockStripe.prices.create.mockResolvedValueOnce({ id: "price_custom_77" });
      mockStripe.subscriptions.retrieve.mockResolvedValueOnce({
        id: "sub_live_123",
        items: {
          data: [{ id: "si_item_77", price: { id: "price_old", product: "prod_pro_xyz" } }],
        },
      });
      mockStripe.subscriptions.update.mockResolvedValueOnce({
        id: "sub_live_123",
      });

      const updatedConditionRow = { ...mockCondition, status: "active", syncStatus: "synced" };

      const mockDb: any = {
        select: vi
          .fn()
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({
                limit: vi.fn().mockResolvedValueOnce([mockCondition]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({
                limit: vi.fn().mockResolvedValueOnce([mockSub]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({
                limit: vi.fn().mockResolvedValueOnce([mockPlan]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({
                limit: vi.fn().mockResolvedValueOnce(mockPlanPrices),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({
                limit: vi.fn().mockResolvedValueOnce([]),
              }),
            }),
          }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updatedConditionRow]),
            }),
          }),
        }),
        transaction: vi.fn((cb) => cb(mockDb)),
      };

      const result = await executeStripeCommercialActivation({
        crecheId: 1,
        conditionId: 77,
        prorationMode: ACTIVATION_TIMING_MODES.EFFECTIVE_NOW_PRORATE,
        reason: "Desconto especial negociado com diretoria",
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
        actorId: 1,
        actorEmail: "master@arkpet.com.br",
        dbClient: mockDb,
        stripeClient: mockStripe,
      });

      expect(result.success).toBe(true);
      expect(result.stripePriceId).toBe("price_custom_77");
      expect(result.isCustomPrice).toBe(true);
      expect(result.effectivePriceCents).toBe(19990);

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
        "sub_live_123",
        {
          items: [{ id: "si_item_77", price: "price_custom_77" }],
          proration_behavior: "always_invoice",
          metadata: {
            crecheId: "1",
            conditionId: "77",
          },
        },
        {
          idempotencyKey: "commercial:77:update-sub-item",
        },
      );
    });

    it("applies no-proration mode ('none') correctly when EFFECTIVE_NOW_NO_PRORATION is selected", async () => {
      const mockCondition = {
        id: 78,
        crecheId: 1,
        planId: 2,
        pricingOverrideType: "fixed_amount",
        pricingOverrideValue: 19990,
        status: "draft",
        executionRequirement: "STRIPE_REQUIRED",
      };
      const mockSub = {
        id: 1,
        crecheId: 1,
        planId: 2,
        billingInterval: "month",
        stripeSubscriptionId: "sub_live_123",
      };
      const mockPlan = {
        id: 2,
        name: "Plano Pro",
        priceBrl: 31990,
        stripePriceId: "price_std",
        stripeProductId: "prod_pro_xyz",
      };
      const mockPlanPrices = [
        { id: 1, planId: 2, interval: "month", priceBrl: 31990, stripePriceId: "price_std" },
      ];

      mockStripe.prices.retrieve.mockResolvedValue({
        id: "price_std",
        product: "prod_pro_xyz",
        currency: "brl",
        recurring: { interval: "month", interval_count: 1 },
      });
      mockStripe.prices.create.mockResolvedValueOnce({ id: "price_custom_78" });
      mockStripe.subscriptions.retrieve.mockResolvedValueOnce({
        id: "sub_live_123",
        items: {
          data: [{ id: "si_item_78", price: { id: "price_old", product: "prod_pro_xyz" } }],
        },
      });
      mockStripe.subscriptions.update.mockResolvedValueOnce({ id: "sub_live_123" });

      const updatedConditionRow = { ...mockCondition, status: "active", syncStatus: "synced" };

      const mockDb: any = {
        select: vi
          .fn()
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({
                limit: vi.fn().mockResolvedValueOnce([mockCondition]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({
                limit: vi.fn().mockResolvedValueOnce([mockSub]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({
                limit: vi.fn().mockResolvedValueOnce([mockPlan]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({
                limit: vi.fn().mockResolvedValueOnce(mockPlanPrices),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({
                limit: vi.fn().mockResolvedValueOnce([]),
              }),
            }),
          }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updatedConditionRow]),
            }),
          }),
        }),
        transaction: vi.fn((cb) => cb(mockDb)),
      };

      await executeStripeCommercialActivation({
        crecheId: 1,
        conditionId: 78,
        prorationMode: ACTIVATION_TIMING_MODES.EFFECTIVE_NOW_NO_PRORATION,
        reason: "Sem prorrogação ou rateio imediato",
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
        dbClient: mockDb,
        stripeClient: mockStripe,
      });

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
        "sub_live_123",
        expect.objectContaining({
          proration_behavior: "none",
        }),
        expect.any(Object),
      );
    });

    it("handles Stripe API failure: marks condition activation_failed/sync_failed while preserving prior condition", async () => {
      const mockCondition = {
        id: 79,
        crecheId: 1,
        planId: 2,
        pricingOverrideType: "fixed_amount",
        pricingOverrideValue: 19990,
        status: "draft",
        executionRequirement: "STRIPE_REQUIRED",
      };
      const mockSub = {
        id: 1,
        crecheId: 1,
        planId: 2,
        billingInterval: "month",
        stripeSubscriptionId: "sub_live_123",
        activeConditionId: 42,
      };
      const mockPlan = {
        id: 2,
        name: "Plano Pro",
        priceBrl: 31990,
        stripePriceId: "price_std",
        stripeProductId: "prod_pro_xyz",
      };
      const mockPlanPrices = [
        { id: 1, planId: 2, interval: "month", priceBrl: 31990, stripePriceId: "price_std" },
      ];

      mockStripe.prices.create.mockRejectedValueOnce(new Error("Stripe rate limit exceeded (429)"));

      const mockDb: any = {
        select: vi
          .fn()
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({
                limit: vi.fn().mockResolvedValueOnce([mockCondition]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({
                limit: vi.fn().mockResolvedValueOnce([mockSub]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({
                limit: vi.fn().mockResolvedValueOnce([mockPlan]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({
                limit: vi.fn().mockResolvedValueOnce(mockPlanPrices),
              }),
            }),
          }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
        transaction: vi.fn((cb) => cb(mockDb)),
      };

      await expect(
        executeStripeCommercialActivation({
          crecheId: 1,
          conditionId: 79,
          prorationMode: ACTIVATION_TIMING_MODES.EFFECTIVE_NOW_PRORATE,
          reason: "Falha intencional de teste Stripe",
          idempotencyKey: "44444444-4444-4444-8444-444444444444",
          dbClient: mockDb,
          stripeClient: mockStripe,
        }),
      ).rejects.toThrow(/Falha na ativação junto ao Stripe/);

      expect(mockDb.update).toHaveBeenCalled();
    });

    it("resumes crash recovery: skips Stripe subscription update when price is already applied", async () => {
      const mockCondition = {
        id: 80,
        crecheId: 1,
        planId: 2,
        pricingOverrideType: "fixed_amount",
        pricingOverrideValue: 19990,
        status: "pending_activation",
        syncStatus: "sync_pending",
        stripePriceId: "price_already_applied_80",
        executionRequirement: "STRIPE_REQUIRED",
      };
      const mockSub = {
        id: 1,
        crecheId: 1,
        planId: 2,
        billingInterval: "month",
        stripeSubscriptionId: "sub_live_123",
      };
      const mockPlan = {
        id: 2,
        name: "Plano Pro",
        priceBrl: 31990,
        stripePriceId: "price_std",
        stripeProductId: "prod_pro_xyz",
      };
      const mockPlanPrices = [
        { id: 1, planId: 2, interval: "month", priceBrl: 31990, stripePriceId: "price_std" },
      ];

      mockStripe.subscriptions.retrieve.mockResolvedValueOnce({
        id: "sub_live_123",
        items: {
          data: [{ id: "si_item_80", price: { id: "price_already_applied_80" } }],
        },
      });

      const updatedConditionRow = { ...mockCondition, status: "active", syncStatus: "synced" };

      const mockDb: any = {
        select: vi
          .fn()
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({
                limit: vi.fn().mockResolvedValueOnce([mockCondition]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({
                limit: vi.fn().mockResolvedValueOnce([mockSub]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({
                limit: vi.fn().mockResolvedValueOnce([mockPlan]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({
                limit: vi.fn().mockResolvedValueOnce(mockPlanPrices),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({
                limit: vi.fn().mockResolvedValueOnce([]),
              }),
            }),
          }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updatedConditionRow]),
            }),
          }),
        }),
        transaction: vi.fn((cb) => cb(mockDb)),
      };

      const result = await executeStripeCommercialActivation({
        crecheId: 1,
        conditionId: 80,
        prorationMode: ACTIVATION_TIMING_MODES.EFFECTIVE_NOW_PRORATE,
        reason: "Recuperação após crash de DB Tx 2",
        idempotencyKey: "55555555-5555-4555-8555-555555555555",
        dbClient: mockDb,
        stripeClient: mockStripe,
      });

      expect(result.success).toBe(true);
      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });

    it("recovers Stripe Price via idempotency key when crash occurs before handle persistence (R36.E1 Section 18)", async () => {
      const mockCondition: any = { id: 85, crecheId: 1, pricingOverrideType: "fixed_amount", pricingOverrideValue: 25000, stripePriceId: null };
      const mockPlan: any = { id: 2, name: "Plano Pro", stripePriceId: "price_std", stripeProductId: "prod_pro_xyz" };

      // On retry, Stripe returns the previously created price for the same key
      mockStripe.prices.create.mockResolvedValueOnce({ id: "price_existing_recovered" });

      const mockDb: any = {
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
      };

      const result = await resolveOrCreateStripePrice({
        condition: mockCondition,
        targetPlan: mockPlan,
        interval: "month",
        effectivePriceCents: 25000,
        catalogPriceCents: 31990,
        standardPriceId: "price_std",
        crecheId: 1,
        stripeClient: mockStripe,
        dbClient: mockDb,
      });

      expect(result.stripePriceId).toBe("price_existing_recovered");
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe("4. Administrative Abandon & Retry Actions (Section 23, 24)", () => {
    it("allows abandoning an activation_failed condition with mandatory reason", async () => {
      const mockFailed = {
        id: 90,
        crecheId: 1,
        status: "activation_failed",
        syncStatus: "sync_failed",
        reason: "Tentativa de acordo falhada",
      };
      const abandonedRow = { ...mockFailed, status: "abandoned" };

      const mockDb: any = {
        select: vi.fn().mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([mockFailed]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValueOnce({
          set: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              returning: vi.fn().mockResolvedValueOnce([abandonedRow]),
            }),
          }),
        }),
        transaction: vi.fn((cb) => cb(mockDb)),
      };

      const result = await abandonCommercialCondition({
        crecheId: 1,
        conditionId: 90,
        reason: "Condição abandonada após descontinuidade da negociação",
        dbClient: mockDb,
      });

      expect(result.success).toBe(true);
      expect(result.condition.status).toBe("abandoned");
    });

    it("rejects abandoning an ACTIVE commercial condition (422 INVALID_STATUS_FOR_ABANDON)", async () => {
      const mockActive = {
        id: 91,
        crecheId: 1,
        status: "active",
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([mockActive]),
            }),
          }),
        }),
      };

      await expect(
        abandonCommercialCondition({
          crecheId: 1,
          conditionId: 91,
          reason: "Tentativa indevida de abandono em ativo",
          dbClient: mockDb,
        }),
      ).rejects.toThrow(/Apenas propostas em rascunho ou com falha podem ser abandonadas/);
    });
  });

  describe("5. Percentage Contract Repricing & Fixed Amount Stability (R36.E1 Section 6, 7, 8, 9, 10, 11)", () => {
    it("executes percentage reprice with amount-scoped step idempotency when catalog changes (Section 9, 10)", async () => {
      const activeCondition = {
        id: 110,
        crecheId: 1,
        planId: 2,
        status: "active",
        syncStatus: "divergent",
        pricingOverrideType: "percentage",
        pricingOverrideValue: 1500, // 15% discount
        snapshotBillingInterval: "month",
        snapshotBasePriceCents: 30000,
        stripePriceId: "price_old_perc",
      };
      const sub = {
        id: 1,
        crecheId: 1,
        planId: 2,
        stripeSubscriptionId: "sub_perc_123",
      };
      const plan = {
        id: 2,
        name: "Plano Pro",
        priceBrl: 35000, // Catalog changed from 30000 to 35000! 15% discount on 35000 = 29750
        stripePriceId: "price_std_pro",
        stripeProductId: "prod_pro_xyz",
      };
      const planPrices = [{ id: 1, planId: 2, interval: "month", priceBrl: 35000, stripePriceId: "price_std_pro" }];

      mockStripe.prices.retrieve.mockResolvedValueOnce({
        id: "price_std_pro",
        product: "prod_pro_xyz",
        currency: "brl",
        recurring: { interval: "month", interval_count: 1 },
      });
      mockStripe.prices.create.mockResolvedValueOnce({ id: "price_new_reprice_29750" });
      mockStripe.subscriptions.retrieve.mockResolvedValueOnce({
        id: "sub_perc_123",
        items: { data: [{ id: "si_perc_1", price: { id: "price_old_perc" } }] },
      });
      mockStripe.subscriptions.update.mockResolvedValueOnce({ id: "sub_perc_123" });

      const mockDb: any = {
        select: vi
          .fn()
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({ limit: vi.fn().mockResolvedValueOnce([activeCondition]) }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({ limit: vi.fn().mockResolvedValueOnce([sub]) }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({ limit: vi.fn().mockResolvedValueOnce([plan]) }),
            }),
          })
          .mockReturnValueOnce({
            from: vi.fn().mockReturnValueOnce({
              where: vi.fn().mockReturnValueOnce({ limit: vi.fn().mockResolvedValueOnce(planPrices) }),
            }),
          }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValueOnce([{ ...activeCondition, stripePriceId: "price_new_reprice_29750", syncStatus: "synced" }]),
            }),
          }),
        }),
      };

      const result = await executePercentageReprice({
        crecheId: 1,
        conditionId: 110,
        reason: "Ajuste após reajuste geral de tabela do catálogo",
        dbClient: mockDb,
        stripeClient: mockStripe,
      });

      expect(result.success).toBe(true);
      expect(result.newStripePriceId).toBe("price_new_reprice_29750");
      expect(result.expectedEffectivePriceCents).toBe(29750);

      // Verify amount-scoped step idempotency keys (Section 10)
      expect(mockStripe.prices.create).toHaveBeenCalledWith(
        expect.objectContaining({ unit_amount: 29750 }),
        { idempotencyKey: "commercial:110:reprice:29750" },
      );
      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
        "sub_perc_123",
        expect.objectContaining({
          items: [{ id: "si_perc_1", price: "price_new_reprice_29750" }],
        }),
        { idempotencyKey: "commercial:110:reprice-sub-item:29750" },
      );
    });

    it("rejects percentage reprice on fixed_amount condition (Section 11)", async () => {
      const fixedCondition = {
        id: 111,
        crecheId: 1,
        status: "active",
        pricingOverrideType: "fixed_amount",
        pricingOverrideValue: 20000,
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({ limit: vi.fn().mockResolvedValueOnce([fixedCondition]) }),
          }),
        }),
      };

      await expect(
        executePercentageReprice({
          crecheId: 1,
          conditionId: 111,
          reason: "Tentativa de reajuste em valor fixo",
          dbClient: mockDb,
          stripeClient: mockStripe,
        }),
      ).rejects.toThrow(/Apenas condições com precificação percentual sofrem reprecificação dinâmica/);
    });
  });

  describe("6. Out-of-Order Webhook Safety & Live Current State (R36.E1 Section 12, 13, 14)", () => {
    it("reads current Stripe state: stale event A does not overwrite newer state from event B", async () => {
      const mockAppSub = {
        id: 5,
        crecheId: 1,
        planId: 2,
        billingInterval: "month",
        stripeSubscriptionId: "sub_100",
        activeConditionId: 10,
        status: "active",
        lastStripeEventAt: new Date(2026, 8, 4, 12, 0, 0),
      };

      // When event A (old price 'price_old') arrives out of order,
      // the handler fetches current live subscription from Stripe, which returns 'price_new_200'!
      const liveSubFromStripe = {
        id: "sub_100",
        status: "active",
        items: {
          data: [{ id: "si_1", price: { id: "price_new_200", unit_amount: 29750 } }],
        },
      };

      mockStripe.subscriptions.retrieve.mockResolvedValueOnce(liveSubFromStripe);

      vi.mocked(db.select)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({ limit: vi.fn().mockResolvedValueOnce([mockAppSub]) }),
          }),
        } as any)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({ limit: vi.fn().mockResolvedValueOnce([]) }), // planVersionPricesTable fallback
          }),
        } as any)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({ limit: vi.fn().mockResolvedValueOnce([{ planId: 2, interval: "month" }]) }),
          }),
        } as any);

      vi.mocked(db.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      } as any);

      const staleEventA = {
        id: "sub_100",
        status: "active",
        items: {
          data: [{ id: "si_1", price: { id: "price_old_100", unit_amount: 25000 } }],
        },
      };

      // Process stale event A with earlier eventCreatedMs
      await handleSubscriptionEvent(
        "customer.subscription.updated",
        staleEventA,
        new Date(2026, 8, 4, 11, 0, 0).getTime(),
        mockStripe,
      );

      // Verify live Stripe retrieve was called to obtain current state
      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_100", {
        expand: ["items.data.price"],
      });
    });
  });

  describe("7. Idempotency Persistence Schema & Metadata Vocabulary (R36.E1 Section 15, 16, 19)", () => {
    it("verifies idempotency persistence is declared on customerCommercialConditionsTable columns", () => {
      // Invariant: No separate invisible table is used; columns exist on canonical schema
      expect(customerCommercialConditionsTable.idempotencyKey).toBeDefined();
      expect(customerCommercialConditionsTable.idempotencyOperation).toBeDefined();
      expect(customerCommercialConditionsTable.requestFingerprint).toBeDefined();
    });

    it("canonical metadata parser handles both canonical and legacy dialects", () => {
      const canonical = parseCommercialMetadata({
        overrideType: "fixed_amount",
        crecheId: "1",
        conditionId: "44",
        effectiveAmountCents: "24990",
      });
      expect(canonical.overrideType).toBe("fixed_amount");
      expect(canonical.crecheId).toBe(1);

      const legacy = parseCommercialMetadata({
        overrideType: "percentage_discount",
        crecheId: "2",
      });
      expect(legacy.overrideType).toBe("percentage");
    });
  });

  describe("8. API Endpoints & Idempotency / Authorization (Section 7, 8, 30)", () => {
    it("rejects non-master_admin role on /activate-condition (403)", async () => {
      const nonAdminApp = express();
      nonAdminApp.use(express.json());
      nonAdminApp.use((req: any, _res, next) => {
        req.user = { id: 2, role: "creche_admin", email: "creche@test.com" };
        next();
      });
      nonAdminApp.use("/api/creches/:crecheId/commercial", commercialRouter);

      const res = await request(nonAdminApp)
        .post("/api/creches/1/commercial/activate-condition")
        .set("X-Idempotency-Key", "00000000-0000-4000-8000-000000000000")
        .send({ conditionId: 1, reason: "Teste" });

      expect(res.status).toBe(403);
    });

    it("rejects activation without X-Idempotency-Key (400)", async () => {
      const res = await request(app)
        .post("/api/creches/1/commercial/activate-condition")
        .send({ conditionId: 1, reason: "Teste" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("idempotency_key_invalid");
    });

    it("rejects activation without mandatory reason (400)", async () => {
      const res = await request(app)
        .post("/api/creches/1/commercial/activate-condition")
        .set("X-Idempotency-Key", "a0000000-0000-4000-8000-000000000000")
        .send({ conditionId: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("reason_required");
    });

    it("detects idempotency conflict when same key is used with altered parameters (409 IDEMPOTENCY_CONFLICT)", async () => {
      const mockExisting = {
        id: 77,
        crecheId: 1,
        idempotencyKey: "b0000000-0000-4000-8000-000000000000",
        idempotencyOperation: "ACTIVATE_PRICE_CONDITION",
        requestFingerprint: "hash_different_parameters",
      };

      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([mockExisting]),
          }),
        }),
      } as any);

      const conflictApp = express();
      conflictApp.use(express.json());
      conflictApp.use((req: any, _res, next) => {
        req.user = { id: 1, role: "master_admin", email: "master@arkpet.com.br" };
        next();
      });
      conflictApp.use("/api/creches/:crecheId/commercial", commercialRouter);

      const res = await request(conflictApp)
        .post("/api/creches/1/commercial/activate-condition")
        .set("X-Idempotency-Key", "b0000000-0000-4000-8000-000000000000")
        .send({ conditionId: 77, reason: "Tentativa com novo motivo" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("IDEMPOTENCY_CONFLICT");
    });
  });
});
