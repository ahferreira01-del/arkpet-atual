import { db } from "@workspace/db";
import { timelineEventsTable } from "@workspace/db/schema";
import { inArray } from "drizzle-orm";

async function main() {
  const events = await db.select().from(timelineEventsTable).where(inArray(timelineEventsTable.id, [3, 4]));
  console.log(events);
}
main().catch(console.error);
