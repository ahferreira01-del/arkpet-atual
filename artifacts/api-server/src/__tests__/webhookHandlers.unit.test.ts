import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebhookHandlers, dispatchWebhookBusinessLogic } from "../lib/webhookHandlers.js";
import * as gatewayService from "../services/gatewayEvents.js";
import * as subSync from "../lib/subscriptionSync.js";
import * as finSync from "../lib/financialSync.js";
import * as stripeClient from "../lib/stripeClient.js";
import * as platformServices from "../services/platformServices.js";
import type { GatewayEvent } from "@workspace/db/schema";

describe("WebhookHandlers Gateway Integration Regression Tests (R36.C1)", () => {
  let claimSpy: any;
  let finalizeSpy: any;
  let applyStripeEventSpy: any;
  let applyFinancialStripeEventSpy: any;

  beforeEach(() => {
    vi.restoreAllMocks();

    // Mock stripeSync fallback
    vi.spyOn(stripeClient, "getStripeSync").mockResolvedValue({
      processWebhook: vi.fn().mockResolvedValue({}),
    } as any);

    applyStripeEventSpy = vi.spyOn(subSync, "applyStripeEvent").mockResolvedValue();
    applyFinancialStripeEventSpy = vi.spyOn(finSync, "applyFinancialStripeEvent").mockResolvedValue();
  });

  it("normal first delivery claims lease, executes canonical dispatcher, and finalizes as processed", async () => {
    const rawEvent = {
      id: "evt_normal_1",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1", customer: "cus_1" } },
    };
    const payloadBuffer = Buffer.from(JSON.stringify(rawEvent));

    claimSpy = vi.spyOn(gatewayService, "claimGatewayEvent").mockResolvedValue({
      shouldProcess: true,
      status: "processing",
      isNew: true,
    });
    finalizeSpy = vi.spyOn(gatewayService, "finalizeGatewayEvent").mockResolvedValue(null);

    await WebhookHandlers.processWebhook(payloadBuffer, "sig_valid");

    expect(claimSpy).toHaveBeenCalledWith(expect.objectContaining({ id: "evt_normal_1" }), "stripe");
    expect(applyStripeEventSpy).toHaveBeenCalledWith(expect.objectContaining({ id: "evt_normal_1" }));
    expect(applyFinancialStripeEventSpy).toHaveBeenCalledWith(expect.objectContaining({ id: "evt_normal_1" }));
    expect(finalizeSpy).toHaveBeenCalledWith("evt_normal_1", "processed", undefined, "stripe");
  });

  it("duplicate delivery of already processed event skips synchronization completely", async () => {
    const rawEvent = {
      id: "evt_duplicate_1",
      type: "invoice.paid",
      data: { object: { id: "in_1" } },
    };
    const payloadBuffer = Buffer.from(JSON.stringify(rawEvent));

    claimSpy = vi.spyOn(gatewayService, "claimGatewayEvent").mockResolvedValue({
      shouldProcess: false,
      status: "processed",
      reason: "already_processed",
    });
    finalizeSpy = vi.spyOn(gatewayService, "finalizeGatewayEvent");

    await WebhookHandlers.processWebhook(payloadBuffer, "sig_valid");

    expect(claimSpy).toHaveBeenCalled();
    // Synchronization was NOT called for duplicate!
    expect(applyStripeEventSpy).not.toHaveBeenCalled();
    expect(applyFinancialStripeEventSpy).not.toHaveBeenCalled();
    expect(finalizeSpy).not.toHaveBeenCalled();
  });

  it("transient subscription sync failure finalizes event as failed_retryable and propagates error", async () => {
    const rawEvent = {
      id: "evt_transient_fail",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1" } },
    };
    const payloadBuffer = Buffer.from(JSON.stringify(rawEvent));

    claimSpy = vi.spyOn(gatewayService, "claimGatewayEvent").mockResolvedValue({
      shouldProcess: true,
      status: "processing",
      isNew: true,
    });
    finalizeSpy = vi.spyOn(gatewayService, "finalizeGatewayEvent").mockResolvedValue(null);
    applyStripeEventSpy.mockRejectedValue(new Error("Connection to database timed out"));

    await expect(WebhookHandlers.processWebhook(payloadBuffer, "sig_valid")).rejects.toThrow(
      "Connection to database timed out",
    );

    expect(finalizeSpy).toHaveBeenCalledWith(
      "evt_transient_fail",
      "failed_retryable",
      "Connection to database timed out",
      "stripe",
    );
  });

  it("stale processing event reclaimed by gateway can execute and finalize", async () => {
    const rawEvent = {
      id: "evt_reclaimed_1",
      type: "invoice.paid",
      data: { object: { id: "in_2" } },
    };
    const payloadBuffer = Buffer.from(JSON.stringify(rawEvent));

    claimSpy = vi.spyOn(gatewayService, "claimGatewayEvent").mockResolvedValue({
      shouldProcess: true,
      status: "processing",
      isReclaim: true,
    });
    finalizeSpy = vi.spyOn(gatewayService, "finalizeGatewayEvent").mockResolvedValue(null);

    await WebhookHandlers.processWebhook(payloadBuffer, "sig_valid");

    expect(applyStripeEventSpy).toHaveBeenCalled();
    expect(finalizeSpy).toHaveBeenCalledWith("evt_reclaimed_1", "processed", undefined, "stripe");
  });

  it("terminal failed_final event skips execution", async () => {
    const rawEvent = {
      id: "evt_terminal_fail",
      type: "invoice.paid",
      data: { object: { id: "in_3" } },
    };
    const payloadBuffer = Buffer.from(JSON.stringify(rawEvent));

    claimSpy = vi.spyOn(gatewayService, "claimGatewayEvent").mockResolvedValue({
      shouldProcess: false,
      status: "failed_final",
      reason: "failed_final_terminal",
    });
    finalizeSpy = vi.spyOn(gatewayService, "finalizeGatewayEvent");

    await WebhookHandlers.processWebhook(payloadBuffer, "sig_valid");

    expect(applyStripeEventSpy).not.toHaveBeenCalled();
    expect(finalizeSpy).not.toHaveBeenCalled();
  });

  it("proves that an event reconstructed from the persisted recovery representation executes through canonical dispatchWebhookBusinessLogic successfully (Section 6 Replay Test)", async () => {
    // 1. A persisted event record in gateway_events
    const persistedRecord: GatewayEvent = {
      id: 99,
      gateway: "stripe",
      eventId: "evt_replay_test_99",
      eventType: "customer.subscription.updated",
      eventCreated: new Date(1725450000 * 1000),
      status: "failed_retryable",
      retryCount: 1,
      errorMessage: "Previous transient timeout",
      receivedAt: new Date(),
      processingStartedAt: new Date(),
      leaseExpiresAt: new Date(),
      processedAt: null,
      payload: {
        id: "evt_replay_test_99",
        type: "customer.subscription.updated",
        created: 1725450000,
        livemode: false,
        data: {
          object: {
            id: "sub_replay_1",
            customer: "cus_replay_1",
            status: "active",
            items: {
              data: [
                {
                  id: "si_replay_1",
                  price: { id: "price_pro_month" },
                  current_period_end: 1728000000,
                },
              ],
            },
          },
        },
      },
    };

    // 2. Reconstruct event from record
    const reconstructedEvent = gatewayService.reconstructReplayEvent(persistedRecord);
    expect(reconstructedEvent.id).toBe("evt_replay_test_99");
    expect(reconstructedEvent.data.object.id).toBe("sub_replay_1");

    // 3. Dispatch through canonical business dispatcher
    await dispatchWebhookBusinessLogic(reconstructedEvent);

    // 4. Verify canonical handlers were invoked with the reconstructed event shape
    expect(applyStripeEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "evt_replay_test_99",
        type: "customer.subscription.updated",
        data: expect.objectContaining({
          object: expect.objectContaining({
            id: "sub_replay_1",
            customer: "cus_replay_1",
          }),
        }),
      }),
    );
    expect(applyFinancialStripeEventSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "evt_replay_test_99",
      }),
    );
  });

  it("R36.G1 Section 13: ASSISTED_IMPLEMENTATION checkout.session.completed early returns, calls platform handler once, 0 tenant invoice writes, 0 subscription sync calls", async () => {
    const platformSpy = vi.spyOn(platformServices, "handlePlatformServicePaymentWebhook").mockResolvedValue(undefined);

    const platformEvent = {
      id: "evt_assisted_impl_test_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_assisted_test_123",
          mode: "payment",
          payment_status: "paid",
          metadata: {
            serviceType: "ASSISTED_IMPLEMENTATION",
            serviceRequestId: "42",
            crecheId: "10",
          },
        },
      },
    };

    await dispatchWebhookBusinessLogic(platformEvent);

    // Platform handler called with exact session object
    expect(platformSpy).toHaveBeenCalledTimes(1);
    expect(platformSpy).toHaveBeenCalledWith(platformEvent.data.object);

    // Tenant billing handlers were NOT called (zero tenant invoice writes)
    expect(applyStripeEventSpy).not.toHaveBeenCalled();
    expect(applyFinancialStripeEventSpy).not.toHaveBeenCalled();
  });
});
