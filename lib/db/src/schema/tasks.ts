import { pgTable, serial, text, integer, timestamp, pgEnum , index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const taskTypeEnum = pgEnum("task_type", ["feeding", "medication", "walk", "grooming", "play", "health_check", "other"]);
export const taskStatusEnum = pgEnum("task_status", ["pending", "completed", "skipped"]);
export const taskPriorityEnum = pgEnum("task_priority", ["low", "medium", "high"]);

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  crecheId: integer("creche_id").notNull(),
  petId: integer("pet_id"),
  assignedToId: integer("assigned_to_id"),
  type: taskTypeEnum("type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  scheduledFor: timestamp("scheduled_for").notNull(),
  completedAt: timestamp("completed_at"),
  completedBy: text("completed_by"),
  status: taskStatusEnum("status").notNull().default("pending"),
  notes: text("notes"),
  priority: taskPriorityEnum("priority").notNull().default("medium"),
  reminderSentAt: timestamp("reminder_sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("tasks_creche_idx").on(t.crecheId),
  index("tasks_pet_idx").on(t.petId),
  index("tasks_status_idx").on(t.status)
]);

export const insertTaskSchema = createInsertSchema(tasksTable).omit({ id: true, createdAt: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
