import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkPetLimit, countActivePetsForCreche } from "../middlewares/checkPetLimit.js";
import { db } from "@workspace/db";

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
  },
}));

describe("checkPetLimit Middleware Unit & Integrity Tests (R36.D)", () => {
  let req: any;
  let res: any;
  let next: any;

  beforeEach(() => {
    vi.clearAllMocks();

    req = {
      user: { id: 1, role: "creche_admin", crecheId: 10 },
      params: { crecheId: "10" },
    };

    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    next = vi.fn();
  });

  it("bypasses limit check immediately for master_admin", async () => {
    req.user.role = "master_admin";
    await checkPetLimit(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("returns 400 if crecheId is invalid or NaN", async () => {
    req.params.crecheId = "invalid_id";
    await checkPetLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Creche inválida." });
    expect(next).not.toHaveBeenCalled();
  });

  it("allows registration if creche has no subscription record", async () => {
    // sub select returns empty
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          limit: vi.fn().mockResolvedValueOnce([]),
        }),
      }),
    } as any);

    await checkPetLimit(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("enforces catalog plan pet limit when activeConditionId is null", async () => {
    // 1. Subscription with no active condition
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          limit: vi.fn().mockResolvedValueOnce([{ planId: 1, activeConditionId: null }]),
        }),
      }),
    } as any);

    // 2. Plan with petLimit = 20
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          limit: vi.fn().mockResolvedValueOnce([{ petLimit: 20 }]),
        }),
      }),
    } as any);

    // 3. Current active pets = 20 (limit reached)
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockResolvedValueOnce([{ total: 20 }]),
      }),
    } as any);

    await checkPetLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "pet_limit_reached",
      message: "Limite de 20 pets atingido no seu plano. Faça upgrade para cadastrar mais.",
      current: 20,
      limit: 20,
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("resolves active commercial condition entitlementPetLimit when present", async () => {
    // 1. Subscription with activeConditionId = 100
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          limit: vi.fn().mockResolvedValueOnce([{ planId: 1, activeConditionId: 100 }]),
        }),
      }),
    } as any);

    // 2. Catalog plan with default petLimit = 20
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          limit: vi.fn().mockResolvedValueOnce([{ petLimit: 20 }]),
        }),
      }),
    } as any);

    // 3. Active commercial condition with entitlementPetLimit = 50
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          limit: vi.fn().mockResolvedValueOnce([
            {
              id: 100,
              crecheId: 10,
              status: "active",
              entitlementPetLimit: 50,
            },
          ]),
        }),
      }),
    } as any);

    // 4. Current active pets = 25 (over catalog 20, but under custom 50)
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockResolvedValueOnce([{ total: 25 }]),
      }),
    } as any);

    await checkPetLimit(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("fails closed on condition integrity violation: missing condition does not silently fall back to catalog (Correction 5)", async () => {
    // 1. Subscription points to activeConditionId = 999
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          limit: vi.fn().mockResolvedValueOnce([{ planId: 1, activeConditionId: 999 }]),
        }),
      }),
    } as any);

    // 2. Catalog plan
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          limit: vi.fn().mockResolvedValueOnce([{ petLimit: 20 }]),
        }),
      }),
    } as any);

    // 3. Condition query returns empty (missing record)
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          limit: vi.fn().mockResolvedValueOnce([]),
        }),
      }),
    } as any);

    await checkPetLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "commercial_condition_integrity_error",
      message: expect.stringContaining("condition #999 referenced by subscription does not exist"),
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("fails closed on condition integrity violation: cross-tenant condition does not silently fall back (Correction 5)", async () => {
    // 1. Subscription for creche 10 points to condition 200
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          limit: vi.fn().mockResolvedValueOnce([{ planId: 1, activeConditionId: 200 }]),
        }),
      }),
    } as any);

    // 2. Catalog plan
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          limit: vi.fn().mockResolvedValueOnce([{ petLimit: 20 }]),
        }),
      }),
    } as any);

    // 3. Condition belongs to creche 99, not 10
    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValueOnce({
        where: vi.fn().mockReturnValueOnce({
          limit: vi.fn().mockResolvedValueOnce([
            {
              id: 200,
              crecheId: 99,
              status: "active",
              entitlementPetLimit: 50,
            },
          ]),
        }),
      }),
    } as any);

    await checkPetLimit(req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "commercial_condition_integrity_error",
      message: expect.stringContaining("belongs to creche #99, expected creche #10"),
    });
    expect(next).not.toHaveBeenCalled();
  });
});
