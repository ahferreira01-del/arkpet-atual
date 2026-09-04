import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebhookHandlers } from "../lib/webhookHandlers.js";
import * as gatewayService from "../services/gatewayEvents.js";
import * as subSync from "../lib/subscriptionSync.js";
import * as finSync from "../lib/financialSync.js";
import * as stripeClient from "../lib/stripeClient.js";

describe("WebhookHandlers Gateway Integration Regression Tests (R36.C)", () => {
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

  it("normal first delivery claims lease, executes synchronization, and finalizes as processed", async () => {
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
});
