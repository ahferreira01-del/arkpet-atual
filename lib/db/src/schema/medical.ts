import { pgTable, serial, text, integer, timestamp, date, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vaccinesTable = pgTable("vaccines", {
  id: serial("id").primaryKey(),
  petId: integer("pet_id").notNull(),
  crecheId: integer("creche_id").notNull(),
  name: text("name").notNull(),
  appliedDate: date("applied_date").notNull(),
  nextDueDate: date("next_due_date"),
  veterinarian: text("veterinarian"),
  notes: text("notes"),
  receiptUrl: text("receipt_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const medicationsTable = pgTable("medications", {
  id: serial("id").primaryKey(),
  petId: integer("pet_id").notNull(),
  crecheId: integer("creche_id").notNull(),
  name: text("name").notNull(),
  dosage: text("dosage").notNull(),
  frequency: text("frequency").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  times: jsonb("times").notNull().$type<string[]>(),
  lastAdministered: timestamp("last_administered"),
  administeredBy: text("administered_by"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertVaccineSchema = createInsertSchema(vaccinesTable).omit({ id: true, createdAt: true });
export const insertMedicationSchema = createInsertSchema(medicationsTable).omit({ id: true, createdAt: true });

export type InsertVaccine = z.infer<typeof insertVaccineSchema>;
export type Vaccine = typeof vaccinesTable.$inferSelect;
export type InsertMedication = z.infer<typeof insertMedicationSchema>;
export type Medication = typeof medicationsTable.$inferSelect;
