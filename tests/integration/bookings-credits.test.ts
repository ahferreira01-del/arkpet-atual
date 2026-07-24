import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../../artifacts/api-server/src/app"; // Assuming this is the path
import { db } from "@workspace/db";
import { 
  usersTable, 
  crechesTable, 
  petsTable, 
  tutorCreditsTable, 
  bookingsTable,
  bookingCreditsTable,
  catalogueItemsTable,
  invoicesTable
} from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { createTestUser, createTestCreche } from "../helpers";
import { generateToken } from "../../artifacts/api-server/src/lib/auth.js";

describe("Booking Credits and Invoicing Integration", () => {
  let crecheId: number;
  let tutorId: number;
  let petId: number;
  let token: string;

  beforeEach(async () => {
    // Setup test data
    const creche = await createTestCreche({ name: "Test Creche" });
    crecheId = creche.id;

    const tutor = await createTestUser({ role: "tutor", crecheId });
    tutorId = tutor.id;
    token = generateToken(tutor.id, tutor.role);

    const [pet] = await db.insert(petsTable).values({
      crecheId,
      tutorId,
      name: "Test Dog",
      species: "dog",
      breed: "Mutt",
      size: "medium",
      gender: "male",
      weight: 15,
      birthDate: "2020-01-01"
    }).returning();
    petId = pet.id;

    // Add catalogue item for day_use
    await db.insert(catalogueItemsTable).values({
      crecheId,
      name: "day_use",
      type: "service",
      basePrice: 10000, // R$ 100
      pricingBySize: { small: 9000, medium: 10000, large: 12000 }
    });
  });

  afterEach(async () => {
    await db.delete(bookingCreditsTable);
    await db.delete(invoicesTable);
    await db.delete(bookingsTable);
    await db.delete(tutorCreditsTable);
    await db.delete(catalogueItemsTable);
    await db.delete(petsTable);
    await db.delete(usersTable);
    await db.delete(crechesTable);
  });

  it("should consume from a single package entirely covering the booking", async () => {
    // Buy a 10 day package
    const [pack] = await db.insert(tutorCreditsTable).values({
      crecheId,
      tutorId,
      totalCredits: 10,
      usedCredits: 0,
      expirationDate: "2026-12-31"
    }).returning();

    // Book 2 days
    const res = await request(app)
      .post(`/api/creches/${crecheId}/bookings`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        petId,
        type: "day_use",
        startDate: "2026-08-01",
        endDate: "2026-08-02" // 2 days
      });

    expect(res.status).toBe(201);

    // Verify credits consumed
    const [updatedPack] = await db.select().from(tutorCreditsTable).where(eq(tutorCreditsTable.id, pack.id));
    expect(updatedPack.usedCredits).toBe(2);

    // Verify tracking table
    const tracking = await db.select().from(bookingCreditsTable).where(eq(bookingCreditsTable.bookingId, res.body.id));
    expect(tracking.length).toBe(1);
    expect(tracking[0].creditsConsumed).toBe(2);

    // Verify no invoice generated
    const invoices = await db.select().from(invoicesTable).where(eq(invoicesTable.bookingId, res.body.id));
    expect(invoices.length).toBe(0);
  });

  it("should cascade consumption across multiple packages (FIFO)", async () => {
    // Pack 1: expires soon, 1 left
    const [pack1] = await db.insert(tutorCreditsTable).values({
      crecheId, tutorId, totalCredits: 5, usedCredits: 4, expirationDate: "2026-07-30"
    }).returning();

    // Pack 2: expires later, 10 left
    const [pack2] = await db.insert(tutorCreditsTable).values({
      crecheId, tutorId, totalCredits: 10, usedCredits: 0, expirationDate: "2026-12-31"
    }).returning();

    // Book 3 days
    const res = await request(app)
      .post(`/api/creches/${crecheId}/bookings`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        petId,
        type: "day_use",
        startDate: "2026-08-01",
        endDate: "2026-08-03" // 3 days
      });

    expect(res.status).toBe(201);

    // Pack 1 should be fully consumed (5/5)
    const [uPack1] = await db.select().from(tutorCreditsTable).where(eq(tutorCreditsTable.id, pack1.id));
    expect(uPack1.usedCredits).toBe(5);

    // Pack 2 should consume the remaining 2 (2/10)
    const [uPack2] = await db.select().from(tutorCreditsTable).where(eq(tutorCreditsTable.id, pack2.id));
    expect(uPack2.usedCredits).toBe(2);

    // Tracking should have 2 records
    const tracking = await db.select().from(bookingCreditsTable).where(eq(bookingCreditsTable.bookingId, res.body.id));
    expect(tracking.length).toBe(2);
  });

  it("should generate pending invoice for remaining days without credits", async () => {
    // Pack: 1 credit left
    await db.insert(tutorCreditsTable).values({
      crecheId, tutorId, totalCredits: 2, usedCredits: 1, expirationDate: "2026-12-31"
    });

    // Book 3 days
    const res = await request(app)
      .post(`/api/creches/${crecheId}/bookings`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        petId,
        type: "day_use",
        startDate: "2026-08-01",
        endDate: "2026-08-03" // 3 days
      });

    expect(res.status).toBe(201);
    
    // We needed 3 days, had 1 credit. Remaining 2 days must be billed.
    // Base price for medium dog = 10000 (R$100). Total = R$200 = 20000.
    const invoices = await db.select().from(invoicesTable).where(eq(invoicesTable.bookingId, res.body.id));
    expect(invoices.length).toBe(1);
    expect(Number(invoices[0].amount)).toBe(20000);
    expect(invoices[0].status).toBe("pending");
  });

  it("should rollback completely and return credits when booking is cancelled", async () => {
    // Setup 1 credit and book 1 day
    const [pack] = await db.insert(tutorCreditsTable).values({
      crecheId, tutorId, totalCredits: 1, usedCredits: 0, expirationDate: "2026-12-31"
    }).returning();

    const bookRes = await request(app).post(`/api/creches/${crecheId}/bookings`).set("Authorization", `Bearer ${token}`).send({
      petId, type: "day_use", startDate: "2026-08-01", endDate: "2026-08-01"
    });
    console.log("POST RES", bookRes.status, bookRes.body);

    const bookingId = bookRes.body.id;

    // Ensure it consumed
    let [checkPack] = await db.select().from(tutorCreditsTable).where(eq(tutorCreditsTable.id, pack.id));
    expect(checkPack.usedCredits).toBe(1);

    // Cancel booking (admin simulation to approve cancel)
    const adminUser = await createTestUser({ role: "creche_admin", crecheId });
    const adminToken = generateToken(adminUser.id, adminUser.role);
    const cancelRes = await request(app).put(`/api/creches/${crecheId}/bookings/${bookingId}`).set("Authorization", `Bearer ${adminToken}`).send({
      status: "cancelled"
    });
    console.log("PUT RES", cancelRes.status, cancelRes.body);
    expect(cancelRes.status).toBe(200);

    // Ensure credits returned
    [checkPack] = await db.select().from(tutorCreditsTable).where(eq(tutorCreditsTable.id, pack.id));
    expect(checkPack.usedCredits).toBe(0);

    // Tracking is restored
    const tracking = await db.select().from(bookingCreditsTable).where(eq(bookingCreditsTable.bookingId, bookingId));
    expect(tracking[0].restoredAt).not.toBeNull();
  });
});
