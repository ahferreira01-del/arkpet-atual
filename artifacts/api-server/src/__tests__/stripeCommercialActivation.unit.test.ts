import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { commercialRouter } from "../routes/commercial.js";
import {
  executeStripeCommercialActivation,
  retryStripeCommercialActivation,
  abandonCommercialCondition,
  identifySubscriptionItem,
  resolveOrCreateStripePrice,
  ACTIVATION_TIMING_MODES,
  CommercialActivationError,
} from "../services/stripeCommercialActivation.js";
import { resolvePlanByPrice, applyStripeEvent } from "../lib/subscriptionSync.js";
import { db } from "@workspace/db";
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

describe("R36.E — Stripe Commercial Activation & Gateway Reconciliation Unit Tests", () => {
  let app: express.Express;
  let mockStripe: any;

  beforeEach(() => {
    vi.resetAllMocks();
    mockStripe = {
      prices: {
        create: vi.fn(),
        retrieve: vi.fn(),
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
        /sem itens recorrentes cadastrados/i,
      );
    });

    it("fails closed with AMBIGUOUS_SUBSCRIPTION_ITEMS if multiple items exist and cannot be uniquely matched", () => {
      const stripeSub: any = {
        id: "sub_123",
        items: {
          data: [
            { id: "si_1", price: { id: "price_1", product: "prod_a" } },
            { id: "si_2", price: { id: "price_2", product: "prod_b" } },
          ],
        },
      };

      expect(() => identifySubscriptionItem(stripeSub, "prod_unknown")).toThrow(
        CommercialActivationError,
      );
    });
  });

  describe("2. Standard vs Custom Price Resolution (Section 13, 14, 15, 16)", () => {
    it("reuses standard Stripe Price when override is 'none' (standard price reversion)", async () => {
      const mockCondition: any = {
        id: 10,
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
  });

  describe("3. Two-Phase Orchestration & Stripe Activation (Section 18, 19, 20, 21)", () => {
    it("fails closed when subscription has no stripeSubscriptionId (STRIPE_RECURRING_SUBSCRIPTION_REQUIRED)", async () => {
      const mockCondition = {
        id: 10,
        crecheId: 1,
        status: "draft",
        executionRequirement: "STRIPE_REQUIRED",
      };
      const mockSub = {
        id: 1,
        crecheId: 1,
        stripeSubscriptionId: null,
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
          conditionId: 10,
          prorationMode: ACTIVATION_TIMING_MODES.EFFECTIVE_NOW_PRORATE,
          reason: "Acordo comercial homologado",
          idempotencyKey: "11111111-1111-4111-8111-111111111111",
          dbClient: mockDb,
          stripeClient: mockStripe,
        }),
      ).rejects.toThrow("Esta conta não possui uma assinatura recorrente Stripe vinculada");
    });

    it("executes two-phase activation successfully for fixed custom price with always_invoice proration", async () => {
      const mockCondition = {
        id: 77,
        crecheId: 1,
        planId: 2,
        pricingOverrideType: "fixed_amount",
        pricingOverrideValue: 19990,
        snapshotBillingInterval: "month",
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
        stripeProductId: "prod_pro_xyz",
      };
      const mockPlanPrices = [
        { id: 1, planId: 2, interval: "month", priceBrl: 31990, stripePriceId: "price_std" },
      ];

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
        pricingOverrideValue: 20000,
        snapshotBillingInterval: "month",
        status: "draft",
        executionRequirement: "STRIPE_REQUIRED",
      };
      const mockSub = {
        id: 1,
        crecheId: 1,
        planId: 2,
        billingInterval: "month",
        stripeSubscriptionId: "sub_noprorate_123",
      };
      const mockPlan = { id: 2, name: "Plano Pro", priceBrl: 31990, stripeProductId: "prod_pro" };

      mockStripe.prices.create.mockResolvedValueOnce({ id: "price_custom_78" });
      mockStripe.subscriptions.retrieve.mockResolvedValueOnce({
        id: "sub_noprorate_123",
        items: { data: [{ id: "si_noprorate", price: { id: "price_old", product: "prod_pro" } }] },
      });
      mockStripe.subscriptions.update.mockResolvedValueOnce({ id: "sub_noprorate_123" });

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
                limit: vi.fn().mockResolvedValueOnce([{ priceBrl: 31990 }]),
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
              returning: vi.fn().mockResolvedValue([{ id: 78, status: "active" }]),
            }),
          }),
        }),
        transaction: vi.fn((cb) => cb(mockDb)),
      };

      await executeStripeCommercialActivation({
        crecheId: 1,
        conditionId: 78,
        prorationMode: ACTIVATION_TIMING_MODES.EFFECTIVE_NOW_NO_PRORATION,
        reason: "Sem rateio no ciclo atual",
        idempotencyKey: "33333333-3333-4333-8333-333333333333",
        dbClient: mockDb,
        stripeClient: mockStripe,
      });

      expect(mockStripe.subscriptions.update).toHaveBeenCalledWith(
        "sub_noprorate_123",
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
        pricingOverrideValue: 15000,
        snapshotBillingInterval: "month",
        status: "draft",
        executionRequirement: "STRIPE_REQUIRED",
      };
      const mockSub = {
        id: 1,
        crecheId: 1,
        planId: 2,
        billingInterval: "month",
        stripeSubscriptionId: "sub_err_123",
        activeConditionId: 20,
      };
      const mockPlan = { id: 2, name: "Plano Pro", priceBrl: 31990, stripeProductId: "prod_pro" };

      mockStripe.prices.create.mockResolvedValueOnce({ id: "price_custom_79" });
      mockStripe.subscriptions.retrieve.mockRejectedValueOnce(
        new Error("Stripe rate limit exceeded (429)"),
      );

      let failureStatusUpdated = false;
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
                limit: vi.fn().mockResolvedValueOnce([{ priceBrl: 31990 }]),
              }),
            }),
          }),
        update: vi.fn().mockImplementation(() => ({
          set: vi.fn().mockImplementation((payload) => {
            if (payload.status === "activation_failed" && payload.syncStatus === "sync_failed") {
              failureStatusUpdated = true;
            }
            return {
              where: vi.fn().mockResolvedValue([]),
            };
          }),
        })),
        transaction: vi.fn((cb) => cb(mockDb)),
      };

      await expect(
        executeStripeCommercialActivation({
          crecheId: 1,
          conditionId: 79,
          prorationMode: ACTIVATION_TIMING_MODES.EFFECTIVE_NOW_PRORATE,
          reason: "Falha de rede simulada",
          idempotencyKey: "44444444-4444-4444-8444-444444444444",
          dbClient: mockDb,
          stripeClient: mockStripe,
        }),
      ).rejects.toThrow("Falha na ativação junto ao Stripe");

      expect(failureStatusUpdated).toBe(true);
      expect(mockSub.activeConditionId).toBe(20);
    });

    it("resumes crash recovery: skips Stripe subscription update when price is already applied", async () => {
      const mockCondition = {
        id: 80,
        crecheId: 1,
        planId: 2,
        pricingOverrideType: "fixed_amount",
        pricingOverrideValue: 21000,
        stripePriceId: "price_already_created_80",
        snapshotBillingInterval: "month",
        status: "pending_activation",
        executionRequirement: "STRIPE_REQUIRED",
      };
      const mockSub = {
        id: 1,
        crecheId: 1,
        planId: 2,
        billingInterval: "month",
        stripeSubscriptionId: "sub_crash_123",
      };
      const mockPlan = { id: 2, name: "Plano Pro", priceBrl: 31990, stripeProductId: "prod_pro" };

      mockStripe.subscriptions.retrieve.mockResolvedValueOnce({
        id: "sub_crash_123",
        items: {
          data: [
            {
              id: "si_already_updated",
              price: { id: "price_already_created_80", product: "prod_pro" },
            },
          ],
        },
      });

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
                limit: vi.fn().mockResolvedValueOnce([{ priceBrl: 31990 }]),
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
              returning: vi.fn().mockResolvedValue([{ id: 80, status: "active" }]),
            }),
          }),
        }),
        transaction: vi.fn((cb) => cb(mockDb)),
      };

      const result = await executeStripeCommercialActivation({
        crecheId: 1,
        conditionId: 80,
        prorationMode: ACTIVATION_TIMING_MODES.EFFECTIVE_NOW_PRORATE,
        reason: "Recuperação após crash de banco",
        idempotencyKey: "55555555-5555-4555-8555-555555555555",
        dbClient: mockDb,
        stripeClient: mockStripe,
      });

      expect(result.success).toBe(true);
      expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
    });
  });

  describe("4. Administrative Abandon & Retry Actions (Section 23, 24)", () => {
    it("allows abandoning an activation_failed condition with mandatory reason", async () => {
      const mockCondition = {
        id: 90,
        crecheId: 1,
        status: "activation_failed",
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([mockCondition]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValueOnce({
          set: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              returning: vi.fn().mockResolvedValueOnce([{ ...mockCondition, status: "abandoned" }]),
            }),
          }),
        }),
      };

      const result = await abandonCommercialCondition({
        crecheId: 1,
        conditionId: 90,
        reason: "Cliente desistiu da contratação com valor personalizado",
        dbClient: mockDb,
      });

      expect(result.success).toBe(true);
      expect(result.condition.status).toBe("abandoned");
    });

    it("rejects abandoning an ACTIVE commercial condition (422 INVALID_STATUS_FOR_ABANDON)", async () => {
      const mockCondition = {
        id: 91,
        crecheId: 1,
        status: "active",
      };

      const mockDb: any = {
        select: vi.fn().mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([mockCondition]),
            }),
          }),
        }),
      };

      await expect(
        abandonCommercialCondition({
          crecheId: 1,
          conditionId: 91,
          reason: "Tentativa indevida",
          dbClient: mockDb,
        }),
      ).rejects.toThrow("Apenas propostas em rascunho ou com falha podem ser abandonadas");
    });
  });

  describe("5. Webhook Custom Price Reconciliation & Divergence Detection (Section 25, 26, 27)", () => {
    it("resolves custom Stripe price from customerCommercialConditionsTable without catalog error", async () => {
      vi.mocked(db.select)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([]),
            }),
          }),
        } as any)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([]),
            }),
          }),
        } as any)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([
                {
                  id: 105,
                  planId: 2,
                  snapshotBillingInterval: "quarter",
                  stripePriceId: "price_custom_r36_abc",
                },
              ]),
            }),
          }),
        } as any);

      const resolved = await resolvePlanByPrice("price_custom_r36_abc");
      expect(resolved).not.toBeNull();
      expect(resolved?.planId).toBe(2);
      expect(resolved?.interval).toBe("quarter");
      expect(resolved?.isCustom).toBe(true);
      expect(resolved?.conditionId).toBe(105);
    });

    it("marks commercial state DIVERGENT when subscription updated with completely unknown price", async () => {
      const mockAppSub = {
        id: 10,
        crecheId: 1,
        planId: 2,
        activeConditionId: 99,
        status: "active",
        stripeSubscriptionId: "sub_external_change",
        stripeCustomerId: "cus_1",
      };

      vi.mocked(db.select)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([mockAppSub]),
            }),
          }),
        } as any)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([]),
            }),
          }),
        } as any)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([]),
            }),
          }),
        } as any)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([]),
            }),
          }),
        } as any);

      let markedDivergent = false;
      vi.mocked(db.update).mockImplementation(() => ({
        set: vi.fn().mockImplementation((payload) => {
          if (payload.syncStatus === "divergent") {
            markedDivergent = true;
          }
          return {
            where: vi.fn().mockResolvedValue([]),
          };
        }),
      }) as any);

      await applyStripeEvent({
        type: "customer.subscription.updated",
        created: 1700000000,
        data: {
          object: {
            id: "sub_external_change",
            customer: "cus_1",
            status: "active",
            items: {
              data: [{ id: "si_1", price: { id: "price_unknown_foreign_price" } }],
            },
          },
        },
      });

      expect(markedDivergent).toBe(true);
    });
  });

  describe("6. API Endpoints & Idempotency / Authorization (Section 7, 8, 30)", () => {
    it("rejects non-master_admin role on /activate-condition (403)", async () => {
      const nonMasterApp = express();
      nonMasterApp.use(express.json());
      nonMasterApp.use((req: any, _res, next) => {
        req.user = { id: 2, role: "creche_admin" };
        next();
      });
      nonMasterApp.use("/api/creches/:crecheId/commercial", commercialRouter);

      const res = await request(nonMasterApp)
        .post("/api/creches/1/commercial/activate-condition")
        .set("X-Idempotency-Key", "66666666-6666-4666-8666-666666666666")
        .send({
          conditionId: 1,
          reason: "Tentativa de admin local",
        });

      expect(res.status).toBe(403);
    });

    it("rejects activation without X-Idempotency-Key (400)", async () => {
      const res = await request(app)
        .post("/api/creches/1/commercial/activate-condition")
        .send({
          conditionId: 1,
          reason: "Sem chave de idempotência",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("idempotency_key_invalid");
    });

    it("rejects activation without mandatory reason (400)", async () => {
      const res = await request(app)
        .post("/api/creches/1/commercial/activate-condition")
        .set("X-Idempotency-Key", "77777777-7777-4777-8777-777777777777")
        .send({
          conditionId: 1,
          reason: "   ",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("reason_required");
    });

    it("detects idempotency conflict when same key is used with altered parameters (409 IDEMPOTENCY_CONFLICT)", async () => {
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([
              {
                id: 1,
                idempotencyKey: "88888888-8888-4888-8888-888888888888",
                idempotencyOperation: "ACTIVATE_PRICE_CONDITION",
                requestFingerprint: "fingerprint_original_different",
              },
            ]),
          }),
        }),
      } as any);

      const res = await request(app)
        .post("/api/creches/1/commercial/activate-condition")
        .set("X-Idempotency-Key", "88888888-8888-4888-8888-888888888888")
        .send({
          conditionId: 1,
          reason: "Nova razão diferente",
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("IDEMPOTENCY_CONFLICT");
    });

    it("replays existing execution when same key and payload are submitted", async () => {
      const conditionId = 25;
      const prorationMode = "EFFECTIVE_NOW_PRORATE";
      const reason = "Acordo idêntico";

      const crypto = await import("crypto");
      const payload = {
        crecheId: 1,
        operation: "ACTIVATE_PRICE_CONDITION",
        conditionId,
        prorationMode,
        reason,
      };
      const normalized = JSON.stringify(payload, Object.keys(payload).sort());
      const expectedFingerprint = crypto.createHash("sha256").update(normalized).digest("hex");

      const existingCondition = {
        id: 25,
        crecheId: 1,
        status: "active",
        syncStatus: "synced",
        idempotencyKey: "99999999-9999-4999-8999-999999999999",
        idempotencyOperation: "ACTIVATE_PRICE_CONDITION",
        requestFingerprint: expectedFingerprint,
      };

      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([existingCondition]),
          }),
        }),
      } as any);

      const res = await request(app)
        .post("/api/creches/1/commercial/activate-condition")
        .set("X-Idempotency-Key", "99999999-9999-4999-8999-999999999999")
        .send({
          conditionId,
          prorationMode,
          reason,
        });

      expect(res.status).toBe(200);
      expect(res.body.replay).toBe(true);
      expect(res.body.condition.id).toBe(25);
    });
  });
});
