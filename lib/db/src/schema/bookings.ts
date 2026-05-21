import { pgTable, serial, text, integer, timestamp, pgEnum, date, boolean, real, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const bookingTypeEnum = pgEnum("booking_type", ["day_use", "lodging", "banho", "hospedagem_banho", "visita", "pacote_4dias", "pacote_8dias", "pacote_20dias", "visita_taxi", "creche_taxi"]);
export const bookingStatusEnum = pgEnum("booking_status", ["pending", "confirmed", "active", "completed", "cancelled"]);

export const bookingsTable = pgTable("bookings", {
  id: serial("id").primaryKey(),
  crecheId: integer("creche_id").notNull(),
  petId: integer("pet_id").notNull(),
  tutorId: integer("tutor_id").notNull(),
  type: bookingTypeEnum("type").notNull(),
  status: bookingStatusEnum("status").notNull().default("pending"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  checkInTime: timestamp("check_in_time"),
  checkOutTime: timestamp("check_out_time"),
  notes: text("notes"),
  isRecurring: boolean("is_recurring").notNull().default(false),
  recurringDays: jsonb("recurring_days").$type<number[]>(),
  price: real("price"),
  onTheWayType: text("on_the_way_type"),
  onTheWayEtaMinutes: integer("on_the_way_eta_minutes"),
  onTheWayAt: timestamp("on_the_way_at"),
  hasPersonalItems: boolean("has_personal_items"),
  personalItemsPhotoUrl: text("personal_items_photo_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertBookingSchema = createInsertSchema(bookingsTable).omit({ id: true, createdAt: true });
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookingsTable.$inferSelect;
