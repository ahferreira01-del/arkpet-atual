import { pgTable, serial, integer, varchar, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { billingIntervalEnum } from "./plans";
import { planVersionsTable } from "./planVersions";

export const planVersionPricesTable = pgTable(
  "plan_version_prices",
  {
    id: serial("id").primaryKey(),
    planVersionId: integer("plan_version_id")
      .notNull()
      .references(() => planVersionsTable.id, { onDelete: "cascade" }),
    interval: billingIntervalEnum("interval").notNull(),
    // Total charged per interval in centavos (R$ cents, >= 0)
    priceBrl: integer("price_brl").notNull(),
    stripePriceId: varchar("stripe_price_id", { length: 255 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_plan_version_prices_version_interval_unique").on(
      table.planVersionId,
      table.interval,
    ),
    uniqueIndex("idx_plan_version_prices_stripe_price_id_unique")
      .on(table.stripePriceId)
      .where(sql`stripe_price_id IS NOT NULL`),
  ],
);

export const planVersionPricesRelations = relations(planVersionPricesTable, ({ one }) => ({
  version: one(planVersionsTable, {
    fields: [planVersionPricesTable.planVersionId],
    references: [planVersionsTable.id],
  }),
}));

export const insertPlanVersionPriceSchema = createInsertSchema(planVersionPricesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPlanVersionPrice = z.infer<typeof insertPlanVersionPriceSchema>;
export type PlanVersionPrice = typeof planVersionPricesTable.$inferSelect;
