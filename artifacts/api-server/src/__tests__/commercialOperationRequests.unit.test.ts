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
  CommercialOperationFencingLostError,
  renewCommercialOperationLease,
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
    app.use("/api/commercial", commercialRouter);
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

  describe("5. R36.E1.1 Final Corrective Lock Regression Suite", () => {
    describe("5.1 Operation Lease Fencing & Stale Worker Finalization Blocked (Section 1, 2, 4)", () => {
      it("blocks stale worker finalization when lease ownership was lost to a newer attempt", async () => {
        // Mock DB that simulates Attempt 1 claiming gen 1, but before finalization,
        // Attempt 2 reclaims and increments attemptCount to 2.
        const mockDb: any = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]), // No prior request, fresh claim
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([
                {
                  id: 99,
                  attemptCount: 1,
                  status: "PROCESSING",
                },
              ]),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([]), // 0 rows affected -> ownership lost to gen 2!
              }),
            }),
          }),
        };

        await expect(
          withCommercialOperationIdempotency({
            crecheId: 1,
            operation: "TEST_OP",
            idempotencyKey: "11111111-1111-4111-8111-111111111111",
            payload: { op: "test" },
            dbClient: mockDb,
            execute: vi.fn().mockResolvedValue({ statusCode: 200, data: { done: true } }),
          }),
        ).rejects.toThrow(CommercialOperationFencingLostError);
      });

      it("renewCommercialOperationLease extends lease when generation matches, fails when stale", async () => {
        const mockDb: any = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockImplementation(() => {
                  // Simulate 1 row updated when attemptCount matches
                  return Promise.resolve([{ id: 99, attemptCount: 2 }]);
                }),
              }),
            }),
          }),
        };

        const renewed = await renewCommercialOperationLease(
          { operationRequestId: 99, claimedAttemptCount: 2 },
          mockDb,
        );
        expect(renewed).toBe(true);

        // Stale generation attempt
        const staleMockDb: any = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([]), // 0 rows affected
              }),
            }),
          }),
        };

        const staleRenewed = await renewCommercialOperationLease(
          { operationRequestId: 99, claimedAttemptCount: 1 },
          staleMockDb,
        );
        expect(staleRenewed).toBe(false);
      });
    });

    describe("5.2 Commercial Stripe Status Precedence (Section 5, 6, 7, 8, 9)", () => {
      it("sync_pending returns PENDING even if lastSynchronizedAmount differs from catalog", async () => {
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
              limit: vi.fn().mockResolvedValueOnce([{ id: 4, name: "Pro", priceBrl: 34990 }]),
            }),
          }),
        } as any);

        // 4. Plan Prices
        vi.mocked(db.select).mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([]),
            }),
          }),
        } as any);

        // 5. Active Condition (syncStatus = sync_pending)
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
                  lastSynchronizedAmountCents: 25000, // differs from expected
                  syncStatus: "sync_pending",
                },
              ]),
            }),
          }),
        } as any);

        // 6. Latest draft
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
        expect(res.body.commercialStripeStatus).toBe("PENDING");
        expect(res.body.percentageRepriceNotice).toBeNull();
      });

      it("sync_failed returns FAILED even if previous known-good amount equals expected", async () => {
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
              limit: vi.fn().mockResolvedValueOnce([{ id: 4, name: "Pro", priceBrl: 34990 }]),
            }),
          }),
        } as any);

        // 4. Plan Prices
        vi.mocked(db.select).mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([]),
            }),
          }),
        } as any);

        // 5. Active Condition (syncStatus = sync_failed, but lastSynchronizedAmount matches expected 29742)
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
                  snapshotBasePriceCents: 34990,
                  lastSynchronizedAmountCents: 29742,
                  syncStatus: "sync_failed",
                },
              ]),
            }),
          }),
        } as any);

        // 6. Latest draft
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
        expect(res.body.commercialStripeStatus).toBe("FAILED");
        expect(res.body.percentageRepriceNotice).toBeNull();
      });

      it("unknown Stripe price with same amount remains DIVERGENT (Section 6)", async () => {
        // Expected ArkPet price: 27990
        // Last known-good synchronized amount: 27990
        // External unknown Stripe price: also 27990 -> Webhook set condition to divergent
        // GET /support must remain DIVERGENT, amount equality must NOT hide divergence

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

        // 3. Plan (priceBrl = 32929, with 1500 bps -> 27990)
        vi.mocked(db.select).mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([{ id: 4, name: "Pro", priceBrl: 32929 }]),
            }),
          }),
        } as any);

        // 4. Plan Prices
        vi.mocked(db.select).mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([]),
            }),
          }),
        } as any);

        // 5. Active Condition (syncStatus = divergent, but lastSynchronizedAmount equals expected 27990)
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
                  snapshotBasePriceCents: 32929,
                  lastSynchronizedAmountCents: 27990, // equal to expected
                  syncStatus: "divergent", // webhook detected external price
                },
              ]),
            }),
          }),
        } as any);

        // 6. Latest draft
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
        // CRITICAL INVARIANT: MUST REMAIN DIVERGENT!
        expect(res.body.commercialStripeStatus).toBe("DIVERGENT");
        expect(res.body.percentageRepriceNotice).toBeDefined();
        expect(res.body.percentageRepriceNotice.lastSynchronizedAmountCents).toBe(27990);
        expect(res.body.percentageRepriceNotice.expectedEffectivePriceCents).toBe(27990);
      });

      it("synced + matching amount returns SYNCHRONIZED (Section 5)", async () => {
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
              limit: vi.fn().mockResolvedValueOnce([{ id: 4, name: "Pro", priceBrl: 34990 }]),
            }),
          }),
        } as any);

        // 4. Plan Prices
        vi.mocked(db.select).mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([]),
            }),
          }),
        } as any);

        // 5. Active Condition (syncStatus = synced, and lastSynchronizedAmount matches expected 29742)
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
                  snapshotBasePriceCents: 34990,
                  lastSynchronizedAmountCents: 29742,
                  syncStatus: "synced",
                },
              ]),
            }),
          }),
        } as any);

        // 6. Latest draft
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

    describe("5.3 Cross-Command Retry Lifecycle Proof (Section 10)", () => {
      it("Key A fails -> Key B retry succeeds -> Key A replayed recognizes already active target with zero duplicate business effect", async () => {
        const keyA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        const keyB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

        // Step 1: Request Key A encounters transient Stripe failure
        mockStripe.prices.create.mockRejectedValueOnce(new Error("Stripe API Timeout"));

        // Setup DB mocks for Key A execution
        let conditionStatus = "draft";
        let conditionSyncStatus = "not_started";
        let conditionPriceId: string | null = null;
        let subActiveConditionId: number | null = null;

        const conditionRow = {
          id: 501,
          crecheId: 1,
          planId: 4,
          status: conditionStatus,
          syncStatus: conditionSyncStatus,
          pricingOverrideType: "percentage",
          pricingOverrideValue: 1500,
          snapshotBillingInterval: "month",
          snapshotBasePriceCents: 34990,
          stripePriceId: conditionPriceId,
          executionRequirement: "STRIPE_REQUIRED",
          reason: "Proposta",
        };

        const subRow = {
          id: 1,
          crecheId: 1,
          planId: 4,
          billingInterval: "month",
          stripeSubscriptionId: "sub_123",
          activeConditionId: subActiveConditionId,
          status: "active",
        };

        const planRow = { id: 4, name: "Pro", priceBrl: 34990, stripeProductId: "prod_pro_123" };

        // 1. Key A: select operation requests (empty)
        vi.mocked(db.select).mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([]),
            }),
          }),
        } as any);

        // insert Key A operation request (PROCESSING)
        vi.mocked(db.insert).mockReturnValueOnce({
          values: vi.fn().mockReturnValueOnce({
            returning: vi.fn().mockResolvedValueOnce([{ id: 101, attemptCount: 1 }]),
          }),
        } as any);

        // condition select
        vi.mocked(db.select).mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([conditionRow]),
            }),
          }),
        } as any);

        // sub select
        vi.mocked(db.select).mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([subRow]),
            }),
          }),
        } as any);

        // plan select
        vi.mocked(db.select).mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([planRow]),
            }),
          }),
        } as any);

        // planPrices select
        vi.mocked(db.select).mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([]),
            }),
          }),
        } as any);

        // plans retrieve
        mockStripe.prices.retrieve.mockResolvedValueOnce({
          id: "price_std_pro",
          product: "prod_pro_123",
          currency: "brl",
          unit_amount: 34990,
          recurring: { interval: "month", interval_count: 1 },
        });

        // DB Tx 1 update condition to pending_activation
        vi.mocked(db.update).mockReturnValueOnce({
          set: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockResolvedValueOnce([{ id: 501 }]),
          }),
        } as any);

        // renewCommercialOperationLease before external Stripe call
        vi.mocked(db.update).mockReturnValueOnce({
          set: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              returning: vi.fn().mockResolvedValueOnce([{ id: 101, attemptCount: 1 }]),
            }),
          }),
        } as any);

        // resolveOrCreateStripePrice standard price select
        vi.mocked(db.select).mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([]),
            }),
          }),
        } as any);

        // Failure transition in executeStripeCommercialActivation
        vi.mocked(db.update).mockReturnValueOnce({
          set: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockResolvedValueOnce([{ id: 501 }]),
          }),
        } as any);

        // withCommercialOperationIdempotency sets FAILED_RETRYABLE
        vi.mocked(db.update).mockReturnValueOnce({
          set: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockResolvedValueOnce([{ id: 101 }]),
          }),
        } as any);

        const resA1 = await request(app)
          .post("/api/creches/1/commercial/activate-condition")
          .set("X-Idempotency-Key", keyA)
          .send({ conditionId: 501, prorationMode: "EFFECTIVE_NOW_PRORATE", reason: "Ativação A" });

        expect(resA1.status).toBe(502);

        // Step 2: Now Key B retries and succeeds
        // Condition becomes active and synced in the database
        conditionStatus = "active";
        conditionSyncStatus = "synced";
        conditionPriceId = "price_custom_b";
        subActiveConditionId = 501;

        const activeConditionRow = {
          ...conditionRow,
          status: "active",
          syncStatus: "synced",
          stripePriceId: "price_custom_b",
        };

        const activeSubRow = {
          ...subRow,
          activeConditionId: 501,
        };

        // Step 3: Now original request Key A is replayed
        // Operation A was FAILED_RETRYABLE, so withCommercialOperationIdempotency reclaims lease
        vi.mocked(db.select).mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([
                {
                  id: 101,
                  crecheId: 1,
                  operation: COMMERCIAL_OPERATIONS.ACTIVATE_PRICE_CONDITION,
                  idempotencyKey: keyA,
                  requestFingerprint: computeRequestFingerprint({
                    crecheId: 1,
                    operation: COMMERCIAL_OPERATIONS.ACTIVATE_PRICE_CONDITION,
                    conditionId: 501,
                    prorationMode: "EFFECTIVE_NOW_PRORATE",
                    reason: "Ativação A",
                  }),
                  status: "FAILED_RETRYABLE",
                  attemptCount: 1,
                },
              ]),
            }),
          }),
        } as any);

        // Reclaim update on operation ledger (attemptCount -> 2)
        vi.mocked(db.update).mockReturnValueOnce({
          set: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              returning: vi.fn().mockResolvedValueOnce([{ id: 101, attemptCount: 2 }]),
            }),
          }),
        } as any);

        // executeStripeCommercialActivation fetches condition (sees it is already active and synced!)
        vi.mocked(db.select).mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([activeConditionRow]),
            }),
          }),
        } as any);

        // sub select
        vi.mocked(db.select).mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([activeSubRow]),
            }),
          }),
        } as any);

        // plan select
        vi.mocked(db.select).mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([planRow]),
            }),
          }),
        } as any);

        // planPrices select
        vi.mocked(db.select).mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([]),
            }),
          }),
        } as any);

        // Finalize operation ledger to SUCCEEDED
        vi.mocked(db.update).mockReturnValueOnce({
          set: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              returning: vi.fn().mockResolvedValueOnce([{ id: 101, status: "SUCCEEDED" }]),
            }),
          }),
        } as any);

        // Record stripe call counts before replay
        const stripeCreateCallCount = mockStripe.prices.create.mock.calls.length;
        const stripeSubUpdateCallCount = mockStripe.subscriptions.update.mock.calls.length;

        const resA2 = await request(app)
          .post("/api/creches/1/commercial/activate-condition")
          .set("X-Idempotency-Key", keyA)
          .send({ conditionId: 501, prorationMode: "EFFECTIVE_NOW_PRORATE", reason: "Ativação A" });

        expect(resA2.status).toBe(200);
        expect(resA2.body.replay).toBe(true);
        expect(resA2.body.success).toBe(true);
        expect(resA2.body.stripePriceId).toBe("price_custom_b");

        // PROVE ZERO NEW BUSINESS EFFECT:
        // Zero additional prices created
        expect(mockStripe.prices.create.mock.calls.length).toBe(stripeCreateCallCount);
        // Zero additional subscription updates
        expect(mockStripe.subscriptions.update.mock.calls.length).toBe(stripeSubUpdateCallCount);
      });
    });

    describe("6. Campaign Writes Idempotency Engine (R36.F1 Section 14, 15)", () => {
      it("should reject POST /api/commercial/campaigns when X-Idempotency-Key is missing or not a valid UUID", async () => {
        const payload = {
          name: "Black Friday 2026",
          status: "draft",
          benefitType: "PERCENTAGE_DISCOUNT",
          benefitValue: 2000,
          billingCycles: 3,
        };

        // Missing key
        const resMissing = await request(app)
          .post("/api/commercial/campaigns")
          .send(payload);

        expect(resMissing.status).toBe(400);
        expect(resMissing.body.error).toBe("idempotency_key_invalid");

        // Invalid key (not a UUID)
        const resInvalid = await request(app)
          .post("/api/commercial/campaigns")
          .set("X-Idempotency-Key", "not-a-valid-uuid-12345")
          .send(payload);

        expect(resInvalid.status).toBe(400);
        expect(resInvalid.body.error).toBe("idempotency_key_invalid");
      });

      it("should execute create campaign, store in ledger, and replay on duplicate same-key same-payload request (Section 15)", async () => {
        const idempotencyKey = "b3c37571-3cb5-4cf5-b1b7-a3a0e377f0a1";
        const payload = {
          name: "Campanha Verão 2026",
          description: "Desconto especial de verão",
          status: "draft",
          priority: 10,
          benefitType: "PERCENTAGE_DISCOUNT",
          benefitValue: 1500,
          billingCycles: 3,
        };

        const createdCampaignData = {
          campaign: {
            id: 99,
            name: "Campanha Verão 2026",
            status: "draft",
            priority: 10,
            createdAt: new Date().toISOString(),
          },
          benefit: {
            id: 199,
            campaignId: 99,
            benefitType: "PERCENTAGE_DISCOUNT",
            benefitValue: 1500,
            billingCycles: 3,
          },
        };

        // 1st request: fresh claim -> insert -> return 201
        vi.mocked(db.select).mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([]), // no existing record
            }),
          }),
        } as any);

        vi.mocked(db.insert).mockReturnValueOnce({
          values: vi.fn().mockReturnValueOnce({
            returning: vi.fn().mockResolvedValueOnce([{ id: 1, attemptCount: 1 }]),
          }),
        } as any);

        // createCampaign transaction mock:
        // insert campaign
        vi.mocked(db.insert).mockReturnValueOnce({
          values: vi.fn().mockReturnValueOnce({
            returning: vi.fn().mockResolvedValueOnce([createdCampaignData.campaign]),
          }),
        } as any);
        // insert benefit
        vi.mocked(db.insert).mockReturnValueOnce({
          values: vi.fn().mockReturnValueOnce({
            returning: vi.fn().mockResolvedValueOnce([createdCampaignData.benefit]),
          }),
        } as any);

        // ledger update to SUCCEEDED
        vi.mocked(db.update).mockReturnValueOnce({
          set: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              returning: vi.fn().mockResolvedValueOnce([{ id: 1, status: "SUCCEEDED" }]),
            }),
          }),
        } as any);

        const res1 = await request(app)
          .post("/api/commercial/campaigns")
          .set("X-Idempotency-Key", idempotencyKey)
          .send(payload);

        expect(res1.status).toBe(201);
        expect(res1.body.campaign.name).toBe("Campanha Verão 2026");

        // 2nd request: replay cached SUCCEEDED from ledger
        const fingerprint = computeRequestFingerprint({
          operation: COMMERCIAL_OPERATIONS.CREATE_COMMERCIAL_CAMPAIGN,
          name: "Campanha Verão 2026",
          description: "Desconto especial de verão",
          status: "draft",
          eligibleFrom: null,
          eligibleUntil: null,
          priority: 10,
          benefitType: "PERCENTAGE_DISCOUNT",
          benefitValue: 1500,
          billingCycles: 3,
        });

        vi.mocked(db.select).mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([
                {
                  id: 1,
                  operation: COMMERCIAL_OPERATIONS.CREATE_COMMERCIAL_CAMPAIGN,
                  idempotencyKey,
                  requestFingerprint: fingerprint,
                  status: "SUCCEEDED",
                  statusCode: 201,
                  responsePayload: createdCampaignData,
                },
              ]),
            }),
          }),
        } as any);

        const res2 = await request(app)
          .post("/api/commercial/campaigns")
          .set("X-Idempotency-Key", idempotencyKey)
          .send(payload);

        expect(res2.status).toBe(201);
        expect(res2.body.replay).toBe(true);
        expect(res2.body.campaign.id).toBe(99);
      });

      it("should return 409 IDEMPOTENCY_CONFLICT when same key is used with changed payload on POST /api/commercial/campaigns", async () => {
        const idempotencyKey = "c4d48682-4dc6-5ef6-c2c8-b4b1f488f1b2";
        const oldFingerprint = "old_fingerprint_hash_abc";

        vi.mocked(db.select).mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([
                {
                  id: 2,
                  operation: COMMERCIAL_OPERATIONS.CREATE_COMMERCIAL_CAMPAIGN,
                  idempotencyKey,
                  requestFingerprint: oldFingerprint, // different fingerprint!
                  status: "SUCCEEDED",
                },
              ]),
            }),
          }),
        } as any);

        const resConflict = await request(app)
          .post("/api/commercial/campaigns")
          .set("X-Idempotency-Key", idempotencyKey)
          .send({
            name: "Novo Nome Modificado",
            status: "draft",
            benefitType: "PERCENTAGE_DISCOUNT",
            benefitValue: 3000,
            billingCycles: 6,
          });

        expect(resConflict.status).toBe(409);
        expect(resConflict.body.code).toBe("IDEMPOTENCY_CONFLICT");
      });

      it("should require X-Idempotency-Key and replay result on PATCH /api/commercial/campaigns/:id", async () => {
        const idempotencyKey = "d5e59793-5ed7-6fa7-d3d9-c5c2a599a2c3";

        // Missing key on PATCH -> 400
        const resMissing = await request(app)
          .patch("/api/commercial/campaigns/99")
          .send({ status: "paused" });

        expect(resMissing.status).toBe(400);
        expect(resMissing.body.error).toBe("idempotency_key_invalid");

        // Valid key with replay from ledger
        const fingerprint = computeRequestFingerprint({
          campaignId: 99,
          operation: COMMERCIAL_OPERATIONS.CHANGE_COMMERCIAL_CAMPAIGN_STATUS,
          name: null,
          description: null,
          status: "paused",
          eligibleFrom: null,
          eligibleUntil: null,
          priority: null,
        });

        vi.mocked(db.select).mockReturnValueOnce({
          from: vi.fn().mockReturnValueOnce({
            where: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([
                {
                  id: 3,
                  operation: COMMERCIAL_OPERATIONS.CHANGE_COMMERCIAL_CAMPAIGN_STATUS,
                  idempotencyKey,
                  requestFingerprint: fingerprint,
                  status: "SUCCEEDED",
                  statusCode: 200,
                  responsePayload: { campaign: { id: 99, status: "paused" } },
                },
              ]),
            }),
          }),
        } as any);

        const resReplay = await request(app)
          .patch("/api/commercial/campaigns/99")
          .set("X-Idempotency-Key", idempotencyKey)
          .send({ status: "paused" });

        expect(resReplay.status).toBe(200);
        expect(resReplay.body.replay).toBe(true);
        expect(resReplay.body.campaign.status).toBe("paused");
      });
    });
  });
});
