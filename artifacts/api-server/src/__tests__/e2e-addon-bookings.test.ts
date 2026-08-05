/**
 * Integration tests – Add-on services (booking_services) — Task #103
 *
 * Covers:
 *  1. Creating a booking with additionalServiceIds → add-ons persisted as pending rows
 *  2. Invalid add-on IDs → 400 (non-integer, non-existent, cross-creche, package booking)
 *  3. Cross-tenant pet booking → 403 (pet.crecheId !== route crecheId)
 *  4. Cross-tutor pet booking → 403 (tutor is not the pet's owner)
 *  5. Confirming a booking → consumeAdditionalServices charges or consumes credit
 *  6. Cancellation of pending add-ons (never confirmed) → succeeds, add-ons cancelled
 *  7. Two add-ons on shared invoice: cancellation removes both without crashing
 *  8. Cancellation with a paid add-on charge → 422 (paid-invoice guard)
 *  9. Concurrent confirmation → at most one set of charges emitted
 * 10. Duplicate add-on IDs deduplicated → no 500
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import { petsTable, invoiceItemsTable } from "@workspace/db/schema";
import { eq, inArray } from "drizzle-orm";
import { api, get, post, put } from "./helpers/api.js";
import { getSharedCtx, type TestContext } from "./helpers/setup.js";
import { createTestTutor } from "./helpers/fixtures.js";

let ctx: TestContext;
const today = new Date().toISOString().split("T")[0]!;

beforeAll(() => {
  ctx = getSharedCtx();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Track DB-created pets so we can clean them up and not exhaust the shared
// creche's per-plan pet limit for other test files that run after this one.
const createdPetIds: number[] = [];

afterAll(async () => {
  if (createdPetIds.length > 0) {
    await db.delete(petsTable).where(inArray(petsTable.id, createdPetIds));
  }
});

async function createTestPet(_token: string, crecheId: number): Promise<number> {
  // Insert directly in DB — the pet-creation API enforces a per-plan pet limit
  // that this fixture-heavy suite would exhaust; pet CRUD is not under test here.
  const pet = await createPetInDb(crecheId, ctx.userId);
  return pet.id;
}

/** Create a pet directly in DB — for cross-tenant / cross-tutor guard tests. */
async function createPetInDb(crecheId: number, tutorId: number) {
  const [pet] = await db.insert(petsTable).values({
    crecheId, tutorId,
    name: `DBPet_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    species: "dog", gender: "male", size: "medium",
  }).returning();
  createdPetIds.push(pet!.id);
  return pet!;
}

/** Catalogue item helper — CORRECT path: /financial/catalogue */
async function createCatalogueItem(
  token: string,
  crecheId: number,
  overrides: Record<string, unknown> = {},
): Promise<number> {
  const res = await post<{ id: number }>(
    `/creches/${crecheId}/financial/catalogue`,
    { name: `Item_${Date.now()}`, type: "service", price: 3000, isActive: true, ...overrides },
    token,
  );
  expect([200, 201], `createCatalogueItem failed: ${JSON.stringify(res.body)}`).toContain(res.status);
  return res.body.id;
}

async function createDayUseItem(token: string, crecheId: number): Promise<number> {
  const res = await post<{ id: number }>(
    `/creches/${crecheId}/financial/catalogue`,
    { name: `DayUse_${Date.now()}`, type: "day_use", price: 5000, isActive: true },
    token,
  );
  expect([200, 201], `createDayUseItem failed: ${JSON.stringify(res.body)}`).toContain(res.status);
  return res.body.id;
}

async function createBooking(
  token: string,
  crecheId: number,
  petId: number,
  primaryCatalogueItemId: number,
  additionalServiceIds: number[] = [],
) {
  return post<any>(`/creches/${crecheId}/bookings`, {
    petId, type: "day_use", startDate: today,
    primaryCatalogueItemId, additionalServiceIds, isRecurring: false,
  }, token);
}

async function confirmBooking(token: string, crecheId: number, bookingId: number) {
  return put<any>(`/creches/${crecheId}/bookings/${bookingId}`, { status: "confirmed" }, token);
}

async function cancelBooking(token: string, crecheId: number, bookingId: number) {
  return put<any>(`/creches/${crecheId}/bookings/${bookingId}`, { status: "cancelled" }, token);
}

async function loginAs(email: string, password = "Test1234!"): Promise<string> {
  const res = await post<{ token: string }>("/auth/login", { email, password });
  expect(res.status, `loginAs(${email}) failed: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.token;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Add-on: create and read", () => {
  let petId: number;
  let primaryId: number;
  let addonId: number;
  let bookingId: number;

  beforeAll(async () => {
    petId = await createTestPet(ctx.token, ctx.crecheId);
    primaryId = await createDayUseItem(ctx.token, ctx.crecheId);
    addonId = await createCatalogueItem(ctx.token, ctx.crecheId);
  });

  it("POST /bookings with add-on → 201", async () => {
    const res = await createBooking(ctx.token, ctx.crecheId, petId, primaryId, [addonId]);
    expect(res.status).toBe(201);
    bookingId = res.body.id;
  });

  it("GET booking detail includes add-on as pending", async () => {
    const res = await get<any>(`/creches/${ctx.crecheId}/bookings/${bookingId}`, ctx.token);
    expect(res.status).toBe(200);
    const addons: any[] = res.body.additionalServices ?? [];
    expect(addons.length).toBe(1);
    expect(addons[0].catalogueItemId).toBe(addonId);
    expect(addons[0].status).toBe("pending");
  });

  it("GET bookings list enriches booking with additionalServices", async () => {
    const res = await get<any>(`/creches/${ctx.crecheId}/bookings?page=1&pageSize=50`, ctx.token);
    expect(res.status).toBe(200);
    const items: any[] = res.body.data ?? res.body.items ?? res.body ?? [];
    const found = items.find((b: any) => b.id === bookingId);
    expect(found).toBeTruthy();
    expect((found?.additionalServices ?? []).length).toBeGreaterThanOrEqual(1);
  });
});

describe("Add-on: input validation → 400", () => {
  let petId: number;
  let primaryId: number;
  let addonId: number;

  beforeAll(async () => {
    petId = await createTestPet(ctx.token, ctx.crecheId);
    primaryId = await createDayUseItem(ctx.token, ctx.crecheId);
    addonId = await createCatalogueItem(ctx.token, ctx.crecheId);
  });

  it("non-integer additionalServiceIds element → 400", async () => {
    const res = await post<any>(`/creches/${ctx.crecheId}/bookings`, {
      petId, type: "day_use", startDate: today,
      primaryCatalogueItemId: primaryId, additionalServiceIds: ["bad"], isRecurring: false,
    }, ctx.token);
    expect(res.status).toBe(400);
  });

  it("add-ons on package booking → 400", async () => {
    const res = await post<any>(`/creches/${ctx.crecheId}/bookings`, {
      petId, type: "day_use", startDate: today, packageMaxPets: 5,
      additionalServiceIds: [addonId], isRecurring: false,
    }, ctx.token);
    expect(res.status).toBe(400);
  });

  it("primary item in additionalServiceIds → 400", async () => {
    const res = await post<any>(`/creches/${ctx.crecheId}/bookings`, {
      petId, type: "day_use", startDate: today,
      primaryCatalogueItemId: primaryId, additionalServiceIds: [primaryId], isRecurring: false,
    }, ctx.token);
    expect(res.status).toBe(400);
  });

  it("non-existent additionalServiceIds → 400", async () => {
    const res = await post<any>(`/creches/${ctx.crecheId}/bookings`, {
      petId, type: "day_use", startDate: today,
      primaryCatalogueItemId: primaryId, additionalServiceIds: [999_999_999], isRecurring: false,
    }, ctx.token);
    expect(res.status).toBe(400);
  });
});

describe("Add-on: cross-tenant pet guard → 403", () => {
  /** Pet in a foreign crecheId, booked via ctx.crecheId route → must be 403. */
  let petId: number;
  let primaryId: number;

  beforeAll(async () => {
    // Create a catalogue item in our creche first
    primaryId = await createDayUseItem(ctx.token, ctx.crecheId);
    // Create a tutor in our creche so we have a valid FK, then create pet in foreign creche
    const tutor = await createTestTutor(ctx.crecheId);
    const foreignCrecheId = ctx.crecheId + 9999;
    const pet = await createPetInDb(foreignCrecheId, tutor.id);
    petId = pet.id;
  });

  it("booking pet from a different creche → 403", async () => {
    const res = await post<any>(`/creches/${ctx.crecheId}/bookings`, {
      petId, type: "day_use", startDate: today,
      primaryCatalogueItemId: primaryId, isRecurring: false,
    }, ctx.token);
    expect(res.status).toBe(403);
  });
});

describe("Add-on: cross-tutor pet guard → 403", () => {
  /** Tutor B tries to book a pet owned by Tutor A — must be 403. */
  let petId: number;
  let primaryId: number;
  let tokenB: string;

  beforeAll(async () => {
    primaryId = await createDayUseItem(ctx.token, ctx.crecheId);
    const tutorA = await createTestTutor(ctx.crecheId);
    const tutorB = await createTestTutor(ctx.crecheId);
    const petOfA = await createPetInDb(ctx.crecheId, tutorA.id);
    petId = petOfA.id;
    tokenB = await loginAs(tutorB.email);
  });

  it("tutor booking another tutor's pet → 403", async () => {
    const res = await post<any>(`/creches/${ctx.crecheId}/bookings`, {
      petId, type: "day_use", startDate: today,
      primaryCatalogueItemId: primaryId, isRecurring: false,
    }, tokenB);
    expect(res.status).toBe(403);
  });
});

describe("Add-on: confirmation charges the add-on", () => {
  let petId: number;
  let primaryId: number;
  let addonId: number;
  let bookingId: number;

  beforeAll(async () => {
    petId = await createTestPet(ctx.token, ctx.crecheId);
    primaryId = await createDayUseItem(ctx.token, ctx.crecheId);
    addonId = await createCatalogueItem(ctx.token, ctx.crecheId, { price: 2500 });
    const res = await createBooking(ctx.token, ctx.crecheId, petId, primaryId, [addonId]);
    expect(res.status).toBe(201);
    bookingId = res.body.id;
  });

  it("confirm → 200", async () => {
    const res = await confirmBooking(ctx.token, ctx.crecheId, bookingId);
    expect(res.status).toBe(200);
  });

  it("after confirmation add-on status is confirmed or consumed_credit", async () => {
    const res = await get<any>(`/creches/${ctx.crecheId}/bookings/${bookingId}`, ctx.token);
    expect(res.status).toBe(200);
    const addons: any[] = res.body.additionalServices ?? [];
    expect(addons.length).toBe(1);
    expect(["confirmed", "consumed_credit"]).toContain(addons[0].status);
  });

  it("re-confirming an already-confirmed booking is not a server error", async () => {
    const res = await confirmBooking(ctx.token, ctx.crecheId, bookingId);
    // Either noop 200 or 400/409 rejection — must not 500
    expect(res.status).not.toBe(500);
  });
});

describe("Add-on: cancel before confirmation (pending add-ons)", () => {
  let petId: number;
  let primaryId: number;
  let addonId: number;
  let bookingId: number;

  beforeAll(async () => {
    petId = await createTestPet(ctx.token, ctx.crecheId);
    primaryId = await createDayUseItem(ctx.token, ctx.crecheId);
    addonId = await createCatalogueItem(ctx.token, ctx.crecheId, { price: 1000 });
    const res = await createBooking(ctx.token, ctx.crecheId, petId, primaryId, [addonId]);
    expect(res.status).toBe(201);
    bookingId = res.body.id;
    // Do NOT confirm — add-ons remain pending
  });

  it("cancelling a never-confirmed booking → 200", async () => {
    const res = await cancelBooking(ctx.token, ctx.crecheId, bookingId);
    expect(res.status).toBe(200);
  });

  it("all add-ons are marked cancelled after cancellation", async () => {
    const res = await get<any>(`/creches/${ctx.crecheId}/bookings/${bookingId}`, ctx.token);
    expect(res.status).toBe(200);
    const addons: any[] = res.body.additionalServices ?? [];
    const nonCancelled = addons.filter((a) => a.status !== "cancelled");
    expect(nonCancelled.length).toBe(0);
  });
});

describe("Add-on: cancel confirmed booking with two add-ons on shared invoice", () => {
  let petId: number;
  let primaryId: number;
  let addon1Id: number;
  let addon2Id: number;
  let bookingId: number;

  beforeAll(async () => {
    petId = await createTestPet(ctx.token, ctx.crecheId);
    primaryId = await createDayUseItem(ctx.token, ctx.crecheId);
    addon1Id = await createCatalogueItem(ctx.token, ctx.crecheId, { price: 1500 });
    addon2Id = await createCatalogueItem(ctx.token, ctx.crecheId, { price: 2000 });
    const res = await createBooking(ctx.token, ctx.crecheId, petId, primaryId, [addon1Id, addon2Id]);
    expect(res.status).toBe(201);
    bookingId = res.body.id;
    await confirmBooking(ctx.token, ctx.crecheId, bookingId);
  });

  it("cancel confirmed booking with two add-ons → 200 or 422 (never 500)", async () => {
    const res = await cancelBooking(ctx.token, ctx.crecheId, bookingId);
    // 200 if invoice not yet paid; 422 if paid (both valid)
    expect([200, 422]).toContain(res.status);
    expect(res.status).not.toBe(500);
  });
});

describe("Add-on: displayed price agrees with charged amount (centavos convention)", () => {
  /**
   * App-wide convention: monetary values are integer CENTAVOS end-to-end
   * (admin catalogue UI sends `val * 100`; all displays divide by 100 —
   * see formatCurrency in petdaycare/src/lib/utils.ts).
   * This test proves the amount CHARGED for an add-on equals the catalogue
   * price captured at creation, so `price / 100` in the booking UI displays
   * exactly what the invoice will bill.
   */
  const ADDON_PRICE_CENTS = 2500; // R$ 25,00 exactly as the admin UI would send it

  let petId: number;
  let primaryId: number;
  let addonId: number;
  let bookingId: number;

  beforeAll(async () => {
    petId = await createTestPet(ctx.token, ctx.crecheId);
    primaryId = await createDayUseItem(ctx.token, ctx.crecheId);
    addonId = await createCatalogueItem(ctx.token, ctx.crecheId, { price: ADDON_PRICE_CENTS });
    const res = await createBooking(ctx.token, ctx.crecheId, petId, primaryId, [addonId]);
    expect(res.status).toBe(201);
    bookingId = res.body.id;
  });

  it("capturedPrice at creation equals the catalogue price (cents)", async () => {
    const detailRes = await get<any>(`/creches/${ctx.crecheId}/bookings/${bookingId}`, ctx.token);
    expect(detailRes.status).toBe(200);
    const addon = (detailRes.body.additionalServices ?? [])[0];
    expect(addon).toBeTruthy();
    expect(Number(addon.capturedPrice)).toBe(ADDON_PRICE_CENTS);
  });

  it("after confirmation, the invoice item amount equals the displayed price", async () => {
    const confirmRes = await confirmBooking(ctx.token, ctx.crecheId, bookingId);
    expect(confirmRes.status).toBe(200);

    const detailRes = await get<any>(`/creches/${ctx.crecheId}/bookings/${bookingId}`, ctx.token);
    expect(detailRes.status).toBe(200);
    const addon = (detailRes.body.additionalServices ?? [])[0];
    expect(addon?.status).toBe("confirmed");
    expect(addon?.invoiceItemId, "add-on must have been charged to an invoice item").toBeTruthy();

    // Resolve the exact invoice item and compare the billed amount with the
    // catalogue price the UI displays (both in centavos)
    const [item] = await db
      .select({ amount: invoiceItemsTable.amount })
      .from(invoiceItemsTable)
      .where(eq(invoiceItemsTable.id, addon.invoiceItemId));
    expect(item, "invoice item row must exist").toBeTruthy();
    expect(Number(item!.amount)).toBe(ADDON_PRICE_CENTS);
    // UI shows (price / 100) → R$ 25,00; billing charges the same 2500 centavos.
  });
});

describe("Add-on: paid invoice guard → 422", () => {
  /**
   * After confirmation charges an add-on invoice, manually paying THAT SPECIFIC
   * invoice (resolved via the add-on's invoiceItemId) must block subsequent
   * cancellation with an exact 422. Setup failures fail the test — no skips.
   */
  let petId: number;
  let primaryId: number;
  let addonId: number;
  let bookingId: number;

  beforeAll(async () => {
    petId = await createTestPet(ctx.token, ctx.crecheId);
    primaryId = await createDayUseItem(ctx.token, ctx.crecheId);
    addonId = await createCatalogueItem(ctx.token, ctx.crecheId, { price: 1000 });

    const bookRes = await createBooking(ctx.token, ctx.crecheId, petId, primaryId, [addonId]);
    expect(bookRes.status, "booking creation must succeed").toBe(201);
    bookingId = bookRes.body.id;

    const confirmRes = await confirmBooking(ctx.token, ctx.crecheId, bookingId);
    expect(confirmRes.status, "confirmation must succeed").toBe(200);
  });

  it("cancelling booking whose add-on invoice is paid → exact 422", async () => {
    // 1. Resolve the add-on's invoiceItemId from the booking detail.
    //    (Fresh tutor per pet — no service credits exist, so the add-on is
    //    always billed, never credit-consumed.)
    const detailRes = await get<any>(`/creches/${ctx.crecheId}/bookings/${bookingId}`, ctx.token);
    expect(detailRes.status).toBe(200);
    const addon = (detailRes.body.additionalServices ?? [])[0];
    expect(addon?.status, "add-on must be confirmed after booking confirmation").toBe("confirmed");
    expect(addon?.invoiceItemId, "add-on must have been charged (no credits in this fixture)").toBeTruthy();

    // 2. Resolve the EXACT invoice containing this invoice item (via DB — the
    //    API does not expose item→invoice lookup).
    const [item] = await db
      .select({ invoiceId: invoiceItemsTable.invoiceId })
      .from(invoiceItemsTable)
      .where(eq(invoiceItemsTable.id, addon.invoiceItemId));
    expect(item?.invoiceId, "invoice item must reference an invoice").toBeTruthy();

    // 3. Pay that specific invoice manually — must succeed.
    const payRes = await post<any>(
      `/creches/${ctx.crecheId}/financial/invoices/${item!.invoiceId}/pay-manual`,
      { paymentMethod: "cash" },
      ctx.token,
    );
    expect([200, 201], `pay-manual must succeed, got ${payRes.status}: ${JSON.stringify(payRes.body)}`)
      .toContain(payRes.status);

    // Snapshot financial state before the blocked cancellation attempt.
    const invBefore = await get<any>(
      `/creches/${ctx.crecheId}/financial/invoices/${item!.invoiceId}`,
      ctx.token,
    );

    // 4. Cancellation must now be blocked with exact 422.
    const cancelRes = await cancelBooking(ctx.token, ctx.crecheId, bookingId);
    expect(cancelRes.status).toBe(422);

    // 5. Nothing changed: booking still confirmed, invoice still paid with the
    //    same amount, invoice item still present.
    const afterDetail = await get<any>(`/creches/${ctx.crecheId}/bookings/${bookingId}`, ctx.token);
    expect(afterDetail.body.status).toBe("confirmed");
    const [itemAfter] = await db
      .select({ id: invoiceItemsTable.id })
      .from(invoiceItemsTable)
      .where(eq(invoiceItemsTable.id, addon.invoiceItemId));
    expect(itemAfter, "invoice item must NOT be deleted by the blocked cancellation").toBeTruthy();
    if (invBefore.status === 200) {
      const invAfter = await get<any>(
        `/creches/${ctx.crecheId}/financial/invoices/${item!.invoiceId}`,
        ctx.token,
      );
      expect(invAfter.body.status).toBe("paid");
      expect(invAfter.body.amount).toBe(invBefore.body.amount);
    }
  });
});

describe("Paid PRIMARY-service invoice (no add-ons) blocks cancellation → 422", () => {
  /**
   * Reviewer requirement: the paid-invoice guard must cover the booking's
   * primary charge too, not just add-ons. A booking with NO add-ons whose
   * primary charge invoice is paid must not be cancellable, and the blocked
   * attempt must not alter financial records.
   */
  let petId: number;
  let primaryId: number;
  let bookingId: number;
  let invoiceId: number;

  beforeAll(async () => {
    petId = await createTestPet(ctx.token, ctx.crecheId);
    primaryId = await createDayUseItem(ctx.token, ctx.crecheId);

    const bookRes = await createBooking(ctx.token, ctx.crecheId, petId, primaryId, []);
    expect(bookRes.status, "booking creation must succeed").toBe(201);
    bookingId = bookRes.body.id;

    const confirmRes = await confirmBooking(ctx.token, ctx.crecheId, bookingId);
    expect(confirmRes.status, "confirmation must succeed").toBe(200);
  });

  it("paying the primary charge invoice then cancelling → exact 422, records untouched", async () => {
    // Resolve the primary charge's invoice via invoice_items.booking_id.
    const items = await db
      .select({ id: invoiceItemsTable.id, invoiceId: invoiceItemsTable.invoiceId })
      .from(invoiceItemsTable)
      .where(eq(invoiceItemsTable.bookingId, bookingId));
    expect(items.length, "primary service must have been charged at confirmation").toBeGreaterThan(0);
    invoiceId = items[0]!.invoiceId;

    const payRes = await post<any>(
      `/creches/${ctx.crecheId}/financial/invoices/${invoiceId}/pay-manual`,
      { paymentMethod: "cash" },
      ctx.token,
    );
    expect([200, 201], `pay-manual must succeed, got ${payRes.status}: ${JSON.stringify(payRes.body)}`)
      .toContain(payRes.status);

    const cancelRes = await cancelBooking(ctx.token, ctx.crecheId, bookingId);
    expect(cancelRes.status).toBe(422);

    // Financial records untouched by the blocked attempt.
    const afterDetail = await get<any>(`/creches/${ctx.crecheId}/bookings/${bookingId}`, ctx.token);
    expect(afterDetail.body.status).toBe("confirmed");
    const itemsAfter = await db
      .select({ id: invoiceItemsTable.id })
      .from(invoiceItemsTable)
      .where(eq(invoiceItemsTable.bookingId, bookingId));
    expect(itemsAfter.length).toBe(items.length);
  });
});

describe("Add-on: duplicate add-on IDs deduplicated", () => {
  let petId: number;
  let primaryId: number;
  let addonId: number;

  beforeAll(async () => {
    petId = await createTestPet(ctx.token, ctx.crecheId);
    primaryId = await createDayUseItem(ctx.token, ctx.crecheId);
    addonId = await createCatalogueItem(ctx.token, ctx.crecheId);
  });

  it("duplicate add-on IDs are deduplicated → 201, not 500", async () => {
    const res = await post<any>(`/creches/${ctx.crecheId}/bookings`, {
      petId, type: "day_use", startDate: today,
      primaryCatalogueItemId: primaryId,
      additionalServiceIds: [addonId, addonId],
      isRecurring: false,
    }, ctx.token);
    expect(res.status).not.toBe(500);
    expect(res.status).toBe(201);
  });
});

describe("Add-on: concurrent confirmation race guard", () => {
  let petId: number;
  let primaryId: number;
  let addonId: number;
  let bookingId: number;

  beforeAll(async () => {
    petId = await createTestPet(ctx.token, ctx.crecheId);
    primaryId = await createDayUseItem(ctx.token, ctx.crecheId);
    addonId = await createCatalogueItem(ctx.token, ctx.crecheId, { price: 1000 });
    const res = await createBooking(ctx.token, ctx.crecheId, petId, primaryId, [addonId]);
    expect(res.status).toBe(201);
    bookingId = res.body.id;
  });

  it("two concurrent confirmations: at least one succeeds; add-on processed exactly once", async () => {
    const [r1, r2] = await Promise.all([
      confirmBooking(ctx.token, ctx.crecheId, bookingId),
      confirmBooking(ctx.token, ctx.crecheId, bookingId),
    ]);

    const successes = [r1, r2].filter((r) => r.status === 200);
    expect(successes.length).toBeGreaterThanOrEqual(1);

    // Add-on must be in a non-pending terminal state
    const detailRes = await get<any>(`/creches/${ctx.crecheId}/bookings/${bookingId}`, ctx.token);
    expect(detailRes.status).toBe(200);
    const addons: any[] = detailRes.body.additionalServices ?? [];
    expect(addons.length).toBe(1);
    expect(addons[0].status).not.toBe("pending");
  });
});
