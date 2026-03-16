import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const crecheStatusEnum = pgEnum("creche_status", ["active", "inactive"]);

export const crechesTable = pgTable("creches", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  phone: text("phone").notNull(),
  email: text("email").notNull(),
  maxCapacity: integer("max_capacity").notNull().default(20),
  currentOccupancy: integer("current_occupancy").notNull().default(0),
  logoUrl: text("logo_url"),
  status: crecheStatusEnum("status").notNull().default("active"),
  adminId: integer("admin_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCrecheSchema = createInsertSchema(crechesTable).omit({ id: true, createdAt: true });
export type InsertCreche = z.infer<typeof insertCrecheSchema>;
export type Creche = typeof crechesTable.$inferSelect;
