/**
 * Billing integration tests — BillingService, processManualPayment,
 * voidInvoice, refundInvoice, approveReceipt, and concurrency guard.
 *
 * These tests run against the live test DB (same schema as production).
 * Every test creates isolated fixture data so tests are independent.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@workspace/db";
import {
  invoicesTable,
  invoiceItemsTable,
  financialOutboxTable,
  ordersTable,
} from "@workspace/db/schema";
import { eq, and, count } from "drizzle-orm";
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
  createCatalogueItem,
  bookmarkOutboxId,
  getOutboxEventsSince,
} from "./helpers/fixtures.js";
import { getBusinessDate } from "../lib/date.js";
import { createOrder, cancelOrder } from "../services/orders.js";
import { releasePurchasedCredits } from "../services/credits.js";

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
    ({ invoiceId: firstInvoiceId } = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId,
      amount: 50,
      description: "Diária Test",
      type: "service",
      userId: ctx.userId,
    }));
    expect(firstInvoiceId).toBeTypeOf("number");
    const inv = await InvoiceRepository.findById(firstInvoiceId);
    expect(inv).toBeTruthy();
    expect(Number(inv!.amount)).toBe(50);
    expect(inv!.status).toBe("pending");
  });

  it("merges a second charge into the same open cycle invoice", async () => {
    const { invoiceId: secondInvoiceId } = await BillingService.addCharge({
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

  it("creates a normal successor cycle when the original cycle is already paid", async () => {
    // Pay the cycle invoice first
    await processManualPayment(firstInvoiceId, ctx.crecheId, ctx.userId, "cash");
    const frozen = await InvoiceRepository.findById(firstInvoiceId);

    const { invoiceId: successorId } = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId,
      amount: 20,
      description: "Successor charge",
      type: "service",
      userId: ctx.userId,
    });
    // Must be a brand-new invoice, not the paid one
    expect(successorId).not.toBe(firstInvoiceId);
    const successor = await InvoiceRepository.findById(successorId);
    expect(successor).toBeTruthy();
    expect(Number(successor!.amount)).toBe(20);
    expect(successor!.status).toBe("pending");
    expect(successor!.cycleStart).not.toBeNull();
    expect(successor!.cycleEnd).not.toBeNull();
    expect(successor!.dueDate > frozen!.dueDate).toBe(true);
  });
});

// ─── addCharge — avulso & existingInvoiceId ──────────────────────────────────
//
// Each test creates its own tutor so avulso invoices (cycleStart=cycleEnd=today)
// do not collide on the (tutorId, cycleStart, cycleEnd) unique index.

describe("BillingService.addCharge — avulso and existingInvoiceId", () => {
  it("creates a standalone avulso invoice when isAvulso=true", async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    const { invoiceId: invId } = await BillingService.addCharge({
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
    // Avulso invoices do not participate in the monthly collector.
    expect(inv!.cycleStart).toBeNull();
    expect(inv!.cycleEnd).toBeNull();
    expect(Number(inv!.amount)).toBe(75);
  });

  it("appends to an existing invoice when existingInvoiceId is provided", async () => {
    const tutor = await createTestTutor(ctx.crecheId);

    const { invoiceId: baseId } = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      amount: 40,
      description: "Base item",
      type: "service",
      isAvulso: true,
      userId: ctx.userId,
    });

    const { invoiceId: appendId } = await BillingService.addCharge({
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
    ).rejects.toThrow(/não pertence|não encontrada|not found/i);
  });
});

// ─── Receivables collector safety ─────────────────────────────────────────────

describe("BillingService.addCharge — receivables collector safety", () => {
  it.each([
    "awaiting_confirmation",
    "paid",
    "overdue",
    "voided",
    "refunded",
  ] as const)("keeps a %s invoice frozen and routes the charge to a successor", async (status) => {
    const tutor = await createTestTutor(ctx.crecheId);
    const { invoiceId: frozenId } = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      amount: 40,
      description: `Frozen ${status}`,
      type: "service",
    });
    const frozenBefore = await InvoiceRepository.findById(frozenId);

    await db
      .update(invoicesTable)
      .set({ status })
      .where(eq(invoicesTable.id, frozenId));

    const { invoiceId: successorId } = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      amount: 15,
      description: `After ${status}`,
      type: "service",
    });

    const [frozenAfter, successor] = await Promise.all([
      InvoiceRepository.findById(frozenId),
      InvoiceRepository.findById(successorId),
    ]);
    expect(successorId).not.toBe(frozenId);
    expect(frozenAfter!.amount).toBe(frozenBefore!.amount);
    expect(frozenAfter!.status).toBe(status);
    expect(successor!.cycleStart).not.toBeNull();
    expect(successor!.cycleEnd).not.toBeNull();
    expect(successor!.dueDate > frozenBefore!.dueDate).toBe(true);
  });

  it("treats pending with dueDate before the business date as frozen", async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    const { invoiceId: expiredId } = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      amount: 25,
      description: "Expired pending",
      type: "service",
    });
    const expiredBefore = await InvoiceRepository.findById(expiredId);
    const yesterday = new Date(`${getBusinessDate()}T12:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    await db
      .update(invoicesTable)
      .set({ dueDate: yesterday.toISOString().split("T")[0] })
      .where(eq(invoicesTable.id, expiredId));

    const { invoiceId: successorId } = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      amount: 10,
      description: "After expired pending",
      type: "service",
    });

    expect(successorId).not.toBe(expiredId);
    const [expiredAfter, successor] = await Promise.all([
      InvoiceRepository.findById(expiredId),
      InvoiceRepository.findById(successorId),
    ]);
    expect(expiredAfter!.amount).toBe(expiredBefore!.amount);
    expect(expiredAfter!.status).toBe("pending");
    expect(successor!.cycleStart).not.toBeNull();
    expect(successor!.cycleEnd).not.toBeNull();
  });

  it("rejects existingInvoiceId from another tutor or creche without mutation", async () => {
    const owner = await createTestTutor(ctx.crecheId);
    const otherTutor = await createTestTutor(ctx.crecheId);
    const { invoiceId } = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId: owner.id,
      amount: 40,
      description: "Standalone owner",
      type: "service",
      isAvulso: true,
    });

    await expect(
      BillingService.addCharge({
        crecheId: ctx.crecheId,
        tutorId: otherTutor.id,
        amount: 10,
        description: "Wrong tutor",
        existingInvoiceId: invoiceId,
      }),
    ).rejects.toThrow(/não pertence/i);

    await expect(
      BillingService.addCharge({
        crecheId: ctx.crecheId + 100_000,
        tutorId: owner.id,
        amount: 10,
        description: "Wrong tenant",
        existingInvoiceId: invoiceId,
      }),
    ).rejects.toThrow(/não pertence/i);

    expect(Number((await InvoiceRepository.findById(invoiceId))!.amount)).toBe(40);
  });

  it("rejects a frozen or wrong-period existingInvoiceId without mutation", async () => {
    const frozenTutor = await createTestTutor(ctx.crecheId);
    const { invoiceId: frozenId } = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId: frozenTutor.id,
      amount: 30,
      description: "Will freeze",
      type: "service",
      isAvulso: true,
    });
    await db
      .update(invoicesTable)
      .set({ status: "awaiting_confirmation" })
      .where(eq(invoicesTable.id, frozenId));

    await expect(
      BillingService.addCharge({
        crecheId: ctx.crecheId,
        tutorId: frozenTutor.id,
        amount: 5,
        description: "Must reject frozen hint",
        existingInvoiceId: frozenId,
      }),
    ).rejects.toThrow(/congelada|expirado/i);

    const periodTutor = await createTestTutor(ctx.crecheId);
    const { invoiceId: currentId } = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId: periodTutor.id,
      amount: 35,
      description: "Current period",
      type: "service",
    });
    const current = await InvoiceRepository.findById(currentId);
    const nextPeriodDate = new Date(`${current!.cycleEnd}T12:00:00Z`);
    nextPeriodDate.setUTCDate(nextPeriodDate.getUTCDate() + 1);

    await expect(
      BillingService.addCharge({
        crecheId: ctx.crecheId,
        tutorId: periodTutor.id,
        amount: 5,
        description: "Wrong period hint",
        itemDate: nextPeriodDate,
        existingInvoiceId: currentId,
      }),
    ).rejects.toThrow(/coletor editável|período/i);

    expect(Number((await InvoiceRepository.findById(currentId))!.amount)).toBe(35);
  });

  it("serializes concurrent charges into exactly one collector", async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    const [first, second] = await Promise.all([
      BillingService.addCharge({
        crecheId: ctx.crecheId,
        tutorId: tutor.id,
        amount: 12,
        description: "Concurrent A",
      }),
      BillingService.addCharge({
        crecheId: ctx.crecheId,
        tutorId: tutor.id,
        amount: 18,
        description: "Concurrent B",
      }),
    ]);

    expect(first.invoiceId).toBe(second.invoiceId);
    const invoice = await InvoiceRepository.findById(first.invoiceId);
    expect(Number(invoice!.amount)).toBe(30);
    const [{ total }] = await db
      .select({ total: count() })
      .from(invoiceItemsTable)
      .where(eq(invoiceItemsTable.invoiceId, first.invoiceId));
    expect(Number(total)).toBe(2);
  });

  it("serializes concurrent successor creation after a frozen cycle", async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    const { invoiceId: frozenId } = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      amount: 50,
      description: "Frozen origin",
    });
    await db
      .update(invoicesTable)
      .set({ status: "paid" })
      .where(eq(invoicesTable.id, frozenId));

    const [first, second] = await Promise.all([
      BillingService.addCharge({
        crecheId: ctx.crecheId,
        tutorId: tutor.id,
        amount: 7,
        description: "Successor A",
      }),
      BillingService.addCharge({
        crecheId: ctx.crecheId,
        tutorId: tutor.id,
        amount: 8,
        description: "Successor B",
      }),
    ]);

    expect(first.invoiceId).toBe(second.invoiceId);
    expect(first.invoiceId).not.toBe(frozenId);
    const successor = await InvoiceRepository.findById(first.invoiceId);
    expect(Number(successor!.amount)).toBe(15);
    expect(successor!.cycleStart).not.toBeNull();
    expect(successor!.cycleEnd).not.toBeNull();
  });

  it("rolls back invoice and item creation with the caller transaction", async () => {
    const tutor = await createTestTutor(ctx.crecheId);

    await expect(
      db.transaction(async (tx) => {
        await BillingService.addCharge({
          crecheId: ctx.crecheId,
          tutorId: tutor.id,
          amount: 22,
          description: "Rollback charge",
          tx,
        });
        throw new Error("force rollback");
      }),
    ).rejects.toThrow("force rollback");

    const [{ total }] = await db
      .select({ total: count() })
      .from(invoicesTable)
      .where(
        and(
          eq(invoicesTable.crecheId, ctx.crecheId),
          eq(invoicesTable.tutorId, tutor.id),
        ),
      );
    expect(Number(total)).toBe(0);
  });

  it("rejects item refund on expired pending invoice without mutation", async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    const { invoiceId, invoiceItemId } = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      amount: 33,
      description: "Expired refund guard",
    });
    const yesterday = new Date(`${getBusinessDate()}T12:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    await db
      .update(invoicesTable)
      .set({ dueDate: yesterday.toISOString().split("T")[0] })
      .where(eq(invoicesTable.id, invoiceId));

    await expect(
      BillingService.refundItem({
        invoiceId,
        crecheId: ctx.crecheId,
        invoiceItemId,
        quantity: 1,
        userId: ctx.userId,
      }),
    ).rejects.toThrow(/congelada/i);

    const [invoice, item] = await Promise.all([
      InvoiceRepository.findById(invoiceId),
      db
        .select()
        .from(invoiceItemsTable)
        .where(eq(invoiceItemsTable.id, invoiceItemId))
        .then((rows) => rows[0]),
    ]);
    expect(Number(invoice!.amount)).toBe(33);
    expect(item).toBeTruthy();
  });
});

// ─── processManualPayment ─────────────────────────────────────────────────────

describe("processManualPayment", () => {
  let tutorId: number;
  let invoiceId: number;

  beforeAll(async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    tutorId = tutor.id;
    ({ invoiceId } = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId,
      amount: 100,
      description: "Manual pay test",
      type: "service",
      isAvulso: true,
      userId: ctx.userId,
    }));
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
    ({ invoiceId } = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId,
      amount: 60,
      description: "Void test",
      type: "service",
      isAvulso: true,
    }));
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
    ({ invoiceId } = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId,
      amount: 80,
      description: "Refund test",
      type: "service",
      isAvulso: true,
    }));
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
    const [r1, r2] = await Promise.all([
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
    const result1 = r1.invoiceId;
    const result2 = r2.invoiceId;

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
    const { invoiceId } = await BillingService.addCharge({
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

  it("payment and order cancellation never deadlock on invoice/order locks", async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    const item = await createCatalogueItem(ctx.crecheId, {
      type: "service",
      basePrice: "20.00",
      trackStock: false,
    });
    const { result } = await createOrder({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      items: [{ catalogueItemId: item.id, quantity: 1 }],
      deliveryMethod: "pickup",
      deliveryFee: 0,
    });

    const outcomes = await Promise.allSettled([
      processManualPayment(
        result.invoice!.id,
        ctx.crecheId,
        ctx.userId,
        "cash",
      ),
      cancelOrder({
        order: result.order,
        crecheId: ctx.crecheId,
        userId: ctx.userId,
      }),
    ]);

    const deadlocks = outcomes.filter(
      (outcome) =>
        outcome.status === "rejected" &&
        (outcome.reason as { code?: string })?.code === "40P01",
    );
    expect(deadlocks).toHaveLength(0);
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
  });

  it("payment and order status credit release never deadlock", async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    const item = await createCatalogueItem(ctx.crecheId, {
      type: "service",
      basePrice: "18.00",
      trackStock: false,
      creditsAmount: 1,
    });
    const { result } = await createOrder({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      items: [{ catalogueItemId: item.id, quantity: 1 }],
      deliveryMethod: "pickup",
      deliveryFee: 0,
    });

    const outcomes = await Promise.allSettled([
      processManualPayment(
        result.invoice!.id,
        ctx.crecheId,
        ctx.userId,
        "cash",
      ),
      db.transaction(async (tx) => {
        await tx
          .select({ id: ordersTable.id })
          .from(ordersTable)
          .where(eq(ordersTable.id, result.order.id))
          .for("update");
        await releasePurchasedCredits(result.invoice!.id, ctx.userId, tx);
      }),
    ]);

    const deadlocks = outcomes.filter(
      (outcome) =>
        outcome.status === "rejected" &&
        (outcome.reason as { code?: string })?.code === "40P01",
    );
    expect(deadlocks).toHaveLength(0);
    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(true);
  });

  it("order cancellation preserves an expired pending invoice", async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    const item = await createCatalogueItem(ctx.crecheId, {
      type: "service",
      basePrice: "25.00",
      trackStock: false,
    });
    const { result } = await createOrder({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      items: [{ catalogueItemId: item.id, quantity: 1 }],
      deliveryMethod: "pickup",
      deliveryFee: 0,
    });
    const yesterday = new Date(`${getBusinessDate()}T12:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const expiredDueDate = yesterday.toISOString().split("T")[0];
    await db
      .update(invoicesTable)
      .set({ dueDate: expiredDueDate })
      .where(eq(invoicesTable.id, result.invoice!.id));

    const cancelled = await cancelOrder({
      order: result.order,
      crecheId: ctx.crecheId,
      userId: ctx.userId,
    });

    const invoice = await InvoiceRepository.findById(result.invoice!.id);
    expect(cancelled.status).toBe("cancelled");
    expect(invoice!.status).toBe("pending");
    expect(invoice!.dueDate).toBe(expiredDueDate);
    expect(Number(invoice!.amount)).toBe(25);
  });
});
