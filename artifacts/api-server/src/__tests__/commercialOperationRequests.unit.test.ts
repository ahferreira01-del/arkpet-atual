import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { commercialRouter, COMMERCIAL_OPERATIONS } from "../routes/commercial.js";
import {
  withCommercialOperationIdempotency,
  computeRequestFingerprint,
  CommercialIdempotencyConflictError,
  CommercialOperationInProgressError,
  CommercialOperationFailedFinalError,
} from "../services/commercialOperationRequests.js";
import { db } from "@workspace/db";
import { customerCommercialConditionsTable } from "@workspace/db/schema";
import { getUncachableStripeClient } from "../lib/stripeClient.js";
import { handleSubscriptionEvent } from "../lib/subscriptionSync.js";
import { countActivePetsForCreche } from "../middlewares/checkPetLimit.js";

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
  logCommercialAudit: vi.fn().mockResolvedValue({ id: 999 }),
  CommercialAuditError: class CommercialAuditError extends Error {},
}));

vi.mock("../middlewares/checkPetLimit.js", () => ({
  countActivePetsForCreche: vi.fn().mockResolvedValue(50),
  checkPetLimit: vi.fn((_req: any, _res: any, next: any) => next()),
}));

describe("R36.E1.1 — Commercial Operation Idempotency & Percentage Sync Final Lock", () => {
  let app: express.Express;
  let mockStripe: any;

  beforeEach(() => {
    vi.resetAllMocks();
    mockStripe = {
      prices: {
        create: vi.fn().mockResolvedValue({
          id: "price_custom_new",
          unit_amount: 29742,
          currency: "brl",
          recurring: { interval: "month", interval_count: 1 },
        }),
        retrieve: vi.fn().mockResolvedValue({
          id: "price_std_pro",
          product: "prod_pro_123",
          currency: "brl",
          unit_amount: 34990,
          recurring: { interval: "month", interval_count: 1 },
        }),
      },
      subscriptions: {
        retrieve: vi.fn().mockResolvedValue({
          id: "sub_stripe_1",
          items: {
            data: [
              {
                id: "si_main",
                price: { id: "price_custom_old", unit_amount: 27192 },
              },
            ],
          },
        }),
        update: vi.fn().mockResolvedValue({ id: "sub_stripe_1" }),
      },
    };
    vi.mocked(getUncachableStripeClient).mockResolvedValue(mockStripe as any);

    app = express();
    app.use(express.json());
    app.use("/api/creches/:crecheId/commercial", commercialRouter);
  });

  describe("1. Operation Ledger Service Engine", () => {
    it("claims fresh request, executes mutation, and saves SUCCEEDED response", async () => {
      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue([{ id: 1 }]),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      };

      const executeFn = vi.fn().mockResolvedValue({
        statusCode: 200,
        data: { message: "ok", token: "secret_should_be_stripped" },
        resourceId: 42,
      });

      const res = await withCommercialOperationIdempotency<{ message: string; token: string }>({
        crecheId: 10,
        operation: "TEST_OP",
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        payload: { foo: "bar" },
        dbClient: mockDb,
        execute: executeFn,
      });

      expect(executeFn).toHaveBeenCalledTimes(1);
      expect(res.replayed).toBe(false);
      expect(res.data.message).toBe("ok");
      expect(mockDb.insert).toHaveBeenCalledTimes(1);
      expect(mockDb.update).toHaveBeenCalledTimes(1);
    });

    it("replays original result when request was already SUCCEEDED (zero re-execution)", async () => {
      const existingPayload = { foo: "bar" };
      const fingerprint = computeRequestFingerprint(existingPayload);

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  id: 1,
                  crecheId: 10,
                  operation: "TEST_OP",
                  idempotencyKey: "11111111-1111-4111-8111-111111111111",
                  requestFingerprint: fingerprint,
                  status: "SUCCEEDED",
                  statusCode: 201,
                  responsePayload: { success: true, originalData: 123 },
                },
              ]),
            }),
          }),
        }),
      };

      const executeFn = vi.fn();
      const res = await withCommercialOperationIdempotency({
        crecheId: 10,
        operation: "TEST_OP",
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        payload: existingPayload,
        dbClient: mockDb,
        execute: executeFn,
      });

      expect(executeFn).not.toHaveBeenCalled();
      expect(res.replayed).toBe(true);
      expect(res.statusCode).toBe(201);
      expect(res.data).toEqual({ success: true, originalData: 123 });
    });

    it("rejects with 409 IDEMPOTENCY_CONFLICT when payload differs for same key", async () => {
      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  id: 1,
                  operation: "TEST_OP",
                  requestFingerprint: "fingerprint_original",
                  status: "SUCCEEDED",
                },
              ]),
            }),
          }),
        }),
      };

      await expect(
        withCommercialOperationIdempotency({
          crecheId: 10,
          operation: "TEST_OP",
          idempotencyKey: "11111111-1111-4111-8111-111111111111",
          payload: { foo: "DIFFERENT_PAYLOAD" },
          dbClient: mockDb,
          execute: vi.fn(),
        }),
      ).rejects.toThrow(CommercialIdempotencyConflictError);
    });

    it("rejects with 409 IDEMPOTENCY_CONFLICT when operation differs for same key", async () => {
      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  id: 1,
                  operation: "FIRST_OP",
                  requestFingerprint: computeRequestFingerprint({ foo: "bar" }),
                  status: "SUCCEEDED",
                },
              ]),
            }),
          }),
        }),
      };

      await expect(
        withCommercialOperationIdempotency({
          crecheId: 10,
          operation: "SECOND_OP",
          idempotencyKey: "11111111-1111-4111-8111-111111111111",
          payload: { foo: "bar" },
          dbClient: mockDb,
          execute: vi.fn(),
        }),
      ).rejects.toThrow(CommercialIdempotencyConflictError);
    });

    it("blocks concurrent in-flight request while lease is fresh (OPERATION_IN_PROGRESS)", async () => {
      const payload = { foo: "bar" };
      const freshLease = new Date(Date.now() + 30_000);

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  id: 1,
                  operation: "TEST_OP",
                  requestFingerprint: computeRequestFingerprint(payload),
                  status: "PROCESSING",
                  leaseExpiresAt: freshLease,
                },
              ]),
            }),
          }),
        }),
      };

      await expect(
        withCommercialOperationIdempotency({
          crecheId: 10,
          operation: "TEST_OP",
          idempotencyKey: "11111111-1111-4111-8111-111111111111",
          payload,
          dbClient: mockDb,
          execute: vi.fn(),
        }),
      ).rejects.toThrow(CommercialOperationInProgressError);
    });

    it("safely reclaims and resumes stale PROCESSING request when lease has expired", async () => {
      const payload = { foo: "bar" };
      const expiredLease = new Date(Date.now() - 5_000);

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  id: 1,
                  operation: "TEST_OP",
                  requestFingerprint: computeRequestFingerprint(payload),
                  status: "PROCESSING",
                  leaseExpiresAt: expiredLease,
                  attemptCount: 1,
                },
              ]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 1, attemptCount: 2 }]),
            }),
          }),
        }),
      };

      const executeFn = vi.fn().mockResolvedValue({
        statusCode: 200,
        data: { resumed: true },
      });

      const res = await withCommercialOperationIdempotency({
        crecheId: 10,
        operation: "TEST_OP",
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        payload,
        dbClient: mockDb,
        execute: executeFn,
      });

      expect(executeFn).toHaveBeenCalledTimes(1);
      expect(res.data).toEqual({ resumed: true });
    });

    it("allows FAILED_RETRYABLE operation to resume under the same request identity", async () => {
      const payload = { foo: "bar" };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  id: 1,
                  operation: "TEST_OP",
                  requestFingerprint: computeRequestFingerprint(payload),
                  status: "FAILED_RETRYABLE",
                  attemptCount: 1,
                },
              ]),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 1, attemptCount: 2 }]),
            }),
          }),
        }),
      };

      const executeFn = vi.fn().mockResolvedValue({
        statusCode: 200,
        data: { recovered: true },
      });

      const res = await withCommercialOperationIdempotency({
        crecheId: 10,
        operation: "TEST_OP",
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
        payload,
        dbClient: mockDb,
        execute: executeFn,
      });

      expect(executeFn).toHaveBeenCalledTimes(1);
      expect(res.data).toEqual({ recovered: true });
    });

    it("terminal replay of FAILED_FINAL prevents re-execution", async () => {
      const payload = { foo: "bar" };

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  id: 1,
                  operation: "TEST_OP",
                  requestFingerprint: computeRequestFingerprint(payload),
                  status: "FAILED_FINAL",
                  statusCode: 422,
                  errorCode: "BUSINESS_VALIDATION_ERROR",
                  errorMessage: "Condição inválida.",
                },
              ]),
            }),
          }),
        }),
      };

      await expect(
        withCommercialOperationIdempotency({
          crecheId: 10,
          operation: "TEST_OP",
          idempotencyKey: "11111111-1111-4111-8111-111111111111",
          payload,
          dbClient: mockDb,
          execute: vi.fn(),
        }),
      ).rejects.toThrow(CommercialOperationFailedFinalError);
    });
  });

  describe("2. Pre-Claim Confirmation Safety (Pet Limit Lowering)", () => {
    it("pet-limit lowering confirmation required returns 409 WITHOUT claiming idempotency key", async () => {
      const key = "22222222-2222-4222-8222-222222222222";

      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      });

      vi.mocked(countActivePetsForCreche).mockResolvedValue(50);

      const res = await request(app)
        .post("/api/creches/1/commercial/pet-limit-override")
        .set("X-Idempotency-Key", key)
        .send({
          entitlementPetLimit: 30,
          reason: "Redução de capacidade",
          confirmLowering: false,
        });

      expect(res.status).toBe(409);
      expect(res.body.confirmationRequired).toBe(true);
      expect(db.insert).not.toHaveBeenCalled();
    });
  });

  describe("3. Multi-Command Lifecycle Replay Survival (Draft -> Activate -> Reprice)", () => {
    it("draft creation key A survives condition activation key B, and replay of A returns draft response", async () => {
      const keyA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const keyB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

      // Replaying draft creation with key A: simulated as SUCCEEDED in commercial_operation_requests
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: 10,
                crecheId: 1,
                operation: COMMERCIAL_OPERATIONS.DRAFT_PRICE_CONDITION,
                idempotencyKey: keyA,
                requestFingerprint: computeRequestFingerprint({
                  crecheId: 1,
                  operation: COMMERCIAL_OPERATIONS.DRAFT_PRICE_CONDITION,
                  targetPlanId: 4,
                  pricingOverrideType: "fixed_amount",
                  pricingOverrideValue: 25000,
                  entitlementPetLimit: null,
                  reason: "Negociação especial",
                }),
                status: "SUCCEEDED",
                statusCode: 201,
                responsePayload: {
                  success: true,
                  condition: { id: 101, status: "draft", pricingOverrideValue: 25000 },
                  message: "Rascunho comercial salvo com sucesso.",
                },
              },
            ]),
          }),
        }),
      });

      const resA = await request(app)
        .post("/api/creches/1/commercial/draft-condition")
        .set("X-Idempotency-Key", keyA)
        .send({
          planId: 4,
          pricingOverrideType: "fixed_amount",
          pricingOverrideValue: 25000,
          reason: "Negociação especial",
        });

      expect(resA.status).toBe(201);
      expect(resA.body.replay).toBe(true);
      expect(resA.body.condition.id).toBe(101);

      // Now replay activation with key B: simulated as SUCCEEDED in commercial_operation_requests
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: 11,
                crecheId: 1,
                operation: COMMERCIAL_OPERATIONS.ACTIVATE_PRICE_CONDITION,
                idempotencyKey: keyB,
                requestFingerprint: computeRequestFingerprint({
                  crecheId: 1,
                  operation: COMMERCIAL_OPERATIONS.ACTIVATE_PRICE_CONDITION,
                  conditionId: 101,
                  prorationMode: "EFFECTIVE_NOW_PRORATE",
                  reason: "Ativação aprovada",
                }),
                status: "SUCCEEDED",
                statusCode: 200,
                responsePayload: {
                  success: true,
                  stripePriceId: "price_custom_101",
                  message: "Condição comercial ativada no Stripe e sincronizada com sucesso.",
                },
              },
            ]),
          }),
        }),
      });

      const resB = await request(app)
        .post("/api/creches/1/commercial/activate-condition")
        .set("X-Idempotency-Key", keyB)
        .send({
          conditionId: 101,
          reason: "Ativação aprovada",
        });

      expect(resB.status).toBe(200);
      expect(resB.body.replay).toBe(true);
      expect(resB.body.stripePriceId).toBe("price_custom_101");
    });

    it("multiple reprices (key C, key D) preserve independent identities without overwriting each other", async () => {
      const keyC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
      const keyD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

      // Replay reprice C
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: 20,
                crecheId: 1,
                operation: COMMERCIAL_OPERATIONS.REPRICE_PERCENTAGE_CONDITION,
                idempotencyKey: keyC,
                requestFingerprint: computeRequestFingerprint({
                  crecheId: 1,
                  operation: COMMERCIAL_OPERATIONS.REPRICE_PERCENTAGE_CONDITION,
                  conditionId: 101,
                  reason: "Reprecificação 1",
                }),
                status: "SUCCEEDED",
                statusCode: 200,
                responsePayload: {
                  success: true,
                  expectedEffectivePriceCents: 28000,
                  newStripePriceId: "price_reprice_c",
                },
              },
            ]),
          }),
        }),
      });

      const resC = await request(app)
        .post("/api/creches/1/commercial/conditions/101/reprice-percentage")
        .set("X-Idempotency-Key", keyC)
        .send({ reason: "Reprecificação 1" });

      expect(resC.status).toBe(200);
      expect(resC.body.replay).toBe(true);
      expect(resC.body.expectedEffectivePriceCents).toBe(28000);

      // Replay reprice D
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: 21,
                crecheId: 1,
                operation: COMMERCIAL_OPERATIONS.REPRICE_PERCENTAGE_CONDITION,
                idempotencyKey: keyD,
                requestFingerprint: computeRequestFingerprint({
                  crecheId: 1,
                  operation: COMMERCIAL_OPERATIONS.REPRICE_PERCENTAGE_CONDITION,
                  conditionId: 101,
                  reason: "Reprecificação 2",
                }),
                status: "SUCCEEDED",
                statusCode: 200,
                responsePayload: {
                  success: true,
                  expectedEffectivePriceCents: 29742,
                  newStripePriceId: "price_reprice_d",
                },
              },
            ]),
          }),
        }),
      });

      const resD = await request(app)
        .post("/api/creches/1/commercial/conditions/101/reprice-percentage")
        .set("X-Idempotency-Key", keyD)
        .send({ reason: "Reprecificação 2" });

      expect(resD.status).toBe(200);
      expect(resD.body.replay).toBe(true);
      expect(resD.body.expectedEffectivePriceCents).toBe(29742);
    });
  });

  describe("4. Percentage Synchronization & Post-Reprice Stability (Section 11, 12, 14, 15)", () => {
    it("detects divergence when current catalog differs from lastSynchronizedAmountCents", async () => {
      // 1. Creche
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, name: "Creche 1", status: "active" }]),
          }),
        }),
      } as any);

      // 2. Subscription
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([
              {
                id: 1,
                crecheId: 1,
                planId: 4,
                billingInterval: "month",
                stripeSubscriptionId: "sub_123",
                activeConditionId: 201,
                status: "active",
              },
            ]),
          }),
        }),
      } as any);

      // 3. Plan
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([
              { id: 4, name: "Pro", priceBrl: 34990, petLimit: 50 },
            ]),
          }),
        }),
      } as any);

      // 4. Plan Prices (empty -> fallback to plan.priceBrl)
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      } as any);

      // 5. Active Condition
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([
              {
                id: 201,
                crecheId: 1,
                status: "active",
                pricingOverrideType: "percentage",
                pricingOverrideValue: 1500,
                snapshotBillingInterval: "month",
                snapshotBasePriceCents: 31990,
                lastSynchronizedAmountCents: 27192,
                syncStatus: "synced",
              },
            ]),
          }),
        }),
      } as any);

      // 6. Latest draft condition
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
      expect(res.body.commercialStripeStatus).toBe("DIVERGENT");
      expect(res.body.percentageRepriceNotice.required).toBe(true);
      expect(res.body.percentageRepriceNotice.actualStripeAmountCents).toBe(27192);
      expect(res.body.percentageRepriceNotice.lastSynchronizedAmountCents).toBe(27192);
      expect(res.body.percentageRepriceNotice.expectedEffectivePriceCents).toBe(29742);
    });

    it("post-reprice stability: returns SYNCHRONIZED when lastSynchronizedAmountCents matches expected amount, even with historical snapshot", async () => {
      // 1. Creche
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, name: "Creche 1", status: "active" }]),
          }),
        }),
      } as any);

      // 2. Subscription
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([
              {
                id: 1,
                crecheId: 1,
                planId: 4,
                billingInterval: "month",
                stripeSubscriptionId: "sub_123",
                activeConditionId: 201,
                status: "active",
              },
            ]),
          }),
        }),
      } as any);

      // 3. Plan
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([
              { id: 4, name: "Pro", priceBrl: 34990, petLimit: 50 },
            ]),
          }),
        }),
      } as any);

      // 4. Plan Prices (empty -> fallback to plan.priceBrl)
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      } as any);

      // 5. Active Condition
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([
              {
                id: 201,
                crecheId: 1,
                status: "active",
                pricingOverrideType: "percentage",
                pricingOverrideValue: 1500,
                snapshotBillingInterval: "month",
                snapshotBasePriceCents: 31990, // historical baseline
                lastSynchronizedAmountCents: 29742, // synchronized with current catalog!
                syncStatus: "synced",
              },
            ]),
          }),
        }),
      } as any);

      // 6. Latest draft condition
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
      expect(res.body.commercialStripeStatus).toBe("SYNCHRONIZED");
      expect(res.body.percentageRepriceNotice).toBeNull();
    });
  });

  describe("5. External Stripe Webhook Safety (Correction #13 & #16)", () => {
    it("webhook with unknown Stripe price marks condition DIVERGENT and preserves lastSynchronizedAmountCents", async () => {
      const conditionSetMock = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      });
      const subscriptionSetMock = vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      const mockDbUpdate = vi.fn((table: any) => {
        if (table === customerCommercialConditionsTable) {
          return { set: conditionSetMock };
        }
        return { set: subscriptionSetMock };
      });
      (db.update as any) = mockDbUpdate;

      const event = {
        id: "evt_unknown_price",
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_stripe_1",
            status: "active",
            customer: "cus_123",
            items: {
              data: [
                {
                  id: "si_1",
                  price: {
                    id: "price_unknown_external",
                    unit_amount: 99999,
                  },
                },
              ],
            },
          },
        },
      };

      mockStripe.subscriptions.retrieve.mockResolvedValueOnce({
        id: "sub_stripe_1",
        status: "active",
        customer: "cus_123",
        items: {
          data: [
            {
              id: "si_1",
              price: {
                id: "price_unknown_external",
                unit_amount: 99999,
              },
            },
          ],
        },
      });

      // 1. findAppSubscription queries subscriptionsTable
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([
              {
                id: 1,
                crecheId: 1,
                activeConditionId: 201,
                billingInterval: "month",
                status: "active",
              },
            ]),
          }),
        }),
      } as any);

      // 2. resolvePlanByPrice queries planPricesTable
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      } as any);

      // 3. resolvePlanByPrice queries plansTable
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      } as any);

      // 4. resolvePlanByPrice queries customerCommercialConditionsTable
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      } as any);

      await handleSubscriptionEvent(
        event.type,
        event.data.object,
        Date.now(),
        mockStripe,
      );

      expect(mockDbUpdate).toHaveBeenCalledWith(customerCommercialConditionsTable);
      expect(conditionSetMock).toHaveBeenCalledTimes(1);
      const setCall = conditionSetMock.mock.calls[0][0];
      expect(setCall.syncStatus).toBe("divergent");
      expect(setCall.lastSynchronizedAmountCents).toBeUndefined();
    });
  });
});
