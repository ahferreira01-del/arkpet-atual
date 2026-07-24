import { db } from "./src/index.js";
import { bookingsTable, petsTable, usersTable } from "./src/schema/index.js";
import { eq, desc, sql, and } from "drizzle-orm";

async function main() {
  try {
    const crecheId = 40;
    const offset = 0;
    const pageSize = 20;
    console.log("Starting query...");
    let conditions = [eq(bookingsTable.crecheId, crecheId)];
    const [data, [{ total }]] = await Promise.all([
      db
        .select({
          id: bookingsTable.id,
          crecheId: bookingsTable.crecheId,
        })
        .from(bookingsTable)
        .leftJoin(petsTable, eq(bookingsTable.petId, petsTable.id))
        .leftJoin(usersTable, eq(bookingsTable.tutorId, usersTable.id))
        .where(and(...conditions))
        .orderBy(desc(bookingsTable.startDate))
        .limit(pageSize)
        .offset(offset),
      
      db
        .select({ total: sql<number>`count(*)` })
        .from(bookingsTable)
        .where(and(...conditions)),
    ]);
    console.log("total:", total);
    console.log(data.length);
  } catch (err) {
    console.error("DEBUG ERROR IN QUERY:", err);
  }
}
main();
