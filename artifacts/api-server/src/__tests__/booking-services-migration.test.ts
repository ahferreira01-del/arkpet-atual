/**
 * Migration upgrade-path test — Task #103
 *
 * Proves `ensureBookingServicesSchema()` is genuinely additive: starting from
 * a LEGACY / PARTIAL `booking_services` table (as an early deployment might
 * have created it — missing invoice_item_id, captured_price, charged,
 * tutor_service_credit_id, consumed_credit, quantity, updated_at), running the
 * startup migration must bring the table to the full schema without data loss,
 * and the live add-on flow (create → confirm/charge → cancel) must work on the
 * upgraded table.
 *
 * The test backs up existing rows, rebuilds the table in the legacy shape,
 * runs the migration, exercises the API flow, and restores the backup rows.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@workspace/db";
import { petsTable } from "@workspace/db/schema";
import { sql, inArray } from "drizzle-orm";
import { get, post, put } from "./helpers/api.js";
import { getSharedCtx, type TestContext } from "./helpers/setup.js";
import { ensureBookingServicesSchema } from "../startup.js";

let ctx: TestContext;
const today = new Date().toISOString().split("T")[0]!;

const BACKUP = "booking_services_migtest_backup";
const REQUIRED_COLUMNS = [
  "id",
  "booking_id",
  "catalogue_item_id",
  "quantity",
  "status",
  "consumed_credit",
  "tutor_service_credit_id",
  "charged",
  "invoice_item_id",
  "captured_price",
  "created_at",
  "updated_at",
];

const createdPetIds: number[] = [];

async function exec(query: string) {
  return (db as any).execute(query);
}

async function tableColumns(table: string): Promise<string[]> {
  const res = await exec(
    `SELECT column_name FROM information_schema.columns WHERE table_name = '${table}'`,
  );
  const rows = res.rows ?? res;
  return rows.map((r: any) => r.column_name);
}

beforeAll(async () => {
  ctx = getSharedCtx();

  // 1. Back up whatever rows exist today (full-schema copy).
  await exec(`DROP TABLE IF EXISTS ${BACKUP}`);
  await exec(`CREATE TABLE ${BACKUP} AS SELECT * FROM booking_services`);

  // 2. Rebuild booking_services in the LEGACY partial shape an early
  //    deployment could have left behind. Only the bare-minimum columns.
  await exec(`DROP TABLE booking_services`);
  await exec(`
    CREATE TABLE booking_services (
      id                SERIAL PRIMARY KEY,
      booking_id        INTEGER NOT NULL,
      catalogue_item_id INTEGER NOT NULL,
      status            booking_service_status NOT NULL DEFAULT 'pending',
      created_at        TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  // Keep new ids clear of the backed-up ids so restore cannot collide.
  await exec(`
    SELECT setval('booking_services_id_seq',
      (SELECT COALESCE(MAX(id), 0) + 1000 FROM ${BACKUP}))
  `);
  // A legacy row that must survive the migration untouched.
  await exec(`
    INSERT INTO booking_services (booking_id, catalogue_item_id, status)
    VALUES (999999, 999999, 'pending')
  `);
});

afterAll(async () => {
  // Restore the pre-test rows (schema is full again after the migration ran).
  await exec(`
    INSERT INTO booking_services
      (id, booking_id, catalogue_item_id, quantity, status, consumed_credit,
       tutor_service_credit_id, charged, invoice_item_id, captured_price,
       created_at, updated_at)
    SELECT id, booking_id, catalogue_item_id, quantity, status, consumed_credit,
           tutor_service_credit_id, charged, invoice_item_id, captured_price,
           created_at, updated_at
    FROM ${BACKUP}
    ON CONFLICT (id) DO NOTHING
  `);
  await exec(`
    SELECT setval('booking_services_id_seq',
      (SELECT COALESCE(MAX(id), 0) + 1 FROM booking_services))
  `);
  await exec(`DROP TABLE IF EXISTS ${BACKUP}`);
  // Remove the synthetic legacy row.
  await exec(`DELETE FROM booking_services WHERE booking_id = 999999`);

  if (createdPetIds.length > 0) {
    await db.delete(petsTable).where(inArray(petsTable.id, createdPetIds));
  }
});

describe("booking_services startup migration — legacy/partial table upgrade", () => {
  it("legacy table is missing the new columns before migration", async () => {
    const cols = await tableColumns("booking_services");
    expect(cols).not.toContain("invoice_item_id");
    expect(cols).not.toContain("captured_price");
    expect(cols).not.toContain("charged");
    expect(cols).not.toContain("tutor_service_credit_id");
  });

  it("ensureBookingServicesSchema adds every required column additively", async () => {
    await ensureBookingServicesSchema();
    const cols = await tableColumns("booking_services");
    for (const required of REQUIRED_COLUMNS) {
      expect(cols, `missing column ${required} after migration`).toContain(required);
    }
  });

  it("is idempotent — a second run does not fail", async () => {
    await expect(ensureBookingServicesSchema()).resolves.not.toThrow();
  });

  it("preserves legacy rows and applies NOT NULL defaults to them", async () => {
    const res = await exec(
      `SELECT quantity, consumed_credit, charged, invoice_item_id, captured_price
       FROM booking_services WHERE booking_id = 999999`,
    );
    const rows = res.rows ?? res;
    expect(rows.length).toBe(1);
    expect(Number(rows[0].quantity)).toBe(1);
    expect(rows[0].consumed_credit).toBe(false);
    expect(rows[0].charged).toBe(false);
    expect(rows[0].invoice_item_id).toBeNull();
    expect(rows[0].captured_price).toBeNull();
  });

  describe("full add-on flow works on the upgraded table", () => {
    let petId: number;
    let primaryId: number;
    let addonId: number;
    let bookingId: number;

    beforeAll(async () => {
      const [pet] = await db
        .insert(petsTable)
        .values({
          crecheId: ctx.crecheId,
          tutorId: ctx.userId,
          name: `MigPet_${Date.now()}`,
          species: "dog",
          gender: "male",
          size: "medium",
        })
        .returning();
      petId = pet!.id;
      createdPetIds.push(petId);

      const dayUse = await post<any>(
        `/creches/${ctx.crecheId}/financial/catalogue`,
        { name: `MigDayUse_${Date.now()}`, type: "day_use", price: 5000 },
        ctx.token,
      );
      expect([200, 201]).toContain(dayUse.status);
      primaryId = dayUse.body.id;

      const addon = await post<any>(
        `/creches/${ctx.crecheId}/financial/catalogue`,
        { name: `MigAddon_${Date.now()}`, type: "service", price: 1500 },
        ctx.token,
      );
      expect([200, 201]).toContain(addon.status);
      addonId = addon.body.id;
    });

    it("creates a booking with an add-on (writes captured_price)", async () => {
      const res = await post<any>(
        `/creches/${ctx.crecheId}/bookings`,
        {
          petId,
          type: "day_use",
          startDate: today,
          primaryCatalogueItemId: primaryId,
          additionalServiceIds: [addonId],
          isRecurring: false,
        },
        ctx.token,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      bookingId = res.body.id;
    });

    it("confirms the booking and charges the add-on (writes invoice_item_id)", async () => {
      const res = await put<any>(
        `/creches/${ctx.crecheId}/bookings/${bookingId}`,
        { status: "confirmed" },
        ctx.token,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      const detail = await get<any>(
        `/creches/${ctx.crecheId}/bookings/${bookingId}`,
        ctx.token,
      );
      expect(detail.status).toBe(200);
      const addonRow = (detail.body.additionalServices ?? [])[0];
      expect(addonRow?.status).toBe("confirmed");
      expect(Number(addonRow?.capturedPrice)).toBe(1500);
      expect(addonRow?.invoiceItemId, "add-on must be charged on the upgraded table").toBeTruthy();
    });

    it("cancels the booking and reverses the add-on (no 500 on upgraded table)", async () => {
      const res = await put<any>(
        `/creches/${ctx.crecheId}/bookings/${bookingId}`,
        { status: "cancelled" },
        ctx.token,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);

      const detail = await get<any>(
        `/creches/${ctx.crecheId}/bookings/${bookingId}`,
        ctx.token,
      );
      const addonRow = (detail.body.additionalServices ?? [])[0];
      expect(addonRow?.status).toBe("cancelled");
    });
  });
});
