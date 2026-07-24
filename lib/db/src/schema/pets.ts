import { pgTable, serial, text, integer, timestamp, pgEnum, real, date, boolean, jsonb, uuid, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const petSpeciesEnum = pgEnum("pet_species", ["dog", "cat", "bird", "rabbit", "other"]);
export const petGenderEnum = pgEnum("pet_gender", ["male", "female", "unknown"]);
export const petTemperamentEnum = pgEnum("pet_temperament", ["calm", "playful", "aggressive", "shy", "sociable"]);
export const petStatusEnum = pgEnum("pet_status", ["active", "inactive"]);
export const petSizeEnum = pgEnum("pet_size", ["small", "medium", "large"]);

export const petsTable = pgTable("pets", {
  id: serial("id").primaryKey(),
  crecheId: integer("creche_id").notNull(),
  tutorId: integer("tutor_id").notNull(),
  name: text("name").notNull(),
  species: petSpeciesEnum("species").notNull(),
  breed: text("breed"),
  birthDate: date("birth_date"),
  gender: petGenderEnum("gender").notNull().default("unknown"),
  size: petSizeEnum("size").notNull().default("medium"),
  weight: real("weight"),
  color: text("color"),
  temperament: petTemperamentEnum("temperament"),
  allergies: text("allergies"),
  specialNeeds: text("special_needs"),
  photoUrl: text("photo_url"),
  lastCheckinPhotoUrl: text("last_checkin_photo_url"),
  isCheckedIn: boolean("is_checked_in").notNull().default(false),
  feedingSchedule: jsonb("feeding_schedule"),
  walkSchedule: jsonb("walk_schedule"),
  qrToken: text("qr_token").unique().default(sql`gen_random_uuid()`),
  isCastrated: boolean("is_castrated").notNull().default(false),
  status: petStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("pets_creche_idx").on(t.crecheId),
  index("pets_tutor_idx").on(t.tutorId),
  index("pets_status_idx").on(t.status)
]);

export const insertPetSchema = createInsertSchema(petsTable).omit({ id: true, createdAt: true });
export type InsertPet = z.infer<typeof insertPetSchema>;
export type Pet = typeof petsTable.$inferSelect;
