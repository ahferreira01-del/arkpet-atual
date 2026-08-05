/**
 * Credits integration tests — releasePurchasedCredits, consumePackageCredits,
 * consumeServiceCreditsForBooking, restoreBookingPackageCredits,
 * restoreBookingServiceCredits.
 *
 * All tests create isolated fixture data and verify DB state directly.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@workspace/db";
import {
  invoicesTable,
  invoiceItemsTable,
  tutorCreditsTable,
  tutorServiceCreditsTable,
  bookingCreditsTable,
  bookingServiceCreditsTable,
  bookingsTable,
  petsTable,
  catalogueItemsTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import {
  releasePurchasedCredits,
  consumePackageCredits,
  consumeServiceCreditsForBooking,
  restoreBookingPackageCredits,
  restoreBookingServiceCredits,
} from "../services/credits.js";
import { CreditRepository } from "../repositories/credit.repository.js";
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

// ─── Helper: insert a pet row ─────────────────────────────────────────────────

async function insertTestPet(crecheId: number, tutorId: number) {
  const rows = await (db as any)
    .insert(petsTable)
    .values({
      crecheId,
      tutorId,
      name: `Pet Teste ${Date.now()}-${Math.random()}`,
      species: "dog",
      breed: "SRD",
      gender: "unknown",
      size: "medium",
      isCastrated: false,
      isCheckedIn: false,
      status: "active",
    })
    .returning() as typeof petsTable.$inferSelect[];
  return rows[0]!;
}

// ─── Helper: insert a booking row ─────────────────────────────────────────────

async function insertTestBooking(
  crecheId: number,
  tutorId: number,
  petId: number,
  type = "day_use",
) {
  const today = new Date().toISOString().split("T")[0]!;
  const rows = await db
    .insert(bookingsTable)
    .values({
      crecheId,
      tutorId,
      petId,
      startDate: today,
      endDate: today,
      status: "confirmed",
      type,
      isRecurring: false,
    })
    .returning();
  return rows[0]!;
}

// ─── Helper: create a package invoice ready for credit release ─────────────────

async function createPackageInvoiceReady(
  crecheId: number,
  tutorId: number,
  creditsAmount: number,
) {
  const [item] = await db
    .insert(catalogueItemsTable)
    .values({
      crecheId,
      name: `Pacote ${creditsAmount}d ${Date.now()}`,
      type: "package",
      basePrice: "300.00",
      isActive: true,
      stockQuantity: 0,
      creditsAmount,
      maxPetsPerDay: 1,
    } as typeof catalogueItemsTable.$inferInsert)
    .returning();

  const today = new Date().toISOString().split("T")[0]!;
  const [invoice] = await db
    .insert(invoicesTable)
    .values({
      crecheId,
      tutorId,
      dueDate: today,
      amount: "300.00",
      status: "pending",
    } as typeof invoicesTable.$inferInsert)
    .returning();

  await db.insert(invoiceItemsTable).values({
    invoiceId: invoice!.id,
    description: item!.name,
    amount: "300.00",
    quantity: 1,
    itemType: "package",
    catalogueItemId: item!.id,
    creditsAmount,
    snapshotName: item!.name,
    snapshotPrice: "300.00",
    snapshotMaxPets: 1,
    snapshotExpirationDays: 365,
  } as typeof invoiceItemsTable.$inferInsert);

  return { invoice: invoice!, item: item! };
}

// ─── releasePurchasedCredits ──────────────────────────────────────────────────

describe("releasePurchasedCredits", () => {
  it("releases package credits from invoice snapshot and marks creditsReleased", async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    const { invoice } = await createPackageInvoiceReady(
      ctx.crecheId,
      tutor.id,
      10,
    );
    const bookmark = await bookmarkOutboxId();

    await db.transaction(async (tx) => {
      await releasePurchasedCredits(invoice.id, ctx.userId, tx);
    });

    // Credits row should be inserted
    const credits = await db
      .select()
      .from(tutorCreditsTable)
      .where(
        and(
          eq(tutorCreditsTable.tutorId, tutor.id),
          eq(tutorCreditsTable.crecheId, ctx.crecheId),
        ),
      );
    expect(credits.length).toBeGreaterThanOrEqual(1);
    const credit = credits.find((c) => c.totalCredits === 10);
    expect(credit).toBeTruthy();
    expect(credit!.usedCredits).toBe(0);

    // Invoice creditsReleased flag should be true
    const inv = await InvoiceRepository.findById(invoice.id);
    expect(inv!.creditsReleased).toBe(true);

    // CreditsReleased outbox event
    const events = await getOutboxEventsSince(bookmark, "CreditsReleased");
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent — a second call does not double-release credits", async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    const { invoice } = await createPackageInvoiceReady(
      ctx.crecheId,
      tutor.id,
      5,
    );

    // First release
    await db.transaction(async (tx) => {
      await releasePurchasedCredits(invoice.id, ctx.userId, tx);
    });

    const beforeRows = await db
      .select()
      .from(tutorCreditsTable)
      .where(eq(tutorCreditsTable.tutorId, tutor.id));

    // Second release — must be a no-op
    await db.transaction(async (tx) => {
      await releasePurchasedCredits(invoice.id, ctx.userId, tx);
    });

    const afterRows = await db
      .select()
      .from(tutorCreditsTable)
      .where(eq(tutorCreditsTable.tutorId, tutor.id));

    expect(afterRows.length).toBe(beforeRows.length);
  });
});

// ─── consumePackageCredits ────────────────────────────────────────────────────

describe("consumePackageCredits", () => {
  let tutorId: number;
  let creditId: number;
  let bookingId: number;

  beforeAll(async () => {
    const tutor = await createTestTutor(ctx.crecheId);
    tutorId = tutor.id;

    const credit = await CreditRepository.createPackageCredits({
      crecheId: ctx.crecheId,
      tutorId,
      totalCredits: 10,
      usedCredits: 0,
      maxPetsPerDay: 1,
      expirationDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
    });
    creditId = credit.id;

    const pet = await insertTestPet(ctx.crecheId, tutorId);
    const booking = await insertTestBooking(ctx.crecheId, tutorId, pet.id);
    bookingId = booking.id;
  });

  it("consumes package credits for a booking period", async () => {
    const bookmark = await bookmarkOutboxId();
    const today = new Date();

    const result = await db.transaction(async (tx) => {
      return consumePackageCredits(
        bookingId,
        tutorId,
        ctx.crecheId,
        today,
        today,
        1,
        tx,
      );
    });

    expect(result.totalConsumedNormal).toBe(1);
    expect(result.daysToBill).toBe(0);

    // Credit row should have usedCredits incremented
    const [credit] = await db
      .select()
      .from(tutorCreditsTable)
      .where(eq(tutorCreditsTable.id, creditId));
    expect(credit!.usedCredits).toBe(1);

    // Booking credit row should exist
    const bookingCredits = await db
      .select()
      .from(bookingCreditsTable)
      .where(eq(bookingCreditsTable.bookingId, bookingId));
    expect(bookingCredits.length).toBe(1);
    expect(bookingCredits[0]!.creditsConsumed).toBe(1);

    // CreditsConsumed outbox event
    const events = await getOutboxEventsSince(bookmark, "CreditsConsumed");
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent — a second call does not consume an extra credit", async () => {
    const today = new Date();

    await db.transaction(async (tx) => {
      return consumePackageCredits(
        bookingId,
        tutorId,
        ctx.crecheId,
        today,
        today,
        1,
        tx,
      );
    });

    // usedCredits must still be 1 — not incremented again
    const [credit] = await db
      .select()
      .from(tutorCreditsTable)
      .where(eq(tutorCreditsTable.id, creditId));
    expect(credit!.usedCredits).toBe(1);
  });
});

// ─── consumeServiceCreditsForBooking ─────────────────────────────────────────

describe("consumeServiceCreditsForBooking", () => {
  it("consumes service credits matched by catalogueItemId", async () => {
    const tutor = await createTestTutor(ctx.crecheId);

    const [catItem] = await db
      .insert(catalogueItemsTable)
      .values({
        crecheId: ctx.crecheId,
        name: `Banho Teste ${Date.now()}`,
        type: "service",
        basePrice: "50.00",
        isActive: true,
        stockQuantity: 0,
        maxPetsPerDay: 1,
      } as typeof catalogueItemsTable.$inferInsert)
      .returning();

    await db.insert(tutorServiceCreditsTable).values({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      catalogueItemId: catItem!.id,
      totalCredits: 5,
      usedCredits: 0,
    } as typeof tutorServiceCreditsTable.$inferInsert);

    const pet = await insertTestPet(ctx.crecheId, tutor.id);
    const booking = await insertTestBooking(
      ctx.crecheId,
      tutor.id,
      pet.id,
      "banho",
    );
    const bookmark = await bookmarkOutboxId();

    const remaining = await db.transaction(async (tx) => {
      return consumeServiceCreditsForBooking(
        booking.id,
        tutor.id,
        ctx.crecheId,
        { id: catItem!.id, type: "service", name: catItem!.name },
        1,
        ctx.userId,
        tx,
      );
    });

    // 1 credit consumed → 0 days to bill
    expect(remaining).toBe(0);

    const [sc] = await db
      .select()
      .from(tutorServiceCreditsTable)
      .where(
        and(
          eq(tutorServiceCreditsTable.tutorId, tutor.id),
          eq(tutorServiceCreditsTable.catalogueItemId, catItem!.id),
        ),
      );
    expect(sc!.usedCredits).toBe(1);

    // CreditsConsumed outbox event
    const events = await getOutboxEventsSince(bookmark, "CreditsConsumed");
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent — a second call does not double-consume credits", async () => {
    const tutor = await createTestTutor(ctx.crecheId);

    const [catItem] = await db
      .insert(catalogueItemsTable)
      .values({
        crecheId: ctx.crecheId,
        name: `Banho Idem ${Date.now()}`,
        type: "service",
        basePrice: "50.00",
        isActive: true,
        stockQuantity: 0,
        maxPetsPerDay: 1,
      } as typeof catalogueItemsTable.$inferInsert)
      .returning();

    await db.insert(tutorServiceCreditsTable).values({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      catalogueItemId: catItem!.id,
      totalCredits: 3,
      usedCredits: 0,
    } as typeof tutorServiceCreditsTable.$inferInsert);

    const pet = await insertTestPet(ctx.crecheId, tutor.id);
    const booking = await insertTestBooking(
      ctx.crecheId,
      tutor.id,
      pet.id,
      "banho",
    );

    const catalogueRef = { id: catItem!.id, type: "service" as const, name: catItem!.name };

    // First call
    await db.transaction(async (tx) =>
      consumeServiceCreditsForBooking(
        booking.id,
        tutor.id,
        ctx.crecheId,
        catalogueRef,
        1,
        ctx.userId,
        tx,
      ),
    );

    // Second call — must be a no-op
    await db.transaction(async (tx) =>
      consumeServiceCreditsForBooking(
        booking.id,
        tutor.id,
        ctx.crecheId,
        catalogueRef,
        1,
        ctx.userId,
        tx,
      ),
    );

    const [sc] = await db
      .select()
      .from(tutorServiceCreditsTable)
      .where(
        and(
          eq(tutorServiceCreditsTable.tutorId, tutor.id),
          eq(tutorServiceCreditsTable.catalogueItemId, catItem!.id),
        ),
      );
    // usedCredits must still be 1 (not 2)
    expect(sc!.usedCredits).toBe(1);
  });
});

// ─── restoreBookingPackageCredits ─────────────────────────────────────────────

describe("restoreBookingPackageCredits", () => {
  it("restores consumed package credits and emits CreditsRestored", async () => {
    const tutor = await createTestTutor(ctx.crecheId);

    const credit = await CreditRepository.createPackageCredits({
      crecheId: ctx.crecheId,
      tutorId: tutor.id,
      totalCredits: 5,
      usedCredits: 0,
      maxPetsPerDay: 1,
      expirationDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0],
    });

    const pet = await insertTestPet(ctx.crecheId, tutor.id);
    const booking = await insertTestBooking(ctx.crecheId, tutor.id, pet.id);

    // Consume 1 credit
    await db.transaction(async (tx) => {
      await consumePackageCredits(
        booking.id,
        tutor.id,
        ctx.crecheId,
        new Date(),
        new Date(),
        1,
        tx,
      );
    });

    const [before] = await db
      .select()
      .from(tutorCreditsTable)
      .where(eq(tutorCreditsTable.id, credit.id));
    expect(before!.usedCredits).toBe(1);

    const bookmark = await bookmarkOutboxId();

    // Restore credits
    await db.transaction(async (tx) => {
      await restoreBookingPackageCredits(booking.id, tx, ctx.crecheId);
    });

    const [updated] = await db
      .select()
      .from(tutorCreditsTable)
      .where(eq(tutorCreditsTable.id, credit.id));
    expect(updated!.usedCredits).toBe(0); // fully restored

    const events = await getOutboxEventsSince(bookmark, "CreditsRestored");
    expect(events.length).toBeGreaterThanOrEqual(1);
  });
});
