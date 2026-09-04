import { describe, it, expect, vi, beforeEach } from "vitest";
import { logCommercialAudit, CommercialAuditError } from "../services/commercialAudit.js";

describe("Commercial Audit Writer Unit Tests (R36.C)", () => {
  let mockInsertedRows: any[] = [];
  let mockDb: any;

  beforeEach(() => {
    mockInsertedRows = [];
    mockDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((val) => ({
          returning: vi.fn().mockImplementation(() => {
            const row = { id: 101, ...val, createdAt: new Date() };
            mockInsertedRows.push(row);
            return Promise.resolve([row]);
          }),
        })),
      }),
    };
  });

  it("requires a reason when master_admin executes a privileged administrative mutation", async () => {
    await expect(
      logCommercialAudit(
        {
          targetCrecheId: 1,
          actorType: "user",
          actorRole: "master_admin",
          actorId: 42,
          actorEmail: "admin@arkpet.com",
          action: "override_pricing",
          reason: "",
        },
        mockDb,
      ),
    ).rejects.toThrow(CommercialAuditError);

    await expect(
      logCommercialAudit(
        {
          targetCrecheId: 1,
          actorType: "user",
          actorRole: "master_admin",
          actorId: 42,
          action: "override_pet_limit",
          reason: "   ",
        },
        mockDb,
      ),
    ).rejects.toThrow(CommercialAuditError);

    expect(mockInsertedRows.length).toBe(0);
  });

  it("accepts creche_admin self-service proposal acceptance without requiring a business reason", async () => {
    const result = await logCommercialAudit(
      {
        targetCrecheId: 1,
        actorType: "user",
        actorRole: "creche_admin",
        actorId: 88,
        actorEmail: "tutor@creche.com",
        action: "proposal_acceptance",
        relatedAgreementId: 5,
      },
      mockDb,
    );

    expect(result.actorRole).toBe("creche_admin");
    expect(result.action).toBe("proposal_acceptance");
    expect(result.reason).toBeNull();
    expect(mockInsertedRows.length).toBe(1);
  });

  it("persists audit successfully when actorType is 'user' and valid reason is provided", async () => {
    const result = await logCommercialAudit(
      {
        targetCrecheId: 2,
        actorType: "user",
        actorId: 5,
        actorRole: "master_admin",
        actorEmail: "master@arkpet.com.br",
        action: "create_commercial_proposal",
        reason: "VIP commercial partnership agreement for network creche",
        beforeState: { petLimit: 15 },
        afterState: { petLimit: 25 },
        executionRequirement: "none",
        executionStatus: "pending",
        relatedAgreementId: 10,
        relatedConditionId: 20,
      },
      mockDb,
    );

    expect(result.id).toBe(101);
    expect(result.targetCrecheId).toBe(2);
    expect(result.actorType).toBe("user");
    expect(result.reason).toBe("VIP commercial partnership agreement for network creche");
    expect(result.beforeState).toEqual({ petLimit: 15 });
    expect(result.afterState).toEqual({ petLimit: 25 });
    expect(mockInsertedRows.length).toBe(1);
  });

  it("does not force a human reason for 'system' or 'gateway' actors", async () => {
    const sysResult = await logCommercialAudit(
      {
        targetCrecheId: 3,
        actorType: "system",
        action: "expire_commercial_agreement",
      },
      mockDb,
    );
    expect(sysResult.actorType).toBe("system");
    expect(sysResult.reason).toBeNull();

    const gwResult = await logCommercialAudit(
      {
        targetCrecheId: 3,
        actorType: "gateway",
        action: "stripe_subscription_sync",
        executionRequirement: "requires_stripe_custom_price",
      },
      mockDb,
    );
    expect(gwResult.actorType).toBe("gateway");
    expect(gwResult.reason).toBeNull();
  });

  it("rejects unknown actor types", async () => {
    await expect(
      logCommercialAudit(
        {
          targetCrecheId: 1,
          actorType: "alien" as any,
          action: "do_something",
        },
        mockDb,
      ),
    ).rejects.toThrow(CommercialAuditError);
  });

  it("propagates database insertion errors without swallowing", async () => {
    const errorDb = {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockRejectedValue(new Error("Database connection lost")),
        }),
      }),
    };

    await expect(
      logCommercialAudit(
        {
          targetCrecheId: 1,
          actorType: "system",
          action: "test_action",
        },
        errorDb,
      ),
    ).rejects.toThrow("Database connection lost");
  });
});
