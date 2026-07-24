import { db } from "./src/index.js";
import { bookingsTable, petsTable, usersTable } from "./src/schema/index.js";
import { eq, desc, sql } from "drizzle-orm";

async function main() {
  try {
    const crecheId = 40;
    const offset = 0;
    const pageSize = 20;
    console.log("Starting query...");
    const data = await db
      .select({
        id: bookingsTable.id,
        crecheId: bookingsTable.crecheId,
        petId: bookingsTable.petId,
        petName: petsTable.name,
        tutorId: bookingsTable.tutorId,
        tutorName: usersTable.name,
        type: bookingsTable.type,
        status: bookingsTable.status,
        startDate: bookingsTable.startDate,
        endDate: bookingsTable.endDate,
        checkInTime: bookingsTable.checkInTime,
        checkOutTime: bookingsTable.checkOutTime,
        notes: bookingsTable.notes,
        isRecurring: bookingsTable.isRecurring,
        recurringDays: bookingsTable.recurringDays,
        price: bookingsTable.price,
        onTheWayType: bookingsTable.onTheWayType,
        onTheWayEtaMinutes: bookingsTable.onTheWayEtaMinutes,
        onTheWayAt: bookingsTable.onTheWayAt,
        hasPersonalItems: bookingsTable.hasPersonalItems,
        personalItemsPhotoUrl: bookingsTable.personalItemsPhotoUrl,
        createdAt: bookingsTable.createdAt,
      })
      .from(bookingsTable)
      .leftJoin(petsTable, eq(bookingsTable.petId, petsTable.id))
      .leftJoin(usersTable, eq(bookingsTable.tutorId, usersTable.id))
      .where(eq(bookingsTable.crecheId, crecheId))
      .orderBy(desc(bookingsTable.startDate))
      .limit(pageSize)
      .offset(offset);
      
    console.log("Success! Got", data.length, "items.");
    console.log(data[0]);
  } catch (err) {
    console.error("DEBUG ERROR IN QUERY:", err);
  }
}
main();
