import { db } from "@workspace/db";
import { timelineEventsTable, timelineEventPetsTable, petsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const events = await db.select().from(timelineEventsTable).limit(10);
  console.log("Timeline events:", events);

  const tutorPets = await db.select().from(petsTable).where(eq(petsTable.tutorId, 49));
  console.log("Tutor 49 pets:", tutorPets);
  
  process.exit(0);
}
main();
