import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const timelineEventTypeEnum = pgEnum("timeline_event_type", [
  "check_in", "check_out", "feeding", "medication", "walk", "play", "photo", "video", "note", "health"
]);
export const mediaTypeEnum = pgEnum("media_type", ["photo", "video"]);

export const timelineEventsTable = pgTable("timeline_events", {
  id: serial("id").primaryKey(),
  crecheId: integer("creche_id").notNull(),
  petId: integer("pet_id").notNull(),
  authorId: integer("author_id").notNull(),
  type: timelineEventTypeEnum("type").notNull(),
  content: text("content"),
  mediaUrl: text("media_url"),
  mediaType: mediaTypeEnum("media_type"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertTimelineEventSchema = createInsertSchema(timelineEventsTable).omit({ id: true, createdAt: true });
export type InsertTimelineEvent = z.infer<typeof insertTimelineEventSchema>;
export type TimelineEvent = typeof timelineEventsTable.$inferSelect;
