import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  claimGatewayEvent,
  finalizeGatewayEvent,
  recoverStaleGatewayEvents,
  sanitizeGatewayPayload,
  GATEWAY_LEASE_DURATION_MS,
  MAX_GATEWAY_RETRIES,
} from "../services/gatewayEvents.js";
import type { GatewayEvent } from "@workspace/db/schema";

describe("Gateway Events Safety & Idempotency Unit Tests (R36.C)", () => {
  let mockStore: Map<string, GatewayEvent>;
  let mockDb: any;

  beforeEach(() => {
    mockStore = new Map();

    mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation((condition) => ({
            limit: vi.fn().mockImplementation(() => {
              // We search by key
              for (const record of mockStore.values()) {
                return Promise.resolve([record]);
              }
              return Promise.resolve([]);
            }),
          })),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation((val) => ({
          returning: vi.fn().mockImplementation(() => {
            const key = `${val.gateway}:${val.eventId}`;
            const record: GatewayEvent = {
              id: mockStore.size + 1,
              ...val,
              receivedAt: val.receivedAt ?? new Date(),
              processedAt: null,
            };
            mockStore.set(key, record);
            return Promise.resolve([record]);
          }),
        })),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockImplementation((updates) => ({
          where: vi.fn().mockImplementation(() => ({
            returning: vi.fn().mockImplementation(() => {
              const updatedRows: GatewayEvent[] = [];
              for (const [key, existing] of mockStore.entries()) {
                // Determine retry count math if expression
                let newRetry = existing.retryCount;
                if (typeof updates.retryCount === "object") {
                  newRetry = existing.retryCount + 1;
                } else if (typeof updates.retryCount === "number") {
                  newRetry = updates.retryCount;
                }

                const updated = {
                  ...existing,
                  ...updates,
                  retryCount: newRetry,
                };
                mockStore.set(key, updated);
                updatedRows.push(updated);
              }
              return Promise.resolve(updatedRows);
            }),
          })),
        })),
      }),
    };
  });

  it("sanitizes gateway payload to retain routing IDs and strip sensitive tokens", () => {
    const rawStripeEvent = {
      id: "evt_12345",
      type: "customer.subscription.updated",
      created: 1725450000,
      livemode: false,
      data: {
        object: {
          id: "sub_987",
          object: "subscription",
          customer: "cus_abc",
          status: "active",
          billing_reason: "subscription_cycle",
          metadata: { crecheId: "42" },
          // Sensitive data that should NOT be in sanitized payload
          payment_method_details: { card: { cvc: "123", number: "4242" } },
        },
      },
    };

    const sanitized: any = sanitizeGatewayPayload(rawStripeEvent);
    expect(sanitized.id).toBe("evt_12345");
    expect(sanitized.type).toBe("customer.subscription.updated");
    expect(sanitized.object.id).toBe("sub_987");
    expect(sanitized.object.customer).toBe("cus_abc");
    expect(sanitized.object.subscription).toBe("sub_987");
    expect(sanitized.object.metadata).toEqual({ crecheId: "42" });
    expect(sanitized.object.payment_method_details).toBeUndefined();
  });

  it("claims a new event successfully with processing state and 5-minute lease", async () => {
    const event = { id: "evt_new_1", type: "invoice.paid", created: 1725450000 };
    const claim = await claimGatewayEvent(event, "stripe", mockDb);

    expect(claim.shouldProcess).toBe(true);
    expect(claim.status).toBe("processing");
    expect(claim.isNew).toBe(true);
    expect(claim.eventRecord?.eventId).toBe("evt_new_1");
    expect(claim.eventRecord?.retryCount).toBe(0);
    expect(claim.eventRecord?.leaseExpiresAt).toBeDefined();
    expect(mockStore.has("stripe:evt_new_1")).toBe(true);
  });

  it("deduplicates already processed event and returns shouldProcess: false", async () => {
    // Seed processed event
    const now = new Date();
    mockStore.set("stripe:evt_done_1", {
      id: 1,
      gateway: "stripe",
      eventId: "evt_done_1",
      eventType: "invoice.paid",
      eventCreated: now,
      status: "processed",
      retryCount: 0,
      errorMessage: null,
      receivedAt: now,
      processingStartedAt: now,
      leaseExpiresAt: null,
      processedAt: now,
      payload: {},
    });

    const event = { id: "evt_done_1", type: "invoice.paid" };
    const claim = await claimGatewayEvent(event, "stripe", mockDb);

    expect(claim.shouldProcess).toBe(false);
    expect(claim.status).toBe("processed");
    expect(claim.reason).toBe("already_processed");
  });

  it("blocks concurrent in-flight delivery when processing lease is active", async () => {
    const now = new Date();
    const activeLease = new Date(now.getTime() + 4 * 60 * 1000); // 4 min in future
    mockStore.set("stripe:evt_inflight_1", {
      id: 2,
      gateway: "stripe",
      eventId: "evt_inflight_1",
      eventType: "customer.subscription.updated",
      eventCreated: now,
      status: "processing",
      retryCount: 0,
      errorMessage: null,
      receivedAt: now,
      processingStartedAt: now,
      leaseExpiresAt: activeLease,
      processedAt: null,
      payload: {},
    });

    const event = { id: "evt_inflight_1", type: "customer.subscription.updated" };
    const claim = await claimGatewayEvent(event, "stripe", mockDb);

    expect(claim.shouldProcess).toBe(false);
    expect(claim.status).toBe("processing");
    expect(claim.reason).toBe("in_flight");
  });

  it("reclaims stale processing event when lease has expired", async () => {
    const past = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
    mockStore.set("stripe:evt_stale_1", {
      id: 3,
      gateway: "stripe",
      eventId: "evt_stale_1",
      eventType: "invoice.payment_failed",
      eventCreated: past,
      status: "processing",
      retryCount: 0,
      errorMessage: null,
      receivedAt: past,
      processingStartedAt: past,
      leaseExpiresAt: past, // Expired lease
      processedAt: null,
      payload: {},
    });

    const event = { id: "evt_stale_1", type: "invoice.payment_failed" };
    const claim = await claimGatewayEvent(event, "stripe", mockDb);

    expect(claim.shouldProcess).toBe(true);
    expect(claim.status).toBe("processing");
    expect(claim.isReclaim).toBe(true);
    expect(claim.eventRecord?.retryCount).toBe(1);
  });

  it("allows retry for failed_retryable event when retryCount < MAX_GATEWAY_RETRIES", async () => {
    const now = new Date();
    mockStore.set("stripe:evt_failed_1", {
      id: 4,
      gateway: "stripe",
      eventId: "evt_failed_1",
      eventType: "customer.subscription.deleted",
      eventCreated: now,
      status: "failed_retryable",
      retryCount: 2,
      errorMessage: "Transient DB error",
      receivedAt: now,
      processingStartedAt: now,
      leaseExpiresAt: null,
      processedAt: null,
      payload: {},
    });

    const event = { id: "evt_failed_1", type: "customer.subscription.deleted" };
    const claim = await claimGatewayEvent(event, "stripe", mockDb);

    expect(claim.shouldProcess).toBe(true);
    expect(claim.status).toBe("processing");
    expect(claim.isRetry).toBe(true);
    expect(claim.eventRecord?.retryCount).toBe(3);
  });

  it("escalates failed_retryable event to failed_final when max retries exceeded", async () => {
    const now = new Date();
    mockStore.set("stripe:evt_max_retry", {
      id: 5,
      gateway: "stripe",
      eventId: "evt_max_retry",
      eventType: "invoice.paid",
      eventCreated: now,
      status: "failed_retryable",
      retryCount: MAX_GATEWAY_RETRIES,
      errorMessage: "Persistent failure",
      receivedAt: now,
      processingStartedAt: now,
      leaseExpiresAt: null,
      processedAt: null,
      payload: {},
    });

    const event = { id: "evt_max_retry", type: "invoice.paid" };
    const claim = await claimGatewayEvent(event, "stripe", mockDb);

    expect(claim.shouldProcess).toBe(false);
    expect(claim.status).toBe("failed_final");
    expect(claim.reason).toBe("max_retries_exceeded");
  });

  it("finalizes event to processed with processedAt timestamp", async () => {
    const now = new Date();
    mockStore.set("stripe:evt_fin_1", {
      id: 6,
      gateway: "stripe",
      eventId: "evt_fin_1",
      eventType: "invoice.paid",
      eventCreated: now,
      status: "processing",
      retryCount: 0,
      errorMessage: null,
      receivedAt: now,
      processingStartedAt: now,
      leaseExpiresAt: now,
      processedAt: null,
      payload: {},
    });

    const finalized = await finalizeGatewayEvent("evt_fin_1", "processed", undefined, "stripe", mockDb);
    expect(finalized?.status).toBe("processed");
    expect(finalized?.processedAt).toBeDefined();
    expect(finalized?.errorMessage).toBeNull();
  });

  it("stale event background recovery marks expired processing events as failed_retryable", async () => {
    const past = new Date(Date.now() - 10 * 60 * 1000);
    mockStore.set("stripe:evt_swept_1", {
      id: 7,
      gateway: "stripe",
      eventId: "evt_swept_1",
      eventType: "invoice.paid",
      eventCreated: past,
      status: "processing",
      retryCount: 0,
      errorMessage: null,
      receivedAt: past,
      processingStartedAt: past,
      leaseExpiresAt: past,
      processedAt: null,
      payload: {},
    });

    const recoveredCount = await recoverStaleGatewayEvents("stripe", mockDb);
    expect(recoveredCount).toBe(1);
    const updated = mockStore.get("stripe:evt_swept_1");
    expect(updated?.status).toBe("failed_retryable");
    expect(updated?.errorMessage).toContain("Processing lease expired");
  });
});
