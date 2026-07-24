import { db } from "@workspace/db";
import { bookingsTable } from "@workspace/db/schema";
import { desc } from "drizzle-orm";

async function main() {
  const bookings = await db.select().from(bookingsTable).orderBy(desc(bookingsTable.createdAt)).limit(10);
  console.log(JSON.stringify(bookings, null, 2));
  process.exit(0);
}

main();
