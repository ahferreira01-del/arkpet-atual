import { pgTable, serial, text, integer, timestamp, pgEnum, boolean, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const crecheStatusEnum = pgEnum("creche_status", ["active", "inactive", "archived"]);
export const crecheDeliveryTypeEnum = pgEnum("creche_delivery_type", ["fixed", "on_demand"]);

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
  auditEnabled: boolean("audit_enabled").notNull().default(true),
  
  // Delivery Settings
  deliveryType: crecheDeliveryTypeEnum("delivery_type").default("fixed").notNull(),
  deliveryFee: numeric("delivery_fee", { precision: 10, scale: 2 }).default("0").notNull(),
  
  // Payment Config
  pixKey: text("pix_key"),
  pixName: text("pix_name"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const insertCrecheSchema = createInsertSchema(crechesTable).omit({ id: true, createdAt: true, deletedAt: true });
export type InsertCreche = z.infer<typeof insertCrecheSchema>;
export type Creche = typeof crechesTable.$inferSelect;
