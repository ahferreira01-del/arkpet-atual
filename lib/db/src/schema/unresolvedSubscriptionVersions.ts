import { pgTable, serial, integer, varchar, text, timestamp, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { subscriptionsTable } from "./subscriptions";
import { crechesTable } from "./creches";
import { usersTable } from "./users";

export const unresolvedSubscriptionVersionsTable = pgTable(
  "unresolved_subscription_versions",
  {
    id: serial("id").primaryKey(),
    subscriptionId: integer("subscription_id")
      .notNull()
      .references(() => subscriptionsTable.id),
    crecheId: integer("creche_id").notNull(),
    diagnosticCategory: varchar("diagnostic_category", { length: 100 }).notNull(),
    notes: text("notes"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: integer("resolved_by_user_id").references(() => usersTable.id),
    resolutionAction: text("resolution_action"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_unresolved_sub_versions_sub_id").on(table.subscriptionId),
    index("idx_unresolved_sub_versions_creche_id").on(table.crecheId),
  ],
);

export const unresolvedSubscriptionVersionsRelations = relations(
  unresolvedSubscriptionVersionsTable,
  ({ one }) => ({
    subscription: one(subscriptionsTable, {
      fields: [unresolvedSubscriptionVersionsTable.subscriptionId],
      references: [subscriptionsTable.id],
    }),
    creche: one(crechesTable, {
      fields: [unresolvedSubscriptionVersionsTable.crecheId],
      references: [crechesTable.id],
    }),
    resolvedBy: one(usersTable, {
      fields: [unresolvedSubscriptionVersionsTable.resolvedByUserId],
      references: [usersTable.id],
    }),
  }),
);

export const insertUnresolvedSubscriptionVersionSchema = createInsertSchema(
  unresolvedSubscriptionVersionsTable,
).omit({
  id: true,
  createdAt: true,
});
export type InsertUnresolvedSubscriptionVersion = z.infer<
  typeof insertUnresolvedSubscriptionVersionSchema
>;
export type UnresolvedSubscriptionVersion =
  typeof unresolvedSubscriptionVersionsTable.$inferSelect;
