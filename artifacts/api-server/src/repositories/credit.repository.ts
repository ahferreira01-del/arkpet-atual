/**
 * CreditRepository — owns all SQL for the credit tables:
 *   tutorCreditsTable, bookingCreditsTable,
 *   tutorServiceCreditsTable, bookingServiceCreditsTable
 */

import { db } from "@workspace/db";
import {
  tutorCreditsTable,
  tutorServiceCreditsTable,
  bookingCreditsTable,
  bookingServiceCreditsTable,
  bookingsTable,
  catalogueItemsTable,
} from "@workspace/db/schema";
import { eq, and, or, isNull, gte, asc, gt, sql } from "drizzle-orm";
import { c } from "./shared.js";

export class CreditRepository {
  // ── tutorCreditsTable ────────────────────────────────────────────────────

  static async createPackageCredits(
    values: typeof tutorCreditsTable.$inferInsert,
    tx?: any
  ): Promise<typeof tutorCreditsTable.$inferSelect> {
    const [r] = await c(tx).insert(tutorCreditsTable).values(values).returning();
    return r;
  }

  static async findPackageCreditById(id: number, tx?: any) {
    const [r] = await c(tx)
      .select()
      .from(tutorCreditsTable)
      .where(eq(tutorCreditsTable.id, id));
    return r ?? null;
  }

  /**
   * Finds the oldest valid (not fully used, not expired) package credit
   * for a tutor/creche/maxPets combination.  FOR UPDATE — requires tx.
   */
  static async findOldestAvailablePackageCreditForUpdate(
    tutorId: number,
    crecheId: number,
    maxPetsPerDay: number,
    todayStr: string,
    tx: any
  ) {
    const [r] = await tx
      .select()
      .from(tutorCreditsTable)
      .where(
        and(
          eq(tutorCreditsTable.tutorId, tutorId),
          eq(tutorCreditsTable.crecheId, crecheId),
          eq(tutorCreditsTable.maxPetsPerDay, maxPetsPerDay),
          sql`${tutorCreditsTable.usedCredits} < ${tutorCreditsTable.totalCredits}`,
          or(
            isNull(tutorCreditsTable.expirationDate),
            gte(tutorCreditsTable.expirationDate, todayStr)
          )
        )
      )
      .orderBy(asc(tutorCreditsTable.expirationDate), asc(tutorCreditsTable.createdAt))
      .limit(1)
      .for("update");
    return r ?? null;
  }

  static async incrementUsedPackageCredits(id: number, amount: number, tx?: any): Promise<void> {
    await c(tx)
      .update(tutorCreditsTable)
      .set({ usedCredits: sql`${tutorCreditsTable.usedCredits} + ${amount}` })
      .where(eq(tutorCreditsTable.id, id));
  }

  static async decrementUsedPackageCredits(id: number, amount: number, tx?: any): Promise<void> {
    await c(tx)
      .update(tutorCreditsTable)
      .set({
        usedCredits: sql`GREATEST(0, ${tutorCreditsTable.usedCredits} - ${amount})`,
      })
      .where(eq(tutorCreditsTable.id, id));
  }

  // ── bookingCreditsTable ──────────────────────────────────────────────────

  static async findBookingCredits(bookingId: number, tx?: any) {
    return c(tx)
      .select()
      .from(bookingCreditsTable)
      .where(eq(bookingCreditsTable.bookingId, bookingId));
  }

  static async createBookingCredit(
    values: typeof bookingCreditsTable.$inferInsert,
    tx?: any
  ): Promise<void> {
    await c(tx).insert(bookingCreditsTable).values(values);
  }

  static async markBookingCreditRestored(id: number, tx?: any): Promise<void> {
    await c(tx)
      .update(bookingCreditsTable)
      .set({ restoredAt: new Date() })
      .where(eq(bookingCreditsTable.id, id));
  }

  static async updateBookingCreditConsumed(id: number, consumed: number, tx?: any): Promise<void> {
    await c(tx)
      .update(bookingCreditsTable)
      .set({ creditsConsumed: consumed })
      .where(eq(bookingCreditsTable.id, id));
  }

  /**
   * Finds piggyback candidates: bookings on the same date that are already
   * consuming a multi-pet credit from the same pack, with capacity remaining.
   * Used by consumePackageCredits. Requires tx.
   */
  static async findPiggybackCandidates(
    tutorId: number,
    crecheId: number,
    dateStr: string,
    packageMaxPets: number,
    tx: any
  ) {
    return tx
      .select({
        creditId: bookingCreditsTable.tutorCreditId,
        maxPets: tutorCreditsTable.maxPetsPerDay,
        usedPetsCount: sql<number>`count(DISTINCT ${bookingsTable.petId})`,
      })
      .from(bookingCreditsTable)
      .innerJoin(tutorCreditsTable, eq(bookingCreditsTable.tutorCreditId, tutorCreditsTable.id))
      .innerJoin(bookingsTable, eq(bookingCreditsTable.bookingId, bookingsTable.id))
      .where(
        and(
          eq(bookingsTable.tutorId, tutorId),
          eq(bookingsTable.crecheId, crecheId),
          eq(bookingCreditsTable.consumedDate, dateStr),
          isNull(bookingCreditsTable.restoredAt),
          gt(tutorCreditsTable.maxPetsPerDay, 1),
          eq(tutorCreditsTable.maxPetsPerDay, packageMaxPets)
        )
      )
      .groupBy(bookingCreditsTable.tutorCreditId, tutorCreditsTable.maxPetsPerDay);
  }

