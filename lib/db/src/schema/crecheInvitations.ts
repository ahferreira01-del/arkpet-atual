import { pgTable, serial, varchar, integer, timestamp, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { crechesTable } from "./creches";
import { usersTable } from "./users";

export const invitationStatusValues = ["pending", "accepted", "revoked", "expired"] as const;
export type InvitationStatus = (typeof invitationStatusValues)[number];

export const invitationRoleValues = ["creche_admin", "staff", "tutor"] as const;
export type InvitationRole = (typeof invitationRoleValues)[number];

export const crecheInvitationsTable = pgTable(
  "creche_invitations",
  {
    id: serial("id").primaryKey(),
    crecheId: integer("creche_id")
      .notNull()
      .references(() => crechesTable.id),
    email: varchar("email", { length: 255 }).notNull(),
    role: varchar("role", { length: 50 }).notNull(),
    token: varchar("token", { length: 255 }).notNull().unique(),
    status: varchar("status", { length: 50 }).notNull().default("pending"),
    invitedByUserId: integer("invited_by_user_id").references(() => usersTable.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_creche_invitations_creche_id").on(table.crecheId),
    index("idx_creche_invitations_email").on(table.email),
    index("idx_creche_invitations_status").on(table.status),
  ],
);

export const crecheInvitationsRelations = relations(crecheInvitationsTable, ({ one }) => ({
  creche: one(crechesTable, {
    fields: [crecheInvitationsTable.crecheId],
    references: [crechesTable.id],
  }),
  invitedBy: one(usersTable, {
    fields: [crecheInvitationsTable.invitedByUserId],
    references: [usersTable.id],
  }),
}));

export const insertCrecheInvitationSchema = createInsertSchema(crecheInvitationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCrecheInvitation = z.infer<typeof insertCrecheInvitationSchema>;
export type CrecheInvitation = typeof crecheInvitationsTable.$inferSelect;
