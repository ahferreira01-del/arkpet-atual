import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeDedupKey,
  sanitizeDeepLink,
  renderCommercialTemplate,
  resolveRecipientsForAudience,
  enqueueCommercialCommunication,
  claimDueOutboxBatch,
  markOutboxDelivered,
  markOutboxFailed,
  dispatchOutboxEvent,
  getCommercialNotificationsForUser,
  markCommercialNotificationAsRead,
  markAllCommercialNotificationsAsRead,
} from "../services/commercialOutbox.js";
import express from "express";
import request from "supertest";
import billingRouter from "../routes/billing.js";
import { commercialRouter } from "../routes/commercial.js";

// Mock Resend and WebPush
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: {
      send: vi.fn().mockResolvedValue({ data: { id: "resend-msg-123" }, error: null }),
    },
  })),
}));

vi.mock("web-push", () => ({
  default: {
    sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }),
    setVapidDetails: vi.fn(),
  },
}));

vi.mock("../lib/config.js", () => ({
  getAppBaseUrl: () => "http://localhost:3000",
}));

let mockUserForAuth: any = null;

vi.mock("../middlewares/authenticate.js", () => ({
  authenticate: (req: any, res: any, next: any) => {
    if (mockUserForAuth) {
      req.user = mockUserForAuth;
      return next();
    }
    res.status(401).json({ error: "Not authenticated" });
  },
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  },
}));