  /** Finds piggyback children: carona entries for the same credit+date as a normal entry. */
  static async findPiggybackChild(
    tutorCreditId: number,
    consumedDate: string,
    excludeId: number,
    tx: any
  ) {
    const [r] = await tx
      .select()
      .from(bookingCreditsTable)
      .where(
        and(
          eq(bookingCreditsTable.tutorCreditId, tutorCreditId),
          eq(bookingCreditsTable.consumedDate, consumedDate),
          eq(bookingCreditsTable.creditsConsumed, 0),
          isNull(bookingCreditsTable.restoredAt),
          sql`${bookingCreditsTable.id} != ${excludeId}`
        )
      )
      .limit(1);
    return r ?? null;
  }

  // ── tutorServiceCreditsTable ─────────────────────────────────────────────

  static async createServiceCredits(
    values: typeof tutorServiceCreditsTable.$inferInsert,
    tx?: any
  ): Promise<void> {
    await c(tx).insert(tutorServiceCreditsTable).values(values);
  }

  /**
   * Finds all available service credits for a tutor/creche, with catalogue name
   * joined.  FOR UPDATE — requires tx.
   */
  static async findAvailableServiceCreditsForUpdate(
    tutorId: number,
    crecheId: number,
    tx: any
  ) {
    return tx
      .select({
        id: tutorServiceCreditsTable.id,
        totalCredits: tutorServiceCreditsTable.totalCredits,
        usedCredits: tutorServiceCreditsTable.usedCredits,
        catalogueItemId: tutorServiceCreditsTable.catalogueItemId,
        itemName: catalogueItemsTable.name,
      })
      .from(tutorServiceCreditsTable)
      .innerJoin(
        catalogueItemsTable,
        eq(catalogueItemsTable.id, tutorServiceCreditsTable.catalogueItemId)
      )
      .where(
        and(
          eq(tutorServiceCreditsTable.tutorId, tutorId),
          eq(tutorServiceCreditsTable.crecheId, crecheId),
          sql`${tutorServiceCreditsTable.usedCredits} < ${tutorServiceCreditsTable.totalCredits}`
        )
      )
      .orderBy(asc(tutorServiceCreditsTable.id))
      .for("update");
  }

  static async incrementUsedServiceCredits(id: number, amount: number, tx?: any): Promise<void> {
    await c(tx)
      .update(tutorServiceCreditsTable)
      .set({ usedCredits: sql`${tutorServiceCreditsTable.usedCredits} + ${amount}` })
      .where(eq(tutorServiceCreditsTable.id, id));
  }

  static async decrementUsedServiceCredits(id: number, amount: number, tx?: any): Promise<void> {
    await c(tx)
      .update(tutorServiceCreditsTable)
      .set({
        usedCredits: sql`GREATEST(0, ${tutorServiceCreditsTable.usedCredits} - ${amount})`,
      })
      .where(eq(tutorServiceCreditsTable.id, id));
  }

  static async deductTotalServiceCredits(id: number, amount: number, tx?: any): Promise<void> {
    await c(tx)
      .update(tutorServiceCreditsTable)
      .set({
        totalCredits: sql`${tutorServiceCreditsTable.totalCredits} - ${amount}`,
      })
      .where(eq(tutorServiceCreditsTable.id, id));
  }

  // ── bookingServiceCreditsTable ───────────────────────────────────────────

  static async findBookingServiceCredits(bookingId: number, tx?: any) {
    return c(tx)
      .select()
      .from(bookingServiceCreditsTable)
      .where(eq(bookingServiceCreditsTable.bookingId, bookingId));
  }

  static async existsBookingServiceCredit(bookingId: number, tx?: any): Promise<boolean> {
    const [r] = await c(tx)
      .select({ id: bookingServiceCreditsTable.id })
      .from(bookingServiceCreditsTable)
      .where(eq(bookingServiceCreditsTable.bookingId, bookingId))
      .limit(1);
    return !!r;
  }

  static async createBookingServiceCredit(
    values: typeof bookingServiceCreditsTable.$inferInsert,
    tx?: any
  ): Promise<void> {
    await c(tx).insert(bookingServiceCreditsTable).values(values);
  }

  static async markBookingServiceCreditRestored(id: number, tx?: any): Promise<void> {
    await c(tx)
      .update(bookingServiceCreditsTable)
      .set({ restoredAt: new Date() })
      .where(eq(bookingServiceCreditsTable.id, id));
  }

  /** Finds active (not yet restored) booking credits for a booking. */
  static async findActiveBookingCredits(bookingId: number, tx?: any) {
    return c(tx)
      .select()
      .from(bookingCreditsTable)
      .where(
        and(eq(bookingCreditsTable.bookingId, bookingId), isNull(bookingCreditsTable.restoredAt))
      );
  }

  /** Finds active (not yet restored) booking service credits for a booking. */
  static async findActiveBookingServiceCredits(bookingId: number, tx?: any) {
    return c(tx)
      .select()
      .from(bookingServiceCreditsTable)
      .where(
        and(
          eq(bookingServiceCreditsTable.bookingId, bookingId),
          isNull(bookingServiceCreditsTable.restoredAt)
        )
      );
  }
}
