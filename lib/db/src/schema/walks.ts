import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const walkStatusEnum = pgEnum("walk_status", ["in_progress", "completed"]);

export const walksTable = pgTable("walks", {
  id: serial("id").primaryKey(),
  petId: integer("pet_id").notNull(),
  crecheId: integer("creche_id").notNull(),
  staffId: integer("staff_id").notNull(),
  startTime: timestamp("start_time").notNull().defaultNow(),
  endTime: timestamp("end_time"),
  durationMinutes: integer("duration_minutes"),
  notes: text("notes"),
  status: walkStatusEnum("status").notNull().default("in_progress"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertWalkSchema = createInsertSchema(walksTable).omit({ id: true, createdAt: true });
export type InsertWalk = z.infer<typeof insertWalkSchema>;
export type Walk = typeof walksTable.$inferSelect;
