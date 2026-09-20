import { pgTable, serial, varchar, text, integer, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const billingWebhookErrorStatusValues = [
  "PENDING_RECONCILIATION",
  "PROCESSING",
  "RESOLVED",
  "FAILED_FINAL",
] as const;
export type BillingWebhookErrorStatus = (typeof billingWebhookErrorStatusValues)[number];

export const billingWebhookErrorsTable = pgTable(
  "billing_webhook_errors",
  {
    id: serial("id").primaryKey(),
    eventId: varchar("event_id", { length: 255 }).notNull(),
    eventType: varchar("event_type", { length: 255 }).notNull(),
    stripePriceId: varchar("stripe_price_id", { length: 255 }),
    stripeSubscriptionId: varchar("stripe_subscription_id", { length: 255 }),
    customerId: varchar("customer_id", { length: 255 }),
    rawPayload: jsonb("raw_payload").notNull(),
    errorCode: varchar("error_code", { length: 100 }),
    errorMessage: text("error_message"),
    status: varchar("status", { length: 50 }).notNull().default("PENDING_RECONCILIATION"),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    retryCount: integer("retry_count").notNull().default(0),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: varchar("resolved_by", { length: 255 }),
    resolutionNote: text("resolution_note"),
  },
  (table) => [
    uniqueIndex("uq_billing_webhook_errors_event_id").on(table.eventId),
  ],
);

export const insertBillingWebhookErrorSchema = createInsertSchema(
  billingWebhookErrorsTable,
).omit({
  id: true,
  createdAt: true,
});
export type InsertBillingWebhookError = z.infer<
  typeof insertBillingWebhookErrorSchema
>;
export type BillingWebhookError = typeof billingWebhookErrorsTable.$inferSelect;
