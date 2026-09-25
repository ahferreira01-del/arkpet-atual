import { pgTable, varchar, integer, bigint, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { crechesTable } from "./creches";

export const storageFileStatusValues = [
  "reserved",
  "confirmed",
  "deleting",
  "deleted",
  "expired_cleanup_deleting",
  "abandoned",
  "rejected_overflow_deleting",
  "rejected_overflow_deleted",
] as const;
export type StorageFileStatus = (typeof storageFileStatusValues)[number];

export const tenantStorageLedgerTable = pgTable("tenant_storage_ledger", {
  crecheId: integer("creche_id")
    .primaryKey()
    .references(() => crechesTable.id),
  usedBytes: bigint("used_bytes", { mode: "number" }).notNull().default(0),
  reservedBytes: bigint("reserved_bytes", { mode: "number" }).notNull().default(0),
  fileCount: integer("file_count").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantStorageLedgerRelations = relations(tenantStorageLedgerTable, ({ one }) => ({
  creche: one(crechesTable, {
    fields: [tenantStorageLedgerTable.crecheId],
    references: [crechesTable.id],
  }),
}));

export const insertTenantStorageLedgerSchema = createInsertSchema(tenantStorageLedgerTable);
export type InsertTenantStorageLedger = z.infer<typeof insertTenantStorageLedgerSchema>;
export type TenantStorageLedger = typeof tenantStorageLedgerTable.$inferSelect;

export const storageFilesTable = pgTable(
  "storage_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    crecheId: integer("creche_id")
      .notNull()
      .references(() => crechesTable.id),
    fileKey: varchar("file_key", { length: 1024 }).notNull().unique(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    contentType: varchar("content_type", { length: 255 }).notNull(),
    status: varchar("status", { length: 50 }).notNull().default("reserved"),
    reservationExpiresAt: timestamp("reservation_expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_storage_files_creche_id").on(table.crecheId),
    index("idx_storage_files_status").on(table.status),
  ],
);

export const storageFilesRelations = relations(storageFilesTable, ({ one }) => ({
  creche: one(crechesTable, {
    fields: [storageFilesTable.crecheId],
    references: [crechesTable.id],
  }),
}));

export const insertStorageFileSchema = createInsertSchema(storageFilesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertStorageFile = z.infer<typeof insertStorageFileSchema>;
export type StorageFile = typeof storageFilesTable.$inferSelect;
