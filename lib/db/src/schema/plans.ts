import { pgTable, serial, text, integer, boolean, timestamp, pgEnum, unique, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const billingIntervalEnum = pgEnum("billing_interval", [
  "month",
  "quarter",
  "semester",
  "year",
]);

export const plansTable = pgTable("plans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  petLimit: integer("pet_limit").notNull(),
  staffLimit: integer("staff_limit"),
  storageBytesLimit: bigint("storage_bytes_limit", { mode: "number" }),
  // Monthly base price (centavos). Source of truth from which the longer
  // intervals are derived. Kept for backward compatibility and base display.
  priceBrl: integer("price_brl").notNull(),
  stripePriceId: text("stripe_price_id"),
  stripeProductId: text("stripe_product_id"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// One purchasable price per (plan, interval). priceBrl is the total charged per
// period (centavos); stripePriceId is filled by the seed-stripe script.
export const planPricesTable = pgTable(
  "plan_prices",
  {
    id: serial("id").primaryKey(),
    planId: integer("plan_id").notNull(),
    interval: billingIntervalEnum("interval").notNull(),
    priceBrl: integer("price_brl").notNull(),
    discountPct: integer("discount_pct").notNull().default(0),
    stripePriceId: text("stripe_price_id"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique("plan_prices_plan_interval_unique").on(t.planId, t.interval)],
);

export const insertPlanSchema = createInsertSchema(plansTable).omit({ id: true, createdAt: true });
export type InsertPlan = z.infer<typeof insertPlanSchema>;
export type Plan = Omit<typeof plansTable.$inferSelect, "staffLimit" | "storageBytesLimit"> & {
  staffLimit?: number | null;
  storageBytesLimit?: number | null;
};

export const insertPlanPriceSchema = createInsertSchema(planPricesTable).omit({ id: true, createdAt: true });
export type InsertPlanPrice = z.infer<typeof insertPlanPriceSchema>;
export type PlanPrice = typeof planPricesTable.$inferSelect;
