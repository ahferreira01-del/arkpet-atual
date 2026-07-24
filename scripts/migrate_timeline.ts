import { db } from "@workspace/db";
import { timelineEventsTable, timelineEventPetsTable } from "@workspace/db/schema";
import { isNotNull, and, eq } from "drizzle-orm";

async function migrate() {
  console.log("Starting timeline data migration...");
  
  const events = await db.select().from(timelineEventsTable).where(isNotNull(timelineEventsTable.petId));
  console.log(`Found ${events.length} events with legacy petId.`);
  
  let migrated = 0;
  for (const event of events) {
    if (event.petId !== null) {
      const existing = await db.select().from(timelineEventPetsTable).where(
        and(
          eq(timelineEventPetsTable.eventId, event.id),
          eq(timelineEventPetsTable.petId, event.petId)
        )
      );
      
      if (existing.length === 0) {
        await db.insert(timelineEventPetsTable).values({
          eventId: event.id,
          petId: event.petId
        });
        migrated++;
      }
    }
  }
  
  console.log(`Successfully migrated ${migrated} events to timeline_event_pets table.`);
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
