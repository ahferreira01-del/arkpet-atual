import { pgTable, serial, text, integer, timestamp, pgEnum , index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const timelineEventTypeEnum = pgEnum("timeline_event_type", [
  "check_in", "check_out", "feeding", "medication", "walk", "play", "photo", "video", "note", "health"
]);
export const mediaTypeEnum = pgEnum("media_type", ["photo", "video"]);

export const timelineEventsTable = pgTable("timeline_events", {
  id: serial("id").primaryKey(),
  crecheId: integer("creche_id").notNull(),
  petId: integer("pet_id"), // Made optional for backward compatibility, will be replaced by timeline_event_pets
  authorId: integer("author_id").notNull(),
  type: timelineEventTypeEnum("type").notNull(),
  content: text("content"),
  mediaUrl: text("media_url"),
  mediaType: mediaTypeEnum("media_type"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("timeline_creche_idx").on(t.crecheId),
  index("timeline_pet_idx").on(t.petId),
  index("timeline_date_idx").on(t.createdAt)
]);

export const timelineEventPetsTable = pgTable("timeline_event_pets", {
  eventId: integer("event_id").notNull(),
  petId: integer("pet_id").notNull(),
}, (t) => [
  index("timeline_event_pets_event_idx").on(t.eventId),
  index("timeline_event_pets_pet_idx").on(t.petId)
]);

export const timelineViewsTable = pgTable("timeline_views", {
  eventId: integer("event_id").notNull(),
  userId: integer("user_id").notNull(),
  viewedAt: timestamp("viewed_at").notNull().defaultNow(),
}, (t) => [
  index("timeline_views_event_idx").on(t.eventId),
  index("timeline_views_user_idx").on(t.userId)
]);

export const timelineCommentsTable = pgTable("timeline_comments", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  userId: integer("user_id").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("timeline_comments_event_idx").on(t.eventId)
]);

export const timelineLikesTable = pgTable("timeline_likes", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  userId: integer("user_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("timeline_likes_event_idx").on(t.eventId)
]);

export const insertTimelineEventSchema = createInsertSchema(timelineEventsTable).omit({ id: true, createdAt: true });
export type InsertTimelineEvent = z.infer<typeof insertTimelineEventSchema>;
export type TimelineEvent = typeof timelineEventsTable.$inferSelect;