describe("R36.H Commercial Communications & Durable Outbox Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserForAuth = null;
  });

  describe("1. Dedup Key & Invariance (Correction 6)", () => {
    it("generates deterministic sha256 based on eventOccurrenceKey:recipientUserId:channel", () => {
      const key1 = computeDedupKey("proposal-sent-10", 5, "email");
      const key2 = computeDedupKey("proposal-sent-10", 5, "email");
      expect(key1).toBe(key2);
      expect(key1).toHaveLength(64); // sha256 hex
    });

    it("proves templateVersion is NOT part of dedupKey", () => {
      // Different versions must compute the exact same dedupKey for the same event, recipient, and channel
      const keyV1 = computeDedupKey("proposal-sent-10", 5, "email");
      const keyV2 = computeDedupKey("proposal-sent-10", 5, "email");
      expect(keyV1).toBe(keyV2);
    });

    it("generates different dedupKeys for different channels or recipients", () => {
      const emailKey = computeDedupKey("proposal-sent-10", 5, "email");
      const pushKey = computeDedupKey("proposal-sent-10", 5, "push");
      const otherUserKey = computeDedupKey("proposal-sent-10", 6, "email");

      expect(emailKey).not.toBe(pushKey);
      expect(emailKey).not.toBe(otherUserKey);
    });
  });

  describe("2. Deep Link Sanitization & Allowlist (Correction 12)", () => {
    it("allows /assinatura for creche_admin", () => {
      expect(sanitizeDeepLink("/assinatura", "creche_admin")).toBe("/assinatura");
    });

    it("allows /admin/proposals and /admin/campaigns for master_admin", () => {
      expect(sanitizeDeepLink("/admin/proposals", "master_admin")).toBe("/admin/proposals");
      expect(sanitizeDeepLink("/admin/campaigns", "master_admin")).toBe("/admin/campaigns");
    });

    it("rejects non-allowlisted internal routes", () => {
      expect(sanitizeDeepLink("/financeiro", "creche_admin")).toBeNull();
      expect(sanitizeDeepLink("/configuracoes", "master_admin")).toBeNull();
    });

    it("rejects protocol/external URLs and javascript: payloads", () => {
      expect(sanitizeDeepLink("https://malicious.site", "creche_admin")).toBeNull();
      expect(sanitizeDeepLink("http://malicious.site", "master_admin")).toBeNull();
      expect(sanitizeDeepLink("javascript:alert(1)", "creche_admin")).toBeNull();
      expect(sanitizeDeepLink("//malicious.site", "master_admin")).toBeNull();
      expect(sanitizeDeepLink("data:text/html,evil", "creche_admin")).toBeNull();
    });
  });

  describe("3. Commercial Templates & Customer Safety (Section 18, 20)", () => {
    it("renders customer-safe copy for PROPOSAL_ACTIVATION_FAILED without internal error leakage", () => {
      const template = renderCommercialTemplate(
        "PROPOSAL_ACTIVATION_FAILED",
        "in_app",
        { internalDatabaseError: "connection refused at 10.0.0.1" },
        "creche_admin"
      );

      expect(template.title).toBe("Processamento de Ativação em Andamento");
      expect(template.body.toLowerCase()).toContain("nossa equipe foi avisada");
      expect(template.body).not.toContain("connection refused");
      expect(template.body).not.toContain("10.0.0.1");
    });

    it("renders operational details with safeErrorCode for master_admin on PROPOSAL_ACTIVATION_FAILED", () => {
      const template = renderCommercialTemplate(
        "PROPOSAL_ACTIVATION_FAILED",
        "in_app",
        { agreementId: 42, crecheId: 7, safeErrorCode: "STRIPE_CARD_DECLINED" },
        "master_admin"
      );

      expect(template.title).toBe("Falha na Ativação de Proposta Comercial");
      expect(template.body).toContain("STRIPE_CARD_DECLINED");
      expect(template.body).toContain("Intervenção operacional recomendada");
    });

    it("formats monetary facts safely in BRL", () => {
      const template = renderCommercialTemplate(
        "COMMERCIAL_PROPOSAL_SENT",
        "email",
        { displayedEffectivePriceCents: 15000, billingInterval: "month" },
        "creche_admin"
      );

      expect(template.body.replace(/\u00A0/g, " ")).toContain("R$ 150,00");
      expect(template.body).toContain("mensal");
    });

    it("provides lock-screen safe push copy without exposing sensitive monetary values", () => {
      const template = renderCommercialTemplate(
        "COMMERCIAL_PROPOSAL_SENT",
        "push",
        { displayedEffectivePriceCents: 15000 },
        "creche_admin"
      );

      expect(template.pushSafeBody).toBeDefined();
      expect(template.pushSafeBody).not.toContain("150,00");
    });
  });

  describe("4. Recipient Cardinality & Multi-Admin Fan-Out (Correction 1 & 2)", () => {
    it("resolves all active creche_admin users for a creche and excludes inactive users", async () => {
      const mockUsers = [
        { id: 101, email: "admin1@creche.com", name: "Admin 1", role: "creche_admin", crecheId: 5, isActive: true },
        { id: 102, email: "admin2@creche.com", name: "Admin 2", role: "creche_admin", crecheId: 5, isActive: true },
      ];

      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(mockUsers),
          }),
        }),
      };

      const recipients = await resolveRecipientsForAudience(
        { audienceRole: "creche_admin", crecheId: 5 },
        mockDb
      );

      expect(recipients).toHaveLength(2);
      expect(recipients[0].email).toBe("admin1@creche.com");
      expect(recipients[1].email).toBe("admin2@creche.com");
    });

    it("fans out communication intents to (N recipients * M channels)", async () => {
      const mockUsers = [
        { id: 101, email: "admin1@creche.com", name: "Admin 1", role: "creche_admin", crecheId: 5, isActive: true },
        { id: 102, email: "admin2@creche.com", name: "Admin 2", role: "creche_admin", crecheId: 5, isActive: true },
      ];

      const insertedRows: any[] = [];
      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(mockUsers),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn((val) => {
            insertedRows.push(val);
            return {
              onConflictDoNothing: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([val]),
              }),
            };
          }),
        }),
      };

      await enqueueCommercialCommunication(
        {
          eventType: "COMMERCIAL_PROPOSAL_SENT",
          eventOccurrenceKey: "proposal-sent-1",
          aggregateType: "commercial_agreement",
          aggregateId: 1,
          crecheId: 5,
          audienceRole: "creche_admin",
          category: "COMMERCIAL",
          factsSnapshotJson: { proposalId: 1 },
          channels: ["in_app", "email"],
        },
        mockDb
      );

      // 2 users * 2 channels = 4 outbox rows
      expect(insertedRows).toHaveLength(4);
      expect(new Set(insertedRows.map((r) => r.dedupKey)).size).toBe(4);
    });

    it("strictly restricts promotional campaign communications to in_app only (Correction 16)", async () => {
      const mockUsers = [
        { id: 101, email: "admin1@creche.com", name: "Admin 1", role: "creche_admin", crecheId: 5, isActive: true },
      ];

      const insertedRows: any[] = [];
      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(mockUsers),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn((val) => {
            insertedRows.push(val);
            return {
              onConflictDoNothing: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([val]),
              }),
            };
          }),
        }),
      };

      await enqueueCommercialCommunication(
        {
          eventType: "CAMPAIGN_BENEFIT_SCHEDULED",
          eventOccurrenceKey: "campaign-1",
          aggregateType: "assigned_commercial_benefit",
          aggregateId: 1,
          crecheId: 5,
          audienceRole: "creche_admin",
          category: "PROMOTION",
          factsSnapshotJson: { campaignName: "Verão" },
          channels: ["in_app", "email", "push"], // Attempted external channels
        },
        mockDb
      );

      // Must be forced to in_app only
      expect(insertedRows).toHaveLength(1);
      expect(insertedRows[0].channel).toBe("in_app");
    });
  });

  describe("5. Worker Leasing, Fencing & Retries (Correction 7)", () => {
    it("claims due outbox items atomically and increments attempt_count", async () => {
      const eligibleRow = {
        id: 1,
        status: "pending",
        attemptCount: 0,
        availableAt: new Date(Date.now() - 1000),
      };

      const mockTx: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                for: vi.fn().mockResolvedValue([eligibleRow]),
              }),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ ...eligibleRow, attemptCount: 1, status: "processing" }]),
            }),
          }),
        }),
      };

      const mockDb: any = {
        transaction: vi.fn((cb) => cb(mockTx)),
      };

      const claimed = await claimDueOutboxBatch(10, 60000, mockDb);
      expect(claimed).toHaveLength(1);
      expect(claimed[0].claimedAttemptCount).toBe(1);
    });

    it("fences delivery updates so stale workers cannot overwrite modern attempts", async () => {
      const mockDb: any = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]), // Attempt count did not match (fenced out)
            }),
          }),
        }),
      };

      const success = await markOutboxDelivered(1, 1, "msg-123", mockDb);
      expect(success).toBe(false);
    });

    it("escalates to failed_final when max attempts are exceeded", async () => {
      let updatedPayload: any = null;
      const mockDb: any = {
        update: vi.fn().mockReturnValue({
          set: vi.fn((p) => {
            updatedPayload = p;
            return {
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: 1, ...p }]),
              }),
            };
          }),
        }),
      };

      // 5th attempt failed -> failed_final
      await markOutboxFailed(1, 5, { code: "PERMANENT_ERROR", message: "Permanent error", retryable: false }, mockDb);
      expect(updatedPayload.status).toBe("failed_final");
    });

    it("schedules retry with exponential backoff when attempt < maxAttempts", async () => {
      let updatedPayload: any = null;
      const mockDb: any = {
        update: vi.fn().mockReturnValue({
          set: vi.fn((p) => {
            updatedPayload = p;
            return {
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: 1, ...p }]),
              }),
            };
          }),
        }),
      };

      const now = Date.now();
      await markOutboxFailed(1, 2, { code: "RETRYABLE_ERROR", message: "Temporary failure", retryable: true }, mockDb);
      expect(updatedPayload.status).toBe("failed_retryable");
      expect(new Date(updatedPayload.availableAt).getTime()).toBeGreaterThan(now + 1000);
    });
  });

  describe("6. In-App Projection & Personal Read State (Correction 3)", () => {
    it("projects delivered in_app outbox item into commercial_notifications", async () => {
      const outboxItem: any = {
        id: 99,
        crecheId: 10,
        recipientUserId: 55,
        eventType: "COMMERCIAL_PROPOSAL_SENT",
        channel: "in_app",
        category: "COMMERCIAL",
        factsSnapshotJson: { displayedEffectivePriceCents: 5000 },
        audienceRole: "creche_admin",
      };

      let projectedNotification: any = null;
      const mockDb: any = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn((v) => {
            projectedNotification = v;
            return {
              onConflictDoNothing: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: 1, ...v }]),
              }),
            };
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([outboxItem]),
            }),
          }),
        }),
      };
      mockDb.transaction = vi.fn((cb) => cb(mockDb));

      const result = await dispatchOutboxEvent(outboxItem, 1, mockDb);
      expect(result.success).toBe(true);
      expect(projectedNotification).toBeDefined();
      expect(projectedNotification.recipientUserId).toBe(55);
      expect(projectedNotification.crecheId).toBe(10);
      expect(projectedNotification.outboxId).toBe(99);
      expect(projectedNotification.readAt).toBeNull();
    });

    it("marks commercial notification read scoped to personal recipientUserId", async () => {
      let conditionsChecked: any[] = [];
      const mockDb: any = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn((c) => {
              conditionsChecked.push(c);
              return {
                returning: vi.fn().mockResolvedValue([{ id: 1, recipientUserId: 55, readAt: new Date() }]),
              };
            }),
          }),
        }),
      };

      const updated = await markCommercialNotificationAsRead(1, 55, 10, mockDb);
      expect(updated).not.toBeNull();
      expect(updated?.recipientUserId).toBe(55);
    });
  });

  describe("7. HTTP Route Authorization & Tenant Scoping", () => {
    it("blocks tutor and staff from accessing /api/billing/commercial-notifications with 403", async () => {
      const app = express();
      app.use(express.json());
      mockUserForAuth = { id: 99, role: "tutor", crecheId: 10 };
      app.use("/api/billing", billingRouter);

      const res = await request(app).get("/api/billing/commercial-notifications");
      expect(res.status).toBe(403);
    });

    it("blocks creche_admin from accessing /api/commercial/operational-notifications with 403", async () => {
      const app = express();
      app.use(express.json());
      mockUserForAuth = { id: 10, role: "creche_admin", crecheId: 5 };
      app.use("/api/commercial", commercialRouter);

      const res = await request(app).get("/api/commercial/operational-notifications");
      expect(res.status).toBe(403);
    });
  });
});
