import { pgTable, serial, text, integer, timestamp , index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const chatMessagesTable = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  crecheId: integer("creche_id").notNull(),
  tutorId: integer("tutor_id"),
  petId: integer("pet_id"),
  senderId: integer("sender_id").notNull(),
  content: text("content").notNull(),
  mediaUrl: text("media_url"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("chat_creche_idx").on(t.crecheId),
  index("chat_sender_idx").on(t.senderId),
  index("chat_tutor_idx").on(t.tutorId)
]);

export const insertChatMessageSchema = createInsertSchema(chatMessagesTable).omit({ id: true, createdAt: true });
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;
