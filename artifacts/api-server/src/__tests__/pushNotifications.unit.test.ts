import { describe, it, expect, beforeEach, vi } from "vitest";
import { isPushDuplicate, clearPushDedupCache, logPushAudit, type PushPayload } from "../lib/push.js";

describe("Push Notifications Reliability & Deduplication (R40.A)", () => {
  beforeEach(() => {
    clearPushDedupCache();
    vi.restoreAllMocks();
  });

  describe("Sliding window deduplication (DUPLICATE_NOTIFICATION_FOR_SAME_EVENT = 0)", () => {
    it("permits the first event notification", () => {
      const key = "user:42:feed-101";
      expect(isPushDuplicate(key)).toBe(false);
    });

    it("suppresses identical event notifications within the sliding window", () => {
      const key = "user:42:feed-101";
      expect(isPushDuplicate(key)).toBe(false);
      // Immediate re-send of the exact same event must be identified as duplicate
      expect(isPushDuplicate(key)).toBe(true);
      expect(isPushDuplicate(key)).toBe(true);
    });

    it("distinguishes between different recipients for the same event tag", () => {
      expect(isPushDuplicate("user:42:feed-101")).toBe(false);
      expect(isPushDuplicate("user:43:feed-101")).toBe(false);
    });

    it("distinguishes between different event tags for the same recipient", () => {
      expect(isPushDuplicate("user:42:feed-101")).toBe(false);
      expect(isPushDuplicate("user:42:feed-102")).toBe(false);
      expect(isPushDuplicate("user:42:booking-205-confirmed")).toBe(false);
    });

    it("resets deduplication when cache is cleared", () => {
      const key = "user:42:feed-101";
      expect(isPushDuplicate(key)).toBe(false);
      expect(isPushDuplicate(key)).toBe(true);

      clearPushDedupCache();
      expect(isPushDuplicate(key)).toBe(false);
    });
  });

  describe("Structured audit logging without sensitive data leakage", () => {
    it("emits structured audit logs with technical fields only", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      logPushAudit({
        recipientId: 42,
        eventType: "timeline",
        subCount: 1,
        tag: "feed-101",
        status: "SENT",
      });

      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const logOutput = consoleSpy.mock.calls[0][0];
      expect(logOutput).toContain("[push-audit]");

      const jsonStr = logOutput.replace("[push-audit] ", "");
      const parsed = JSON.parse(jsonStr);

      expect(parsed.recipientId).toBe(42);
      expect(parsed.eventType).toBe("timeline");
      expect(parsed.subCount).toBe(1);
      expect(parsed.tag).toBe("feed-101");
      expect(parsed.status).toBe("SENT");
      expect(parsed.timestamp).toBeDefined();

      // Zero sensitive fields
      expect(parsed.password).toBeUndefined();
      expect(parsed.passwordHash).toBeUndefined();
      expect(parsed.token).toBeUndefined();
      expect(parsed.cpf).toBeUndefined();
      expect(parsed.phone).toBeUndefined();
      expect(parsed.clinicalNotes).toBeUndefined();
    });

    it("records DEDUP_SKIPPED and NO_SUBS safely", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      logPushAudit({
        recipientId: 99,
        eventType: "invoice",
        subCount: 0,
        tag: "invoice-tutor-5-today",
        status: "NO_SUBS",
      });

      logPushAudit({
        recipientId: "role:creche_admin:1",
        eventType: "booking",
        tag: "booking-req-12",
        status: "DEDUP_SKIPPED",
      });

      expect(consoleSpy).toHaveBeenCalledTimes(2);
      const call1 = JSON.parse(consoleSpy.mock.calls[0][0].replace("[push-audit] ", ""));
      const call2 = JSON.parse(consoleSpy.mock.calls[1][0].replace("[push-audit] ", ""));

      expect(call1.status).toBe("NO_SUBS");
      expect(call2.status).toBe("DEDUP_SKIPPED");
    });
  });
});
