import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { commercialRouter } from "../routes/commercial.js";
import { db } from "@workspace/db";

vi.mock("@workspace/db", () => {
  const mDb: any = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn((cb) => cb(mDb)),
  };
  return { db: mDb };
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
    vi.clearAllMocks();
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
              { id: 2, name: "Plano Pro", slug: "pro", priceCents: 31990, petLimit: 30 },
            ]),
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
              { id: 1, name: "Plano Base", priceCents: 31990, petLimit: 20 },
            ]),
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
      vi.mocked(db.insert).mockReturnValueOnce({
        values: vi.fn().mockReturnValueOnce({
          returning: vi.fn().mockResolvedValueOnce([
            { id: 105, crecheId: 1, entitlementPetLimit: 20, status: "draft" },
          ]),
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
        id: 105,
        crecheId: 1,
        idempotencyKey: VALID_UUID,
        idempotencyOperation: "pet_limit_override",
        requestFingerprint: "mocked_fp",
        status: "active",
        entitlementPetLimit: 45,
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
      // Let's mock requestFingerprint calculation match
      const crypto = await import("crypto");
      const expectedFp = crypto
        .createHash("sha256")
        .update(
          JSON.stringify(
            {
              crecheId: 1,
              entitlementPetLimit: 45,
              operation: "pet_limit_override",
              reason: "VIP expansion",
            },
            Object.keys({
              crecheId: 1,
              entitlementPetLimit: 45,
              operation: "pet_limit_override",
              reason: "VIP expansion",
            }).sort(),
          ),
        )
        .digest("hex");

      existingRecord.requestFingerprint = expectedFp;

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

    it("returns HTTP 409 idempotency conflict when same key is reused with different payload (Correction 3)", async () => {
      const existingRecord = {
        id: 105,
        crecheId: 1,
        idempotencyKey: VALID_UUID,
        idempotencyOperation: "pet_limit_override",
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

      // 4. Insert returning
      vi.mocked(db.insert).mockReturnValueOnce({
        values: vi.fn().mockReturnValueOnce({
          returning: vi.fn().mockResolvedValueOnce([
            {
              id: 201,
              crecheId: 1,
              status: "draft",
              syncStatus: "not_started",
              executionRequirement: "STRIPE_REQUIRED",
              pricingOverrideType: "percentage",
              pricingOverrideValue: 2000, // 20%
            },
          ]),
        }),
      } as any);

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
