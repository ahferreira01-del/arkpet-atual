import { pgTable, serial, text, integer, timestamp, pgEnum, boolean , index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userRoleEnum = pgEnum("user_role", ["master_admin", "creche_admin", "staff", "tutor"]);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("tutor"),
  crecheId: integer("creche_id"),
  avatarUrl: text("avatar_url"),
  cpf: text("cpf"), // Encrypted with AES-256-GCM
  phone: text("phone"), // Encrypted with AES-256-GCM
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  mensalidadeDia: integer("mensalidade_dia"),
  passwordChangedAt: timestamp("password_changed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("users_creche_idx").on(t.crecheId),
  index("users_role_idx").on(t.role)
]);

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
