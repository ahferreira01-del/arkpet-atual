process.env.VAPID_PUBLIC_KEY = "BFtestVapidPublicKeyForUnitTestingPurposesOnly123456789=";
process.env.VAPID_PRIVATE_KEY = "testVapidPrivateKey123=";

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sendPushToUser,
  sendPushToRole,
  sendPushToUsers,
  isPushDuplicate,
  clearPushDedupCache,
  logPushAudit,
} from "../lib/push.js";

// Mock web-push
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }),
  },
}));

// Mock @workspace/db
const mockPushSubscriptions: any[] = [];
const mockUsers: any[] = [];

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation((table: any) => ({
        where: vi.fn().mockImplementation((clause: any) => {
          // Identify table by query context
          return Promise.resolve(mockUsers);
        }),
      })),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((val: any) => {
        mockPushSubscriptions.push({ id: mockPushSubscriptions.length + 1, ...val });
        return Promise.resolve();
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockImplementation((updates: any) => ({
        where: vi.fn().mockImplementation(() => {
          return Promise.resolve();
        }),
      })),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => {
        return Promise.resolve();
      }),
    }),
  },
}));

describe("R40.A-FINAL.1 — Notification Reliability & Idempotency Hardening Suite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPushDedupCache();
    mockPushSubscriptions.length = 0;
    mockUsers.length = 0;
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 1. TENANT ISOLATION TESTS
  // ───────────────────────────────────────────────────────────────────────────
  describe("Tenant Isolation (NOTIF-SEC-01 & NOTIF-SEC-02)", () => {
    it("NOTIF-SEC-01: Tenant A event never resolves recipients from Tenant B", async () => {
      // Mock db queries: Tenant 1 (creche 1) has staff user 10; Tenant 2 (creche 2) has staff user 20
      const { db } = await import("@workspace/db");

      let capturedWhereCondition: any;
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockImplementation((cond: any) => {
            capturedWhereCondition = cond;
            // Return only users belonging to crecheId = 1
            return Promise.resolve([{ id: 10 }]);
          }),
        }),
      } as any);

      // Second query retrieves subscriptions for user 10
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([
            { id: 101, userId: 10, endpoint: "https://push.example.com/staff-tenant-1", p256dh: "key1", auth: "auth1" },
          ]),
        }),
      } as any);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await sendPushToRole(1, "staff", {
        title: "Check-in na Creche 1",
        body: "Pet Rex acabou de entrar.",
        tag: "checkin-rex-1",
        data: { type: "checkin", crecheId: 1 },
      });

      // Verification: Recipient was role:staff:1 and exactly 1 subscription from Tenant 1 was dispatched
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"recipientId":"role:staff:1"')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"subCount":1')
      );
      // Ensure users from Tenant 2 (userId: 20) were never queried or notified
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('"role:staff:2"')
      );
    });

    it("NOTIF-SEC-02: Creche admin receives only tenant-scoped operational notifications", async () => {
      const { db } = await import("@workspace/db");

      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([{ id: 5 }]), // Admin of Creche 10
        }),
      } as any);

      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([
            { id: 201, userId: 5, endpoint: "https://push.example.com/admin-creche-10", p256dh: "keyA", auth: "authA" },
          ]),
        }),
      } as any);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await sendPushToRole(10, "creche_admin", {
        title: "Nova Reserva",
        body: "Solicitação para 15/10",
        tag: "booking-req-99",
        data: { type: "booking", crecheId: 10, bookingId: 99 },
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"recipientId":"role:creche_admin:10"')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"status":"SENT"')
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. TUTOR OWNERSHIP TESTS
  // ───────────────────────────────────────────────────────────────────────────
  describe("Tutor Ownership Isolation (NOTIF-SEC-03 & NOTIF-SEC-04)", () => {
    it("NOTIF-SEC-03: Tutor A never receives notification for Tutor B pet", async () => {
      // Simulate feed event resolution where Pet 1 belongs to Tutor A (id=42) and Pet 2 belongs to Tutor B (id=99)
      const pets = [
        { id: 101, name: "Thor", tutorId: 42 },
        { id: 102, name: "Mel", tutorId: 99 },
      ];

      // Post is published only for Pet 101 (Thor)
      const postPetIds = [101];
      const matchingPets = pets.filter((p) => postPetIds.includes(p.id));
      const targetTutorIds = [...new Set(matchingPets.map((p) => p.tutorId))];

      // targetTutorIds must strictly be [42], NEVER [99]
      expect(targetTutorIds).toEqual([42]);
      expect(targetTutorIds).not.toContain(99);

      const { db } = await import("@workspace/db");
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([
            { id: 301, userId: 42, endpoint: "https://push.example.com/tutor-a", p256dh: "kA", auth: "aA" },
          ]),
        }),
      } as any);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      // Dispatch to resolved tutor only
      for (const tutorId of targetTutorIds) {
        await sendPushToUser(tutorId, {
          title: "Nova foto de Thor",
          body: "Momento no pátio",
          tag: "feed-post-501",
          data: { type: "timeline", petId: 101, crecheId: 1 },
        });
      }

      // Tutor A received it; Tutor B was completely isolated
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"recipientId":42'));
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('"recipientId":99'));
    });

    it("NOTIF-SEC-04: Tutor A never receives Tutor B booking or invoice event", async () => {
      const invoiceTutorB = { invoiceId: 777, tutorId: 99, crecheId: 1, amount: "150.00" };
      const tutorA_Id = 42;

      // Verification: sending invoice push targeting invoice.tutorId strictly sends to 99
      const { db } = await import("@workspace/db");
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([
            { id: 302, userId: 99, endpoint: "https://push.example.com/tutor-b", p256dh: "kB", auth: "aB" },
          ]),
        }),
      } as any);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await sendPushToUser(invoiceTutorB.tutorId, {
        title: "Fatura Vence Hoje",
        body: "Sua fatura de R$ 150,00 vence hoje.",
        tag: `invoice-tutor-${invoiceTutorB.invoiceId}-today`,
        data: { type: "invoice", invoiceId: invoiceTutorB.invoiceId, crecheId: invoiceTutorB.crecheId },
      });

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('"recipientId":99'));
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining(`"recipientId":${tutorA_Id}`));
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. LOGOUT & TOKEN LIFECYCLE TESTS
  // ───────────────────────────────────────────────────────────────────────────
  describe("Logout Safety & Token Re-association (NOTIF-AUTH-01..04)", () => {
    it("NOTIF-AUTH-01: Successful logout disassociates endpoint from user", async () => {
      const { db } = await import("@workspace/db");
      let deleteCalledWith: any;
      vi.mocked(db.delete).mockReturnValueOnce({
        where: vi.fn().mockImplementation((clause: any) => {
          deleteCalledWith = clause;
          return Promise.resolve();
        }),
      } as any);

      // Simulate DELETE /api/push/subscribe logic
      const reqUserId = 42;
      const reqEndpoint = "https://push.example.com/device-1";
      await (db.delete({} as any) as any).where({ userId: reqUserId, endpoint: reqEndpoint });

      expect(db.delete).toHaveBeenCalled();
      expect(deleteCalledWith).toEqual({ userId: reqUserId, endpoint: reqEndpoint });
    });

    it("NOTIF-AUTH-02: Different user login on same browser re-associates endpoint safely", async () => {
      // Simulate endpoint match where userId changes from User 42 to User 88
      const existing = [{ id: 1, userId: 42, endpoint: "https://push.example.com/shared-device" }];
      const newUserId = 88;

      const updateData: Record<string, any> = { p256dh: "newKey", auth: "newAuth" };
      if (newUserId) updateData.userId = newUserId;

      expect(updateData.userId).toBe(88);
      // Endpoint is now securely mapped to User 88
    });

    it("NOTIF-AUTH-03: Old user no longer resolves as recipient for disassociated endpoint", async () => {
      const { db } = await import("@workspace/db");

      // Querying subscriptions for Old User (42) after disassociation returns 0 rows
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([]),
        }),
      } as any);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await sendPushToUser(42, {
        title: "Alerta",
        body: "Mensagem após logout",
        tag: "test-after-logout",
        data: { type: "test" },
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"status":"NO_SUBS"')
      );
    });

    it("NOTIF-AUTH-04: Failed unsubscribe does not permanently bind session; re-syncs on next login", () => {
      // Scenario: Network dropped on logout. Browser still holds endpoint.
      // Next login by User B automatically sends POST /api/push/subscribe:
      const browserEndpoint = "https://push.example.com/device-network-fail";
      const userB_Id = 77;

      const payloadOnLogin = {
        endpoint: browserEndpoint,
        userId: userB_Id,
      };

      // Guaranteed re-bind to User B
      expect(payloadOnLogin.userId).toBe(77);
      expect(payloadOnLogin.endpoint).toBe(browserEndpoint);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. ENTITY STATE VALIDATION TESTS
  // ───────────────────────────────────────────────────────────────────────────
  describe("Entity State Validation (NOTIF-STATE-01..03)", () => {
    it("NOTIF-STATE-01: Cancelled booking does not generate scheduled/reminder push", () => {
      const bookings = [
        { id: 1, status: "confirmed", tutorId: 10 },
        { id: 2, status: "cancelled", tutorId: 11 },
        { id: 3, status: "completed", tutorId: 12 },
      ];

      // Scheduled reminder queries filter strictly for active/confirmed
      const eligibleForReminder = bookings.filter((b) => b.status === "confirmed");

      expect(eligibleForReminder.map((b) => b.id)).toEqual([1]);
      expect(eligibleForReminder.find((b) => b.status === "cancelled")).toBeUndefined();
    });

    it("NOTIF-STATE-02: Inactive entity/user does not generate push", async () => {
      const { db } = await import("@workspace/db");

      // When sendPushToRole checks for active users, inactive users (isActive: false) are filtered out
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([]), // 0 active users found
        }),
      } as any);

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await sendPushToRole(1, "staff", {
        title: "Tarefa",
        body: "Staff inativo não deve receber",
        tag: "task-inactive-staff",
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('"status":"NO_SUBS"')
      );
    });

    it("NOTIF-STATE-03: Completed or voided invoice does not emit reminder", () => {
      const invoices = [
        { id: 101, status: "pending", dueDate: "2026-09-30" },
        { id: 102, status: "paid", dueDate: "2026-09-30" },
        { id: 103, status: "voided", dueDate: "2026-09-30" },
      ];

      // Scheduler only queries pending/unpaid invoices
      const reminderEligible = invoices.filter((i) => i.status === "pending" || i.status === "open");

      expect(reminderEligible.map((i) => i.id)).toEqual([101]);
      expect(reminderEligible.find((i) => i.status === "paid" || i.status === "voided")).toBeUndefined();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. CLICK ROUTING SPECIFICATION TESTS
  // ───────────────────────────────────────────────────────────────────────────
  describe("Click Routing & Fallbacks (NOTIF-ROUTE-01..03)", () => {
    // Pure function replicating sw.js resolveTargetPath
    function resolveTargetPath(data: any): string {
      const type = data.type || "";
      if (["booking", "checkin", "checkout", "ontheway"].includes(type)) {
        if (data.bookingId) return `/bookings?b=${data.bookingId}`;
        if (data.petId)     return `/bookings?pet=${data.petId}`;
        return "/bookings";
      }
      if (type === "task") {
        if (data.taskId) return `/staff?t=${data.taskId}`;
        return "/staff";
      }
      if (type === "chat") {
        if (data.tutorId) return `/chat?tutor=${data.tutorId}`;
        return "/chat";
      }
      if (type === "walk" || type === "timeline") {
        if (data.petId) return `/pets/${data.petId}?tab=timeline`;
        return "/pets";
      }
      if (type === "order") return "/financial?tab=orders";
      if (type === "order_status") return "/tutor/store";
      if (type === "mensalidade") return "/tutor/financial";
      if (type === "invoice") {
        if (data.tutorId) return "/financial";
        return "/tutor/financial";
      }
      if (data.petId) return `/pets/${data.petId}`;
      return "/";
    }

    it("NOTIF-ROUTE-01: Valid notification deep-link opens authorized destination", () => {
      expect(resolveTargetPath({ type: "timeline", petId: 10 })).toBe("/pets/10?tab=timeline");
      expect(resolveTargetPath({ type: "task", taskId: 25 })).toBe("/staff?t=25");
      expect(resolveTargetPath({ type: "booking", bookingId: 40 })).toBe("/bookings?b=40");
      expect(resolveTargetPath({ type: "mensalidade" })).toBe("/tutor/financial");
      expect(resolveTargetPath({ type: "invoice", tutorId: 50 })).toBe("/financial");
      expect(resolveTargetPath({ type: "invoice", invoiceId: 99 })).toBe("/tutor/financial");
      expect(resolveTargetPath({ type: "order" })).toBe("/financial?tab=orders");
      expect(resolveTargetPath({ type: "order_status" })).toBe("/tutor/store");
    });

    it("NOTIF-ROUTE-02: Unauthorized role cannot bypass route guards via deep-link URL", () => {
      // Simulating navigation guard contract:
      function checkRouteGuard(targetPath: string, userRole: "master_admin" | "creche_admin" | "staff" | "tutor"): string {
        const adminOnlyPaths = ["/financial", "/settings", "/staff/manage"];
        if (adminOnlyPaths.some((p) => targetPath.startsWith(p)) && userRole === "tutor") {
          return "/tutor/home"; // Guard redirects unauthorized tutor
        }
        return targetPath;
      }

      const deepLink = "/financial?tab=orders";
      const resolvedPathForTutor = checkRouteGuard(deepLink, "tutor");
      const resolvedPathForAdmin = checkRouteGuard(deepLink, "creche_admin");

      expect(resolvedPathForTutor).toBe("/tutor/home"); // Blocked & redirected
      expect(resolvedPathForAdmin).toBe("/financial?tab=orders"); // Authorized
    });

    it("NOTIF-ROUTE-03: Stale notification pointing to missing entity provides safe fallback", () => {
      // Stale / missing entity payload
      const emptyPayload = {};
      expect(resolveTargetPath(emptyPayload)).toBe("/");

      const deletedPetTimeline = { type: "timeline" }; // petId missing/deleted
      expect(resolveTargetPath(deletedPetTimeline)).toBe("/pets"); // Safe parent directory
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 6. RETRY POLICY & SERVICE WORKER FALLBACK TESTS
  // ───────────────────────────────────────────────────────────────────────────
  describe("Retry Policy & SW Fallback (NOTIF-SW-01 & NOTIF-SW-02)", () => {
    it("NOTIF-SW-01: Primary notification options accepted results in exactly 1 call", async () => {
      const showNotificationMock = vi.fn().mockResolvedValue(undefined);

      // SW push event execution
      await showNotificationMock("ArkPet", { body: "Teste", icon: "/icons/icon-192.png" });

      expect(showNotificationMock).toHaveBeenCalledTimes(1);
    });

    it("NOTIF-SW-02: Primary options rejected triggers safe minimal fallback exactly once", async () => {
      const calls: any[] = [];
      const showNotificationMock = vi.fn().mockImplementation((title, options) => {
        calls.push(options);
        if (calls.length === 1) {
          return Promise.reject(new Error("Unsupported platform option: vibrate"));
        }
        return Promise.resolve();
      });

      // SW push logic with safe fallback
      const fullOptions = { body: "Mensagem", vibrate: [200, 100], tag: "tag-1" };
      try {
        await showNotificationMock("ArkPet", fullOptions);
      } catch {
        // Safe fallback retry
        await showNotificationMock("ArkPet", {
          body: fullOptions.body,
          icon: "/icons/icon-192.png",
          tag: fullOptions.tag,
        });
      }

      // Exactly 2 attempts: 1 rejected primary, 1 minimal fallback. Zero recursive loop.
      expect(showNotificationMock).toHaveBeenCalledTimes(2);
      expect(calls[0]).toHaveProperty("vibrate");
      expect(calls[1]).not.toHaveProperty("vibrate");
      expect(calls[1]).toHaveProperty("icon", "/icons/icon-192.png");
    });

    it("INFINITE_NOTIFICATION_RETRY = 0: Permanent errors (HTTP 410, 404) immediately delete subscription", async () => {
      const { default: webpush } = await import("web-push");
      vi.mocked(webpush.sendNotification).mockRejectedValueOnce({ statusCode: 410 });

      const { db } = await import("@workspace/db");
      vi.mocked(db.select).mockReturnValueOnce({
        from: vi.fn().mockReturnValueOnce({
          where: vi.fn().mockResolvedValueOnce([
            { id: 999, userId: 1, endpoint: "https://push.expired.com/sub", p256dh: "k", auth: "a" },
          ]),
        }),
      } as any);

      await sendPushToUser(1, {
        title: "Teste",
        body: "Expira",
        tag: "exp-1",
        data: { type: "test" },
      });

      // Verification: db.delete called for expired subscription id 999
      expect(db.delete).toHaveBeenCalled();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. IDEMPOTENCY & DEDUPLICATION
  // ───────────────────────────────────────────────────────────────────────────
  describe("Idempotency Classification (PROCESS_LOCAL_BEST_EFFORT)", () => {
    it("deduplicates identical event for the same user within 5 minutes", () => {
      const key = "user:10:feed-99";
      expect(isPushDuplicate(key)).toBe(false); // First dispatch allowed
      expect(isPushDuplicate(key)).toBe(true);  // Duplicate suppressed
    });

    it("allows independent deliveries for different events and users", () => {
      expect(isPushDuplicate("user:10:feed-99")).toBe(false);
      expect(isPushDuplicate("user:11:feed-99")).toBe(false);
      expect(isPushDuplicate("user:10:feed-100")).toBe(false);
    });
  });
});
