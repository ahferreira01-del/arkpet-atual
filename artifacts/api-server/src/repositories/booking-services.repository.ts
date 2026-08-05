/**
 * BookingServicesRepository — owns all SQL for booking_services table.
 * Booking add-ons chosen by the tutor at creation time, distinct from
 * booking_consumables (operational, added by staff during the stay).
 */

import { db } from "@workspace/db";
import {
  bookingServicesTable,
  catalogueItemsTable,
} from "@workspace/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { c } from "./shared.js";

export class BookingServicesRepository {
  // ── Insert ───────────────────────────────────────────────────────────────

  static async insert(
    values: typeof bookingServicesTable.$inferInsert,
    tx?: any
  ): Promise<typeof bookingServicesTable.$inferSelect> {
    const [r] = await c(tx)
      .insert(bookingServicesTable)
      .values(values)
      .returning();
    return r;
  }

  // ── Read ─────────────────────────────────────────────────────────────────

  /**
   * Returns all add-ons for a booking, with catalogue item name joined.
   */
  static async findByBookingId(bookingId: number, tx?: any) {
    return c(tx)
      .select({
        id: bookingServicesTable.id,
        bookingId: bookingServicesTable.bookingId,
        catalogueItemId: bookingServicesTable.catalogueItemId,
        quantity: bookingServicesTable.quantity,
        status: bookingServicesTable.status,
        consumedCredit: bookingServicesTable.consumedCredit,
        charged: bookingServicesTable.charged,
        invoiceItemId: bookingServicesTable.invoiceItemId,
        capturedPrice: bookingServicesTable.capturedPrice,
        createdAt: bookingServicesTable.createdAt,
        itemName: catalogueItemsTable.name,
        itemType: catalogueItemsTable.type,
      })
      .from(bookingServicesTable)
      .leftJoin(
        catalogueItemsTable,
        eq(bookingServicesTable.catalogueItemId, catalogueItemsTable.id)
      )
      .where(eq(bookingServicesTable.bookingId, bookingId));
  }

  /**
   * Returns pending add-ons for a booking (for confirmation processing).
   * Locks rows FOR UPDATE when tx is provided.
   */
  static async findPendingForUpdate(bookingId: number, tx: any) {
    // Postgres forbids FOR UPDATE on the nullable side of an outer join, so
    // we lock the booking_services rows FIRST (no join), then join catalogue
    // metadata in a second, lock-free query inside the same transaction.
    const locked = await tx
      .select({
        id: bookingServicesTable.id,
        catalogueItemId: bookingServicesTable.catalogueItemId,
        quantity: bookingServicesTable.quantity,
        capturedPrice: bookingServicesTable.capturedPrice,
      })
      .from(bookingServicesTable)
      .where(
        and(
          eq(bookingServicesTable.bookingId, bookingId),
          eq(bookingServicesTable.status, "pending")
        )
      )
      .for("update");

    if (locked.length === 0) return [];

    const itemIds = locked.map((r: any) => r.catalogueItemId);
    const items = await tx
      .select({
        id: catalogueItemsTable.id,
        name: catalogueItemsTable.name,
        type: catalogueItemsTable.type,
        priceSmall: catalogueItemsTable.priceSmall,
        priceMedium: catalogueItemsTable.priceMedium,
        priceLarge: catalogueItemsTable.priceLarge,
      })
      .from(catalogueItemsTable)
      .where(inArray(catalogueItemsTable.id, itemIds));

    const byId = new Map(items.map((i: any) => [i.id, i]));
    return locked.map((r: any) => {
      const item: any = byId.get(r.catalogueItemId);
      return {
        ...r,
        itemName: item?.name ?? null,
        itemType: item?.type ?? null,
        priceSmall: item?.priceSmall ?? null,
        priceMedium: item?.priceMedium ?? null,
        priceLarge: item?.priceLarge ?? null,
      };
    });
  }

  /**
   * Returns confirmed add-ons that consumed a credit (for cancellation restore).
   */
  static async findConfirmedWithCredit(bookingId: number, tx?: any) {
    return c(tx)
      .select()
      .from(bookingServicesTable)
      .where(
        and(
          eq(bookingServicesTable.bookingId, bookingId),
          eq(bookingServicesTable.status, "confirmed"),
          eq(bookingServicesTable.consumedCredit, true)
        )
      );
  }

  /**
   * Returns confirmed add-ons that were charged (for cancellation credit notes).
   */
  static async findConfirmedCharged(bookingId: number, tx?: any) {
    return c(tx)
      .select()
      .from(bookingServicesTable)
      .where(
        and(
          eq(bookingServicesTable.bookingId, bookingId),
          eq(bookingServicesTable.status, "confirmed"),
          eq(bookingServicesTable.charged, true)
        )
      );
  }

  /**
   * Batch-fetch add-ons for multiple bookings at once (used in GET list).
   */
  static async findByBookingIds(bookingIds: number[], tx?: any) {
    if (bookingIds.length === 0) return [];
    return c(tx)
      .select({
        id: bookingServicesTable.id,
        bookingId: bookingServicesTable.bookingId,
        catalogueItemId: bookingServicesTable.catalogueItemId,
        quantity: bookingServicesTable.quantity,
        status: bookingServicesTable.status,
        capturedPrice: bookingServicesTable.capturedPrice,
        itemName: catalogueItemsTable.name,
      })
      .from(bookingServicesTable)
      .leftJoin(
        catalogueItemsTable,
        eq(bookingServicesTable.catalogueItemId, catalogueItemsTable.id)
      )
      .where(
        and(
          inArray(bookingServicesTable.bookingId, bookingIds),
          // Show pending + confirmed; exclude cancelled
          sql`${bookingServicesTable.status} IN ('pending', 'confirmed')`
        )
      );
  }

  // ── Update ───────────────────────────────────────────────────────────────

  static async markConfirmed(id: number, tx?: any): Promise<void> {
    await c(tx)
      .update(bookingServicesTable)
      .set({ status: "confirmed", updatedAt: new Date() })
      .where(eq(bookingServicesTable.id, id));
  }

  static async markConsumedCredit(
    id: number,
    tutorServiceCreditId: number,
    tx?: any
  ): Promise<void> {
    await c(tx)
      .update(bookingServicesTable)
      .set({
        status: "confirmed",
        consumedCredit: true,
        tutorServiceCreditId,
        updatedAt: new Date(),
      })
      .where(eq(bookingServicesTable.id, id));
  }

  static async markCharged(
    id: number,
    invoiceItemId: number,
    tx?: any
  ): Promise<void> {
    await c(tx)
      .update(bookingServicesTable)
      .set({
        status: "confirmed",
        charged: true,
        invoiceItemId,
        updatedAt: new Date(),
      })
      .where(eq(bookingServicesTable.id, id));
  }

  static async markCancelled(id: number, tx?: any): Promise<void> {
    await c(tx)
      .update(bookingServicesTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(bookingServicesTable.id, id));
  }

  static async markAllCancelledForBooking(bookingId: number, tx?: any): Promise<void> {
    await c(tx)
      .update(bookingServicesTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          eq(bookingServicesTable.bookingId, bookingId),
          sql`${bookingServicesTable.status} != 'cancelled'`
        )
      );
  }
}
