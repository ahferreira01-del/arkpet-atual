/**
 * Billing integration tests — BillingService, processManualPayment,
 * voidInvoice, refundInvoice, approveReceipt, and concurrency guard.
 *
 * These tests run against the live test DB (same schema as production).
 * Every test creates isolated fixture data so tests are independent.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@workspace/db";
import { invoicesTable, financialOutboxTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import {
  BillingService,
  processManualPayment,
  voidInvoice,
  refundInvoice,
} from "../services/billing.js";
import { InvoiceRepository } from "../repositories/invoice.repository.js";
import { getSharedCtx, type TestContext } from "./helpers/setup.js";
import {
  createTestTutor,
  bookmarkOutboxId,
  getOutboxEventsSince,
} from "./helpers/fixtures.js";

let ctx: TestContext;

beforeAll(() => {
  ctx = getSharedCtx();
});

// ─── addCharge — monthly cycle behaviour ─────────────────────────────────────

describe("BillingService.addCharge — cycle invoice", () => {
  let tutorId: number;
  let firstInvoiceId: number;

  beforeAll(async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    tutorId = tutor.id;
  });

  it("creates a new monthly cycle invoice for the first charge", async () => {
    firstInvoiceId = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId,
      amount: 50,
      description: "Diária Test",
      type: "service",
      userId: ctx.userId,
    });
    expect(firstInvoiceId).toBeTypeOf("number");
    const inv = await InvoiceRepository.findById(firstInvoiceId);
    expect(inv).toBeTruthy();
    expect(Number(inv!.amount)).toBe(50);
    expect(inv!.status).toBe("pending");
  });

  it("merges a second charge into the same open cycle invoice", async () => {
    const secondInvoiceId = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId,
      amount: 30,
      description: "Serviço adicional",
      type: "service",
      userId: ctx.userId,
    });
    // Must reuse the same invoice
    expect(secondInvoiceId).toBe(firstInvoiceId);
    const inv = await InvoiceRepository.findById(firstInvoiceId);
    expect(Number(inv!.amount)).toBeCloseTo(80, 1); // 50 + 30
  });

  it("creates overflow avulso when the cycle invoice is already paid", async () => {
    // Pay the cycle invoice first
    await processManualPayment(firstInvoiceId, ctx.crecheId, ctx.userId, "cash");

    const overflowId = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId,
      amount: 20,
      description: "Overflow charge",
      type: "service",
      userId: ctx.userId,
    });
    // Must be a brand-new invoice, not the paid one
    expect(overflowId).not.toBe(firstInvoiceId);
    const overflow = await InvoiceRepository.findById(overflowId);
    expect(overflow).toBeTruthy();
    expect(Number(overflow!.amount)).toBe(20);
    expect(overflow!.status).toBe("pending");
  });
});

// ─── addCharge — avulso & existingInvoiceId ──────────────────────────────────
//
// Each test creates its own tutor so avulso invoices (cycleStart=cycleEnd=today)
// do not collide on the (tutorId, cycleStart, cycleEnd) unique index.

describe("BillingService.addCharge — avulso and existingInvoiceId", () => {
  it("creates a standalone avulso invoice when isAvulso=true", async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    const invId = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      amount: 75,
      description: "Venda Avulsa",
      type: "service",
      isAvulso: true,
      userId: ctx.userId,
    });
    const inv = await InvoiceRepository.findById(invId);
    expect(inv).toBeTruthy();
    // Avulso invoices have cycleStart = cycleEnd = today
    expect(inv!.cycleStart).toBe(inv!.cycleEnd);
    expect(Number(inv!.amount)).toBe(75);
  });

  it("appends to an existing invoice when existingInvoiceId is provided", async () => {
    const tutor = await createTestTutor(ctx.crecheId);

    const baseId = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      amount: 40,
      description: "Base item",
      type: "service",
      isAvulso: true,
      userId: ctx.userId,
    });

    const appendId = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      amount: 10,
      description: "Appended item",
      type: "service",
      existingInvoiceId: baseId,
      userId: ctx.userId,
    });

    expect(appendId).toBe(baseId);
    const inv = await InvoiceRepository.findById(baseId);
    expect(Number(inv!.amount)).toBeCloseTo(50, 1); // 40 + 10
  });

  it("throws an error when existingInvoiceId references a non-existent invoice", async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    await expect(
      BillingService.addCharge({
        crecheId: ctx.crecheId,
        tutorId: tutor.id,
        amount: 10,
        description: "Orphan item",
        type: "service",
        existingInvoiceId: 999_999_999,
        userId: ctx.userId,
      }),
    ).rejects.toThrow(/não encontrada|not found/i);
  });
});

// ─── processManualPayment ─────────────────────────────────────────────────────

describe("processManualPayment", () => {
  let tutorId: number;
  let invoiceId: number;

  beforeAll(async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    tutorId = tutor.id;
    invoiceId = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId,
      amount: 100,
      description: "Manual pay test",
      type: "service",
      isAvulso: true,
      userId: ctx.userId,
    });
  });

  it("marks invoice as paid and inserts InvoicePaid outbox event", async () => {
    const bookmark = await bookmarkOutboxId();

    await processManualPayment(invoiceId, ctx.crecheId, ctx.userId, "cash");

    const inv = await InvoiceRepository.findById(invoiceId);
    expect(inv!.status).toBe("paid");
    expect(inv!.paymentMethod).toBe("cash");

    const events = await getOutboxEventsSince(bookmark, "InvoicePaid");
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]!.eventType).toBe("InvoicePaid");
    expect((events[0]!.payload as any).invoiceId).toBe(invoiceId);
  });

  it("rejects a second payment attempt (state machine guard)", async () => {
    await expect(
      processManualPayment(invoiceId, ctx.crecheId, ctx.userId, "pix"),
    ).rejects.toThrow(/inválida|invalid|paid/i);
  });
});

// ─── voidInvoice ──────────────────────────────────────────────────────────────

describe("voidInvoice", () => {
  let tutorId: number;
  let invoiceId: number;

  beforeAll(async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    tutorId = tutor.id;
    invoiceId = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId,
      amount: 60,
      description: "Void test",
      type: "service",
      isAvulso: true,
    });
  });

  it("marks invoice as voided and inserts InvoiceVoided outbox event", async () => {
    const bookmark = await bookmarkOutboxId();

    await voidInvoice(invoiceId, ctx.crecheId, ctx.userId);

    const inv = await InvoiceRepository.findById(invoiceId);
    expect(inv!.status).toBe("voided");

    const events = await getOutboxEventsSince(bookmark, "InvoiceVoided");
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect((events[0]!.payload as any).invoiceId).toBe(invoiceId);
  });
});

// ─── refundInvoice ────────────────────────────────────────────────────────────

describe("refundInvoice", () => {
  let tutorId: number;
  let invoiceId: number;

  beforeAll(async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    tutorId = tutor.id;
    // Create and pay an invoice so it can be refunded
    invoiceId = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId,
      amount: 80,
      description: "Refund test",
      type: "service",
      isAvulso: true,
    });
    await processManualPayment(invoiceId, ctx.crecheId, ctx.userId, "pix");
  });

  it("marks invoice as refunded and inserts InvoiceRefunded outbox event", async () => {
    const bookmark = await bookmarkOutboxId();

    await refundInvoice(invoiceId, ctx.crecheId, ctx.userId);

    const inv = await InvoiceRepository.findById(invoiceId);
    expect(inv!.status).toBe("refunded");

    const events = await getOutboxEventsSince(bookmark, "InvoiceRefunded");
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect((events[0]!.payload as any).invoiceId).toBe(invoiceId);
  });
});

// ─── Anonymous POS concurrency ────────────────────────────────────────────────

describe("BillingService.addCharge — anonymous POS (null tutorId) concurrent sales", () => {
  it("two parallel anonymous sales each create their own independent invoice", async () => {
    // Both sales have tutorId=null (anonymous POS, no customer attached).
    // Without the null-tutorId fix, both would try to insert an invoice with
    // (tutorId=0, cycleStart=today, cycleEnd=today) and hit the unique index.
    const [result1, result2] = await Promise.all([
      BillingService.addCharge({
        crecheId: ctx.crecheId,
        tutorId: null,
        amount: 25,
        description: "Venda Anon 1",
        type: "pos_sale",
        isAvulso: false, // null tutorId must force avulso path even without this flag
      }),
      BillingService.addCharge({
        crecheId: ctx.crecheId,
        tutorId: null,
        amount: 30,
        description: "Venda Anon 2",
        type: "pos_sale",
        isAvulso: false,
      }),
    ]);

    // Must be two distinct invoices
    expect(result1).toBeTypeOf("number");
    expect(result2).toBeTypeOf("number");
    expect(result1).not.toBe(result2);

    const [inv1, inv2] = await Promise.all([
      InvoiceRepository.findById(result1),
      InvoiceRepository.findById(result2),
    ]);
    expect(inv1).toBeTruthy();
    expect(inv2).toBeTruthy();
    // Both must have null tutorId
    expect(inv1!.tutorId).toBeNull();
    expect(inv2!.tutorId).toBeNull();
  });
});

// ─── Concurrency guard ────────────────────────────────────────────────────────

describe("processManualPayment — concurrency (double-payment race)", () => {
  it("two parallel payment attempts on the same invoice: exactly one succeeds", async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    const invoiceId = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      amount: 50,
      description: "Concurrency test",
      type: "service",
      isAvulso: true,
    });

    const results = await Promise.allSettled([
      processManualPayment(invoiceId, ctx.crecheId, ctx.userId, "cash"),
      processManualPayment(invoiceId, ctx.crecheId, ctx.userId, "pix"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    // The invoice must end up paid exactly once
    const inv = await InvoiceRepository.findById(invoiceId);
    expect(inv!.status).toBe("paid");
  });
});
