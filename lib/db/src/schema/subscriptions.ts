import { pgTable, serial, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { billingIntervalEnum } from "./plans";

export const subscriptionStatusEnum = pgEnum("creche_subscription_status", [
  "trial",
  "active",
  "past_due",
  "suspended",
  "cancelled",
]);

export const subscriptionsTable = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  crecheId: integer("creche_id").notNull().unique(),
  planId: integer("plan_id").notNull(),
  status: subscriptionStatusEnum("status").notNull().default("trial"),
  billingInterval: billingIntervalEnum("billing_interval"),
  trialEndsAt: timestamp("trial_ends_at"),
  currentPeriodEnd: timestamp("current_period_end"),
  pastDueSince: timestamp("past_due_since"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeCustomerId: text("stripe_customer_id"),
  // Timestamp of the last Stripe webhook event applied to this row. Used to
  // discard out-of-order (stale) webhook deliveries.
  lastStripeEventAt: timestamp("last_stripe_event_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Downgrade scheduling: when a user pays for a cheaper plan while still
  // inside an active period, the change is queued here and applied by the
  // scheduler when currentPeriodEnd is reached.
  scheduledPlanId: integer("scheduled_plan_id"),
  scheduledBillingInterval: billingIntervalEnum("scheduled_billing_interval"),
  // The new period end calculated from the point when the scheduled plan starts
  // (i.e. currentPeriodEnd + intervalMonths of the scheduled plan).
  scheduledPeriodEnd: timestamp("scheduled_period_end"),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({ id: true, createdAt: true });
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;
