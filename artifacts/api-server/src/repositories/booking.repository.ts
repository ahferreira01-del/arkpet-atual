/**
 * BookingRepository — SQL for bookingsTable.
 * Used by the credit service when it needs booking-level lookups.
 */

import { db } from "@workspace/db";
import { bookingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { c } from "./shared.js";

export class BookingRepository {
  static async findById(id: number, tx?: any) {
    const [r] = await c(tx)
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, id));
    return r ?? null;
  }

  static async findByIdAndCreche(id: number, crecheId: number, tx?: any) {
    const [r] = await c(tx)
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, id));
    // Note: bookingsTable has crecheId; filtered here in application since
    // the main bookings routes also scope by param.
    if (r?.crecheId !== crecheId) return null;
    return r ?? null;
  }
}
