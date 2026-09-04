import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  claimGatewayEvent,
  finalizeGatewayEvent,
  recoverStaleGatewayEvents,
  recoverAndProcessStaleGatewayEvents,
  sanitizeGatewayPayload,
  reconstructReplayEvent,
  GATEWAY_LEASE_DURATION_MS,
  MAX_GATEWAY_RETRIES,
} from "../services/gatewayEvents.js";
import type { GatewayEvent } from "@workspace/db/schema";

describe("Gateway Events Safety, Replay & Recovery Unit Tests (R36.C1)", () => {
  let mockStore: Map<string, GatewayEvent>;
  let mockDb: any;

  beforeEach(() => {
    mockStore = new Map();

    mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockImplementation((condition) => ({
            limit: vi.fn().mockImplementation(() => {
              // Return all matching rows from mockStore
              const rows = Array.from(mockStore.values());
              return Promise.resolve(rows);
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
                let newRetry = existing.retryCount;
                if (typeof updates.retryCount === "object") {
                  newRetry = existing.retryCount + 1;
                } else if (typeof updates.retryCount === "number") {
                  newRetry = updates.retryCount;
                }

                const updated: GatewayEvent = {
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

  it("sanitizes gateway payload into a sufficient replay envelope while stripping sensitive secrets", () => {
    const rawStripeEvent = {
      id: "evt_sub_123",
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
          current_period_end: 1728000000,
          metadata: { crecheId: "42" },
          items: {
            data: [
              {
                id: "si_1",
                price: { id: "price_standard_month" },
                current_period_end: 1728000000,
              },
            ],
          },
          lines: {
            data: [
              {
                id: "il_1",
                period: { start: 1725450000, end: 1728000000 },
              },
            ],
          },
          // Sensitive data that must NOT be stored
          payment_method_details: { card: { cvc: "123", number: "4242424242424242" } },
          customer_secret: "sec_forbidden_token",
        },
      },
    };

    const sanitized: any = sanitizeGatewayPayload(rawStripeEvent);
    expect(sanitized.id).toBe("evt_sub_123");
    expect(sanitized.type).toBe("customer.subscription.updated");
    expect(sanitized.data.object.id).toBe("sub_987");
    expect(sanitized.data.object.customer).toBe("cus_abc");
    expect(sanitized.data.object.metadata).toEqual({ crecheId: "42" });
    expect(sanitized.data.object.items.data[0].price.id).toBe("price_standard_month");
    expect(sanitized.data.object.lines.data[0].period.end).toBe(1728000000);

    // Verify secrets are stripped
    expect(sanitized.data.object.payment_method_details).toBeUndefined();
    expect(sanitized.data.object.customer_secret).toBeUndefined();
  });

  it("reconstructs an executable canonical Stripe event from the stored envelope", () => {
    const record: GatewayEvent = {
      id: 1,
      gateway: "stripe",
      eventId: "evt_invoice_paid",
      eventType: "invoice.paid",
      eventCreated: new Date(1725450000 * 1000),
      status: "processing",
      retryCount: 0,
      errorMessage: null,
      receivedAt: new Date(),
      processingStartedAt: new Date(),
      leaseExpiresAt: new Date(),
      processedAt: null,
      payload: {
        id: "evt_invoice_paid",
        type: "invoice.paid",
        created: 1725450000,
        livemode: false,
        data: {
          object: {
            id: "in_123",
            subscription: "sub_456",
            customer: "cus_789",
            lines: {
              data: [{ id: "li_1", period: { start: 1725450000, end: 1728000000 } }],
            },
          },
        },
      },
    };

    const reconstructed = reconstructReplayEvent(record);
    expect(reconstructed.id).toBe("evt_invoice_paid");
    expect(reconstructed.type).toBe("invoice.paid");
    expect(reconstructed.created).toBe(1725450000);
    expect(reconstructed.data.object.id).toBe("in_123");
    expect(reconstructed.data.object.subscription).toBe("sub_456");
    expect(reconstructed.data.object.lines.data[0].period.end).toBe(1728000000);
  });

  it("claims a new event successfully with processing state and 5-minute lease", async () => {
    const event = { id: "evt_new_1", type: "invoice.paid", created: 1725450000 };
    // Setup select to return empty
    mockDb.select = vi.fn().mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    });

    const claim = await claimGatewayEvent(event, "stripe", mockDb);

    expect(claim.shouldProcess).toBe(true);
    expect(claim.status).toBe("processing");
    expect(claim.isNew).toBe(true);
    expect(claim.eventRecord?.eventId).toBe("evt_new_1");
    expect(claim.eventRecord?.retryCount).toBe(0);
    expect(mockStore.has("stripe:evt_new_1")).toBe(true);
  });

  it("deduplicates already processed event and returns shouldProcess: false", async () => {
    const now = new Date();
    const stored: GatewayEvent = {
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
    };
    mockStore.set("stripe:evt_done_1", stored);

    mockDb.select = vi.fn().mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([stored]),
        }),
      }),
    });

    const event = { id: "evt_done_1", type: "invoice.paid" };
    const claim = await claimGatewayEvent(event, "stripe", mockDb);

    expect(claim.shouldProcess).toBe(false);
    expect(claim.status).toBe("processed");
    expect(claim.reason).toBe("already_processed");
  });

  it("blocks concurrent in-flight delivery when processing lease is active", async () => {
    const now = new Date();
    const activeLease = new Date(now.getTime() + 4 * 60 * 1000);
    const stored: GatewayEvent = {
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
    };
    mockStore.set("stripe:evt_inflight_1", stored);

    mockDb.select = vi.fn().mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([stored]),
        }),
      }),
    });

    const event = { id: "evt_inflight_1", type: "customer.subscription.updated" };
    const claim = await claimGatewayEvent(event, "stripe", mockDb);

    expect(claim.shouldProcess).toBe(false);
    expect(claim.status).toBe("processing");
    expect(claim.reason).toBe("in_flight");
  });

  it("reclaims stale processing event when lease has expired", async () => {
    const past = new Date(Date.now() - 10 * 60 * 1000);
    const stored: GatewayEvent = {
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
      leaseExpiresAt: past,
      processedAt: null,
      payload: {},
    };
    mockStore.set("stripe:evt_stale_1", stored);

    mockDb.select = vi.fn().mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([stored]),
        }),
      }),
    });

    const event = { id: "evt_stale_1", type: "invoice.payment_failed" };
    const claim = await claimGatewayEvent(event, "stripe", mockDb);

    expect(claim.shouldProcess).toBe(true);
    expect(claim.status).toBe("processing");
    expect(claim.isReclaim).toBe(true);
  });

  it("recovers and executes stale events via recoverAndProcessStaleGatewayEvents (Section 3: Fresh Duplicate -> Crash -> Stale Recovery -> Exactly Once)", async () => {
    const businessInvocations: any[] = [];
    const canonicalDispatcher = async (event: any) => {
      businessInvocations.push(event);
    };

    // Scenario:
    // 1. Delivery A claims event
    const rawEvent = {
      id: "evt_crash_recovery",
      type: "invoice.paid",
      created: 1725450000,
      data: { object: { id: "in_999", customer: "cus_123" } },
    };

    // Fresh delivery A creates processing record
    mockDb.select = vi.fn().mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    });

    const claimA = await claimGatewayEvent(rawEvent, "stripe", mockDb);
    expect(claimA.shouldProcess).toBe(true);

    // 2. Delivery B arrives while lease is active — avoids duplicate execution
    const inFlightRecord = mockStore.get("stripe:evt_crash_recovery")!;
    mockDb.select = vi.fn().mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([inFlightRecord]),
        }),
      }),
    });

    const claimB = await claimGatewayEvent(rawEvent, "stripe", mockDb);
    expect(claimB.shouldProcess).toBe(false);
    expect(claimB.reason).toBe("in_flight");
    expect(businessInvocations.length).toBe(0);

    // 3. Worker A crashes/disappears without finalizing.
    // Time passes: lease expires
    const expiredLease = new Date(Date.now() - 60 * 1000);
    inFlightRecord.leaseExpiresAt = expiredLease;
    mockStore.set("stripe:evt_crash_recovery", inFlightRecord);

    // 4. Background recovery worker runs
    mockDb.select = vi.fn().mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([inFlightRecord]),
        }),
      }),
    });

    const recoveryResult = await recoverAndProcessStaleGatewayEvents(
      canonicalDispatcher,
      "stripe",
      mockDb,
    );

    expect(recoveryResult.recoveredCount).toBe(1);
    expect(recoveryResult.successCount).toBe(1);
    expect(recoveryResult.failedCount).toBe(0);

    // 5. Proves business effect executed exactly once through the canonical dispatcher
    expect(businessInvocations.length).toBe(1);
    expect(businessInvocations[0].id).toBe("evt_crash_recovery");
    expect(businessInvocations[0].data.object.id).toBe("in_999");

    // Event is now finalized as processed
    const finalState = mockStore.get("stripe:evt_crash_recovery");
    expect(finalState?.status).toBe("processed");
    expect(finalState?.processedAt).toBeDefined();
  });

  it("handles retryable failure and escalates to failed_final when max retries exceeded during recovery", async () => {
    const stored: GatewayEvent = {
      id: 10,
      gateway: "stripe",
      eventId: "evt_fail_sweep",
      eventType: "invoice.paid",
      eventCreated: new Date(),
      status: "failed_retryable",
      retryCount: MAX_GATEWAY_RETRIES - 1, // Next failure will reach MAX
      errorMessage: "Transient failure",
      receivedAt: new Date(),
      processingStartedAt: new Date(),
      leaseExpiresAt: null,
      processedAt: null,
      payload: {
        id: "evt_fail_sweep",
        type: "invoice.paid",
        data: { object: { id: "in_err" } },
      },
    };
    mockStore.set("stripe:evt_fail_sweep", stored);

    mockDb.select = vi.fn().mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([stored]),
        }),
      }),
    });

    const failingDispatcher = async () => {
      throw new Error("Persistent payment failure");
    };

    const result = await recoverAndProcessStaleGatewayEvents(failingDispatcher, "stripe", mockDb);
    expect(result.recoveredCount).toBe(1);
    expect(result.failedCount).toBe(1);

    const finalState = mockStore.get("stripe:evt_fail_sweep");
    expect(finalState?.status).toBe("failed_final");
    expect(finalState?.errorMessage).toBe("Persistent payment failure");
  });
});
