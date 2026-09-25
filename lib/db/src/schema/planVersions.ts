import { pgTable, serial, varchar, text, integer, jsonb, timestamp, uniqueIndex, bigint } from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { plansTable } from "./plans";
import { usersTable } from "./users";

export const planVersionStatusValues = [
  "DRAFT",
  "ACTIVE",
  "SUPERSEDED",
  "ARCHIVED",
] as const;
export type PlanVersionStatus = (typeof planVersionStatusValues)[number];

export const planVersionsTable = pgTable(
  "plan_versions",
  {
    id: serial("id").primaryKey(),
    planId: integer("plan_id")
      .notNull()
      .references(() => plansTable.id),
    versionNumber: integer("version_number").notNull(),
    versionName: varchar("version_name", { length: 100 }),
    status: varchar("status", { length: 50 }).notNull().default("DRAFT"),
    petLimit: integer("pet_limit").notNull(),
    staffLimit: integer("staff_limit"),
    storageBytesLimit: bigint("storage_bytes_limit", { mode: "number" }).notNull(),
    // Base catalog reference price in centavos (R$)
    priceBrl: integer("price_brl").notNull().default(0),
    features: jsonb("features"),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    effectiveUntil: timestamp("effective_until", { withTimezone: true }),
    changeReason: text("change_reason"),
    activatedByUserId: integer("activated_by_user_id").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_plan_versions_plan_version_unique").on(table.planId, table.versionNumber),
    uniqueIndex("idx_plan_versions_one_active_per_plan")
      .on(table.planId)
      .where(sql`status = 'ACTIVE'`),
  ],
);

export const planVersionsRelations = relations(planVersionsTable, ({ one }) => ({
  plan: one(plansTable, {
    fields: [planVersionsTable.planId],
    references: [plansTable.id],
  }),
  activatedBy: one(usersTable, {
    fields: [planVersionsTable.activatedByUserId],
    references: [usersTable.id],
  }),
}));

export const insertPlanVersionSchema = createInsertSchema(planVersionsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPlanVersion = z.infer<typeof insertPlanVersionSchema>;
export type PlanVersion = typeof planVersionsTable.$inferSelect;
