/**
 * Outbox integration tests — OutboxRepository, worker retry/dead-letter,
 * and event atomicity (event committed iff main write commits).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@workspace/db";
import { financialOutboxTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { OutboxRepository } from "../repositories/outbox.repository.js";
import {
  BillingService,
  processManualPayment,
  voidInvoice,
} from "../services/billing.js";
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

// ─── OutboxRepository primitives ──────────────────────────────────────────────

describe("OutboxRepository", () => {
  it("insert creates a pending event inside a transaction", async () => {
    const bookmark = await bookmarkOutboxId();

    await db.transaction(async (tx) => {
      await OutboxRepository.insert(
        {
          type: "InvoiceVoided",
          crecheId: ctx.crecheId,
          invoiceId: 1,
          tutorId: null,
          occurredAt: new Date().toISOString(),
        },
        tx,
      );
    });

    const events = await getOutboxEventsSince(bookmark, "InvoiceVoided");
    expect(events.length).toBeGreaterThanOrEqual(1);

    const event = events[0]!;
    expect(event.status).toBe("pending");
    expect(event.retryCount).toBe(0);
    expect(event.processedAt).toBeNull();
  });

  it("markProcessed sets status=processed and stamps processedAt", async () => {
    const bookmark = await bookmarkOutboxId();

    // Insert a test event
    await db.transaction(async (tx) => {
      await OutboxRepository.insert(
        {
          type: "InvoicePaid",
          crecheId: ctx.crecheId,
          invoiceId: 1,
          tutorId: null,
          amount: "10.00",
          paymentMethod: "cash",
          occurredAt: new Date().toISOString(),
        },
        tx,
      );
    });

    const events = await getOutboxEventsSince(bookmark);
    const id = events[0]!.id;

    await OutboxRepository.markProcessed(id);

    const [updated] = await db
      .select()
      .from(financialOutboxTable)
      .where(eq(financialOutboxTable.id, id));

    expect(updated.status).toBe("processed");
    expect(updated.processedAt).not.toBeNull();
  });

  it("markFailed sets status=failed and increments retryCount", async () => {
    const bookmark = await bookmarkOutboxId();

    await db.transaction(async (tx) => {
      await OutboxRepository.insert(
        {
          type: "OrderCancelled",
          crecheId: ctx.crecheId,
          invoiceId: 1,
          occurredAt: new Date().toISOString(),
        },
        tx,
      );
    });

    const events = await getOutboxEventsSince(bookmark);
    const id = events[0]!.id;

    await OutboxRepository.markFailed(id, "simulated failure");

    const [updated] = await db
      .select()
      .from(financialOutboxTable)
      .where(eq(financialOutboxTable.id, id));

    expect(updated.status).toBe("failed");
    expect(updated.retryCount).toBe(1);
  });

  it("rollback prevents event insertion (atomicity guarantee)", async () => {
    const bookmark = await bookmarkOutboxId();

    // Simulate a transaction that inserts an event then rolls back
    try {
      await db.transaction(async (tx) => {
        await OutboxRepository.insert(
          {
            type: "OrderPaid",
            crecheId: ctx.crecheId,
            invoiceId: 99_999_999,
            occurredAt: new Date().toISOString(),
          },
          tx,
        );
        // Force rollback
        throw new Error("intentional rollback");
      });
    } catch {
      // expected
    }

    // The event must NOT appear in the outbox
    const events = await getOutboxEventsSince(bookmark, "OrderPaid");
    const leakedEvents = events.filter(
      (e) => (e.payload as any).invoiceId === 99_999_999,
    );
    expect(leakedEvents.length).toBe(0);
  });
});

// ─── Event types emitted by payment operations ────────────────────────────────

describe("Payment operations emit expected outbox events", () => {
  it("processManualPayment emits InvoicePaid", async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    const { invoiceId: invId } = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      amount: 42,
      description: "Outbox event test",
      type: "service",
      isAvulso: true,
    });

    const bookmark = await bookmarkOutboxId();
    await processManualPayment(invId, ctx.crecheId, ctx.userId, "cash");

    const paid = await getOutboxEventsSince(bookmark, "InvoicePaid");
    expect(paid.length).toBeGreaterThanOrEqual(1);

    const event = paid[0]!;
    expect(event.eventType).toBe("InvoicePaid");
    expect((event.payload as any).crecheId).toBe(ctx.crecheId);
    expect((event.payload as any).invoiceId).toBe(invId);
  });

  it("voidInvoice emits InvoiceVoided", async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    const { invoiceId: invId } = await BillingService.addCharge({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      amount: 55,
      description: "Void outbox test",
      type: "service",
      isAvulso: true,
    });

    const bookmark = await bookmarkOutboxId();
    await voidInvoice(invId, ctx.crecheId, ctx.userId);

    const voided = await getOutboxEventsSince(bookmark, "InvoiceVoided");
    expect(voided.length).toBeGreaterThanOrEqual(1);
    expect((voided[0]!.payload as any).invoiceId).toBe(invId);
  });
});

// ─── Outbox worker simulation ─────────────────────────────────────────────────

describe("Outbox worker — per-event-per-transaction processing", () => {
  it("markProcessed on one event does not affect other pending events", async () => {
    const bookmark = await bookmarkOutboxId();

    // Insert two events
    await db.transaction(async (tx) => {
      await OutboxRepository.insert(
        {
          type: "InvoicePaid",
          crecheId: ctx.crecheId,
          invoiceId: 2,
          tutorId: null,
          amount: "1.00",
          paymentMethod: "cash",
          occurredAt: new Date().toISOString(),
        },
        tx,
      );
    });

    await db.transaction(async (tx) => {
      await OutboxRepository.insert(
        {
          type: "InvoiceVoided",
          crecheId: ctx.crecheId,
          invoiceId: 3,
          tutorId: null,
          occurredAt: new Date().toISOString(),
        },
        tx,
      );
    });

    const events = await getOutboxEventsSince(bookmark);
    expect(events.length).toBe(2);

    // Process only the first one
    await OutboxRepository.markProcessed(events[0]!.id);

    const [first] = await db
      .select()
      .from(financialOutboxTable)
      .where(eq(financialOutboxTable.id, events[0]!.id));
    const [second] = await db
      .select()
      .from(financialOutboxTable)
      .where(eq(financialOutboxTable.id, events[1]!.id));

    expect(first.status).toBe("processed");
    expect(second.status).toBe("pending"); // unaffected
  });
});
