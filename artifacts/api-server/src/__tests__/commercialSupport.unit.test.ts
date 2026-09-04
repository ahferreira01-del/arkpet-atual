import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { commercialRouter } from "../routes/commercial.js";
import { db } from "@workspace/db";
import { customerCommercialConditionsTable } from "@workspace/db/schema";

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
    // Default auth mock, can be overridden per test
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

describe("Commercial Support Console & Overrides Unit Tests (R36.D)", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(db.update).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({}),
      }),
    } as any);
    app = express();
    app.use(express.json());
    app.use("/api/creches/:crecheId/commercial", commercialRouter);
  });

  describe("1. Authorization Gate (Correction 11)", () => {
    it("rejects non-master_admin roles (creche_admin -> 403, staff -> 403)", async () => {
      const testApp = express();
      testApp.use(express.json());
      testApp.use((req: any, _res, next) => {
        req.user = { id: 2, role: "creche_admin", email: "creche@test.com" };
        next();
      });
      testApp.use("/api/creches/:crecheId/commercial", commercialRouter);

      const resCrecheAdmin = await request(testApp).get("/api/creches/1/commercial/support");
      expect(resCrecheAdmin.status).toBe(403);
      expect(resCrecheAdmin.body.error).toBe("Sem permissão");

      const staffApp = express();
      staffApp.use(express.json());
      staffApp.use((req: any, _res, next) => {
        req.user = { id: 3, role: "staff", email: "staff@test.com" };
        next();
      });
      staffApp.use("/api/creches/:crecheId/commercial", commercialRouter);

      const resStaff = await request(staffApp).get("/api/creches/1/commercial/support");
      expect(resStaff.status).toBe(403);
    });
  });

  describe("2. Commercial Read Model (Section 10, 11 & Correction 8, 9)", () => {
    it("returns NOT_PROVISIONED state when creche has no subscription record", async () => {
      // Creche query returns creche
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, name: "Creche Alpha", status: "active" }]),
          }),
        }),
      } as any);

      // Subscription query returns empty
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      } as any);

      // Active pets query
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([{ total: 5 }]),
        }),
      } as any);

      // Latest draft condition query
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
      expect(res.body.subscriptionState).toBe("NOT_PROVISIONED");
      expect(res.body.subscription).toBeNull();
      expect(res.body.plan).toBeNull();
      expect(res.body.limits.activePetCount).toBe(5);
    });

    it("returns provisioned subscription with active condition, effective price, and separate draft visibility", async () => {
      // 1. Creche
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, name: "Creche Beta", status: "active" }]),
          }),
        }),
      } as any);

      // 2. Subscription with activeConditionId = 50
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([
              {
                id: 10,
                status: "active",
                planId: 2,
                billingInterval: "monthly",
                stripeCustomerId: "cus_123",
                stripeSubscriptionId: "sub_123",
                activeConditionId: 50,
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
              { id: 2, name: "Plano Pro", slug: "pro", priceBrl: 31990, petLimit: 30 },
            ]),
          }),
        }),
      } as any);

      // 3b. Plan Prices query for active plan
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      } as any);

      // 4. Active pets = 12
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([{ total: 12 }]),
        }),
      } as any);

      // 5. Active condition
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([
              {
                id: 50,
                crecheId: 1,
                status: "active",
                pricingOverrideType: "percentage",
                pricingOverrideValue: 1500, // 15%
                entitlementPetLimit: 40,
              },
            ]),
          }),
        }),
      } as any);

      // 6. Latest draft condition (Correction 8: draft price is separate from active price)
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            orderBy: vi.fn().mockReturnValueOnce({
              limit: vi.fn().mockResolvedValueOnce([
                {
                  id: 55,
                  crecheId: 1,
                  status: "draft",
                  pricingOverrideType: "fixed_amount",
                  pricingOverrideValue: 24990,
                },
              ]),
            }),
          }),
        }),
      } as any);

      // 6b. Plan Prices query for draft condition
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      } as any);

      const res = await request(app).get("/api/creches/1/commercial/support");
      expect(res.status).toBe(200);
      expect(res.body.subscriptionState).toBe("PROVISIONED");
      expect(res.body.subscription.hasStripeCustomer).toBe(true);
      expect(res.body.subscription.hasStripeSubscription).toBe(true);
      expect(res.body.limits.activePetCount).toBe(12);
      expect(res.body.limits.effectivePetLimit).toBe(40);
      expect(res.body.limits.isCustomLimit).toBe(true);

      // Active price: 15% discount on 31990 = 27192
      expect(res.body.pricing.finalEffectivePriceCents).toBe(27192);

      // Draft price is separate
      expect(res.body.draftCondition).toBeDefined();
      expect(res.body.draftCondition.proposedPricing.finalEffectivePriceCents).toBe(24990);
      expect(res.body.draftCondition.statusNotice).toBe("Ainda não aplicado / aguardando etapa Stripe");
    });
  });

  describe("3. Price Preview (Section 18)", () => {
    it("simulates pricing and limit delta without mutating database", async () => {
      // Plan query
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([
              { id: 1, name: "Plano Base", priceBrl: 31990, petLimit: 20 },
            ]),
          }),
        }),
      } as any);

      // Plan prices query (for interval)
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      } as any);

      // Active pets
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([{ total: 10 }]),
        }),
      } as any);

      const res = await request(app)
        .post("/api/creches/1/commercial/preview-price")
        .send({
          planId: 1,
          pricingOverrideType: "percentage",
          pricingOverrideValue: 1500, // 15%
          entitlementPetLimit: 35,
        });

      expect(res.status).toBe(200);
      expect(res.body.catalogPriceCents).toBe(31990);
      expect(res.body.proposedEffectivePriceCents).toBe(27192);
      expect(res.body.absoluteDifferenceCents).toBe(4798);
      expect(res.body.discountPercentage).toBe(15);
      expect(res.body.proposedPetLimit).toBe(35);
      expect(res.body.activePetCount).toBe(10);
    });
  });

  describe("4. Safe Pet Limit Override (Section 13, 14, 15 & Correction 3, 13)", () => {
    const VALID_UUID = "e4a8b792-710f-4df7-873b-554477123456";

    it("requires a valid UUID X-Idempotency-Key header", async () => {
      const res = await request(app)
        .post("/api/creches/1/commercial/pet-limit-override")
        .set("X-Idempotency-Key", "invalid_not_a_uuid")
        .send({ entitlementPetLimit: 50, reason: "Expanding kennel capacity" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("idempotency_key_invalid");
    });

    it("requires a non-empty reason for master_admin mutation", async () => {
      const res = await request(app)
        .post("/api/creches/1/commercial/pet-limit-override")
        .set("X-Idempotency-Key", VALID_UUID)
        .send({ entitlementPetLimit: 50, reason: "   " });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("reason_required");
    });

    it("returns HTTP 409 warning when requested limit < activePetCount without confirmation (Correction 13)", async () => {
      // 1. Creche exists
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, name: "Creche 1" }]),
          }),
        }),
      } as any);

      // 2. Subscription
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, crecheId: 1, planId: 1 }]),
          }),
        }),
      } as any);

      // 3. Active pets = 30
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([{ total: 30 }]),
        }),
      } as any);

      // 4. Idempotency query (no existing record)
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      } as any);

      // Requesting limit 20 < 30 active pets, without confirmLowering
      const res = await request(app)
        .post("/api/creches/1/commercial/pet-limit-override")
        .set("X-Idempotency-Key", VALID_UUID)
        .send({ entitlementPetLimit: 20, reason: "Downsizing operational facility" });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("active_pets_exceed_limit");
      expect(res.body.confirmationRequired).toBe(true);
      expect(res.body.activePetCount).toBe(30);
      expect(res.body.requestedLimit).toBe(20);
    });

    it("executes pet limit succession when confirmLowering: true is provided", async () => {
      // 1. Creche exists
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, name: "Creche 1" }]),
          }),
        }),
      } as any);

      // 2. Subscription
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, crecheId: 1, planId: 1 }]),
          }),
        }),
      } as any);

      // 3. Active pets = 30
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([{ total: 30 }]),
        }),
      } as any);

      // 4. Idempotency query (returns empty)
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      } as any);

      // 5. Active condition query (returns null)
      // (sub has no activeConditionId)

      // Transaction queries inside transitionActiveCondition:
      // - fetch sub
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, crecheId: 1 }]),
          }),
        }),
      } as any);
      // - fetch new condition
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([
              {
                id: 105,
                crecheId: 1,
                status: "draft",
                validFrom: new Date(),
                pricingOverrideType: "none",
                entitlementPetLimit: 20,
              },
            ]),
          }),
        }),
      } as any);
      // - fetch current active
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      } as any);
      // - insert returning
      vi.mocked(db.insert).mockImplementation(((table: any) => {
        if (table === customerCommercialConditionsTable) {
          return {
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([
                { id: 105, crecheId: 1, entitlementPetLimit: 20, status: "draft" },
              ]),
            }),
          };
        }
        return {
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        };
      }) as any);
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
              { id: 105, crecheId: 1, entitlementPetLimit: 20, status: "active" },
            ]),
          }),
        }),
      } as any);

      const res = await request(app)
        .post("/api/creches/1/commercial/pet-limit-override")
        .set("X-Idempotency-Key", VALID_UUID)
        .send({
          entitlementPetLimit: 20,
          reason: "Downsizing operational facility confirmed with client",
          confirmLowering: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.condition.entitlementPetLimit).toBe(20);
    });

    it("replays identical idempotent request with zero new business mutation (Correction 3)", async () => {
      const existingRecord = {
        id: 1,
        crecheId: 1,
        operation: "PET_LIMIT_OVERRIDE",
        idempotencyKey: VALID_UUID,
        requestFingerprint: "mocked_fp",
        status: "SUCCEEDED",
        statusCode: 200,
        responsePayload: {
          success: true,
          condition: { id: 105, crecheId: 1, entitlementPetLimit: 45, status: "active" },
          message: "Limite de pets ajustado para 45 com sucesso.",
        },
      };

      // 1. Creche exists
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, name: "Creche 1" }]),
          }),
        }),
      } as any);

      // 2. Subscription
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, crecheId: 1, planId: 1 }]),
          }),
        }),
      } as any);

      // 3. Active pets
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([{ total: 10 }]),
        }),
      } as any);

      // 4. Idempotency query finds exact existing record
      const crypto = await import("crypto");
      const expectedFp = crypto
        .createHash("sha256")
        .update(
          JSON.stringify(
            {
              crecheId: 1,
              entitlementPetLimit: 45,
              operation: "PET_LIMIT_OVERRIDE",
              reason: "VIP expansion",
            },
            Object.keys({
              crecheId: 1,
              entitlementPetLimit: 45,
              operation: "PET_LIMIT_OVERRIDE",
              reason: "VIP expansion",
            }).sort(),
          ),
        )
        .digest("hex");

      existingRecord.requestFingerprint = expectedFp;
      existingRecord.operation = "PET_LIMIT_OVERRIDE";

      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([existingRecord]),
          }),
        }),
      } as any);

      const res = await request(app)
        .post("/api/creches/1/commercial/pet-limit-override")
        .set("X-Idempotency-Key", VALID_UUID)
        .send({
          entitlementPetLimit: 45,
          reason: "VIP expansion",
        });

      expect(res.status).toBe(200);
      expect(res.body.replay).toBe(true);
      expect(res.body.condition.id).toBe(105);
      // Verify db.insert was NEVER called
      expect(db.insert).not.toHaveBeenCalled();
    });

    it("returns HTTP 409 idempotency conflict when same key is reused with different payload (Section 3)", async () => {
      const existingRecord = {
        id: 105,
        crecheId: 1,
        idempotencyKey: VALID_UUID,
        idempotencyOperation: "PET_LIMIT_OVERRIDE",
        requestFingerprint: "different_fingerprint_hash",
        status: "active",
      };

      // 1. Creche exists
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, name: "Creche 1" }]),
          }),
        }),
      } as any);

      // 2. Subscription
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, crecheId: 1, planId: 1 }]),
          }),
        }),
      } as any);

      // 3. Active pets
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([{ total: 10 }]),
        }),
      } as any);

      // 4. Idempotency query finds record with different fingerprint
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([existingRecord]),
          }),
        }),
      } as any);

      const res = await request(app)
        .post("/api/creches/1/commercial/pet-limit-override")
        .set("X-Idempotency-Key", VALID_UUID)
        .send({
          entitlementPetLimit: 90,
          reason: "Different request completely",
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("idempotency_conflict");
      expect(res.body.code).toBe("IDEMPOTENCY_CONFLICT");
    });

    it("returns HTTP 409 idempotency conflict when same key is reused with different commercial operation (Section 3)", async () => {
      const existingRecord = {
        id: 105,
        crecheId: 1,
        idempotencyKey: VALID_UUID,
        idempotencyOperation: "PET_LIMIT_OVERRIDE",
        requestFingerprint: "any_hash",
        status: "active",
      };

      // 1. Creche exists
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, name: "Creche 1" }]),
          }),
        }),
      } as any);

      // 2. Subscription
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, crecheId: 1, planId: 1 }]),
          }),
        }),
      } as any);

      // 3. Idempotency query in draft-condition finds existing record from PET_LIMIT_OVERRIDE
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([existingRecord]),
          }),
        }),
      } as any);

      const res = await request(app)
        .post("/api/creches/1/commercial/draft-condition")
        .set("X-Idempotency-Key", VALID_UUID)
        .send({
          planId: 1,
          pricingOverrideType: "percentage",
          pricingOverrideValue: 1000,
          reason: "Different operation entirely",
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("idempotency_conflict");
      expect(res.body.code).toBe("IDEMPOTENCY_CONFLICT");
    });

    it("rejects missing or malformed X-Idempotency-Key with HTTP 400 (Section 6)", async () => {
      // 1. Missing header
      const res1 = await request(app)
        .post("/api/creches/1/commercial/pet-limit-override")
        .send({
          entitlementPetLimit: 40,
          reason: "Sem chave",
        });

      expect(res1.status).toBe(400);
      expect(res1.body.error).toBe("idempotency_key_invalid");

      // 2. Malformed UUID
      const res2 = await request(app)
        .post("/api/creches/1/commercial/pet-limit-override")
        .set("X-Idempotency-Key", "not-a-valid-uuid")
        .send({
          entitlementPetLimit: 40,
          reason: "Chave malformada",
        });

      expect(res2.status).toBe(400);
      expect(res2.body.error).toBe("idempotency_key_invalid");
    });

    it("returns HTTP 409 confirmationRequired when lowering limit without confirmLowering, and does NOT consume the idempotency key (Section 5)", async () => {
      const KEY = "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d";

      // Request 1: confirmLowering = false
      // 1. Creche exists
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, name: "Creche 1" }]),
          }),
        }),
      } as any);

      // 2. Subscription
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, crecheId: 1, planId: 1 }]),
          }),
        }),
      } as any);

      // 3. Active pets = 42
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([{ total: 42 }]),
        }),
      } as any);

      const res1 = await request(app)
        .post("/api/creches/1/commercial/pet-limit-override")
        .set("X-Idempotency-Key", KEY)
        .send({
          entitlementPetLimit: 30, // 30 < 42
          reason: "Reduzir baias para reforma",
          confirmLowering: false,
        });

      expect(res1.status).toBe(409);
      expect(res1.body.error).toBe("active_pets_exceed_limit");
      expect(res1.body.confirmationRequired).toBe(true);
      expect(res1.body.activePetCount).toBe(42);
      expect(db.insert).not.toHaveBeenCalled();

      // Request 2: SAME KEY, but confirmLowering = true -> Allowed to execute!
      // 1. Creche exists
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, name: "Creche 1" }]),
          }),
        }),
      } as any);

      // 2. Subscription
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, crecheId: 1, planId: 1 }]),
          }),
        }),
      } as any);

      // 3. Active pets = 42
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([{ total: 42 }]),
        }),
      } as any);

      // 4. Idempotency query: still no existing record (because Request 1 didn't consume the key!)
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      } as any);

      // Transaction queries inside transitionActiveCondition:
      // - fetch sub
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, crecheId: 1 }]),
          }),
        }),
      } as any);
      // - fetch new condition
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([
              {
                id: 110,
                crecheId: 1,
                status: "draft",
                validFrom: new Date(),
                pricingOverrideType: "none",
                entitlementPetLimit: 30,
              },
            ]),
          }),
        }),
      } as any);
      // - fetch current active
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      } as any);
      // - insert returning
      vi.mocked(db.insert).mockImplementation(((table: any) => {
        if (table === customerCommercialConditionsTable) {
          return {
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([
                { id: 110, crecheId: 1, entitlementPetLimit: 30, status: "draft" },
              ]),
            }),
          };
        }
        return {
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        };
      }) as any);
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
              { id: 110, crecheId: 1, entitlementPetLimit: 30, status: "active" },
            ]),
          }),
        }),
      } as any);

      const res2 = await request(app)
        .post("/api/creches/1/commercial/pet-limit-override")
        .set("X-Idempotency-Key", KEY)
        .send({
          entitlementPetLimit: 30,
          reason: "Reduzir baias para reforma",
          confirmLowering: true,
        });

      expect(res2.status).toBe(201);
      expect(res2.body.success).toBe(true);
      expect(res2.body.condition.entitlementPetLimit).toBe(30);
    });

    it("verifies audit record is created with canonical actorType 'user' and actorRole 'master_admin' (Section 7)", async () => {
      const KEY = "b2c3d4e5-f6a7-4b2c-9d3e-4f5a6b7c8d9e";
      const { logCommercialAudit } = await import("../services/commercialAudit.js");

      // 1. Creche exists
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, name: "Creche 1" }]),
          }),
        }),
      } as any);

      // 2. Subscription
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, crecheId: 1, planId: 1 }]),
          }),
        }),
      } as any);

      // 3. Active pets = 10
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([{ total: 10 }]),
        }),
      } as any);

      // 4. Idempotency query: no existing record
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      } as any);

      // Transaction queries inside transitionActiveCondition:
      // - fetch sub
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, crecheId: 1 }]),
          }),
        }),
      } as any);
      // - fetch new condition
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([
              {
                id: 115,
                crecheId: 1,
                status: "draft",
                validFrom: new Date(),
                pricingOverrideType: "none",
                entitlementPetLimit: 50,
              },
            ]),
          }),
        }),
      } as any);
      // - fetch current active
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      } as any);
      // - insert returning
      vi.mocked(db.insert).mockImplementation(((table: any) => {
        if (table === customerCommercialConditionsTable) {
          return {
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([
                { id: 115, crecheId: 1, entitlementPetLimit: 50, status: "draft" },
              ]),
            }),
          };
        }
        return {
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        };
      }) as any);
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
              { id: 115, crecheId: 1, entitlementPetLimit: 50, status: "active" },
            ]),
          }),
        }),
      } as any);

      const res = await request(app)
        .post("/api/creches/1/commercial/pet-limit-override")
        .set("X-Idempotency-Key", KEY)
        .send({
          entitlementPetLimit: 50,
          reason: "Ampliação de baias VIP",
        });

      expect(res.status).toBe(201);
      expect(logCommercialAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          targetCrecheId: 1,
          actorType: "user",
          actorRole: "master_admin",
          action: "pet_limit_override",
          reason: "Ampliação de baias VIP",
        }),
        expect.anything(),
      );
    });
  });

  describe("5. Draft Price Condition (Section 17, 19 & Correction 4)", () => {
    const DRAFT_UUID = "f7b1c2d3-e4f5-4a6b-8c9d-0e1f2a3b4c5d";

    it("saves recurring price change as draft with syncStatus 'not_started' without activating billing", async () => {
      // 1. Creche exists
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, name: "Creche 1" }]),
          }),
        }),
      } as any);

      // 2. Subscription
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([{ id: 1, crecheId: 1, planId: 2 }]),
          }),
        }),
      } as any);

      // 3. Idempotency query
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      } as any);

      // 3b. Plan query for draft snapshot resolution
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([
              { id: 2, name: "Plano Pro", priceBrl: 31990, petLimit: 30 },
            ]),
          }),
        }),
      } as any);

      // 3c. Plan prices query for draft snapshot resolution
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockReturnValueOnce({
            limit: vi.fn().mockResolvedValueOnce([]),
          }),
        }),
      } as any);

      // 4. Insert returning
      vi.mocked(db.insert).mockImplementation(((table: any) => {
        if (table === customerCommercialConditionsTable) {
          return {
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([
                {
                  id: 201,
                  crecheId: 1,
                  status: "draft",
                  syncStatus: "not_started",
                  executionRequirement: "STRIPE_REQUIRED",
                  pricingOverrideType: "percentage",
                  pricingOverrideValue: 2000, // 20%
                  snapshotBillingInterval: "month",
                  snapshotBasePriceCents: 31990,
                },
              ]),
            }),
          };
        }
        return {
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        };
      }) as any);

      const res = await request(app)
        .post("/api/creches/1/commercial/draft-condition")
        .set("X-Idempotency-Key", DRAFT_UUID)
        .send({
          planId: 2,
          pricingOverrideType: "percentage",
          pricingOverrideValue: 2000,
          reason: "Negotiated annual retention discount",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.condition.status).toBe("draft");
      expect(res.body.condition.syncStatus).toBe("not_started");
      expect(res.body.condition.executionRequirement).toBe("STRIPE_REQUIRED");
      expect(res.body.message).toContain("A alteração de cobrança será aplicada após a etapa de sincronização com o Stripe");
    });
  });
});
