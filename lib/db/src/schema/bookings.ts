import { pgTable, serial, text, integer, timestamp, pgEnum, date, boolean, real, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Note: booking_type was previously a pgEnum but was changed to plain text so
// that creche admins can create services with arbitrary names (e.g. "tosa",
// "tosa_completa", etc.) without requiring schema migrations for each new type.
export const bookingStatusEnum = pgEnum("booking_status", ["pending", "confirmed", "active", "completed", "cancelled", "cancel_requested"]);

export const bookingsTable = pgTable("bookings", {
  id: serial("id").primaryKey(),
  crecheId: integer("creche_id").notNull(),
  petId: integer("pet_id").notNull(),
  tutorId: integer("tutor_id").notNull(),
  type: text("type").notNull(),
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
  packageMaxPets: integer("package_max_pets"), // Limite do pacote selecionado no agendamento
  primaryCatalogueItemId: integer("primary_catalogue_item_id"), // ID do serviço principal (null para reservas antigas)
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("bookings_creche_date_idx").on(t.crecheId, t.startDate),
  index("bookings_pet_idx").on(t.petId),
  index("bookings_tutor_idx").on(t.tutorId),
  index("bookings_status_idx").on(t.status)
]);

export const insertBookingSchema = createInsertSchema(bookingsTable).omit({ id: true, createdAt: true });
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookingsTable.$inferSelect;
