import { pgTable, serial, integer, varchar, timestamp, text, check, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { crechesTable } from "./creches";
import { usersTable } from "./users";
import { catalogueItemsTable } from "./financial";

// Allowed Condition Types
export const TUTOR_CONDITION_TYPES = [
  "CUSTOM_PRICE",
  "PERCENTAGE_DISCOUNT",
  "FIXED_DISCOUNT",
] as const;
export type TutorConditionType = (typeof TUTOR_CONDITION_TYPES)[number];

// Allowed Condition Statuses
export const TUTOR_CONDITION_STATUSES = [
  "SCHEDULED",
  "ACTIVE",
  "SUPERSEDED",
  "EXPIRED",
  "REVOKED",
  "CANCELLED",
] as const;
export type TutorConditionStatus = (typeof TUTOR_CONDITION_STATUSES)[number];

// Pricing Source Types (extensible to CAMPAIGN in R37.C)
export const PRICING_SOURCE_TYPES = [
  "CATALOG",
  "TUTOR_CONDITION",
] as const;
export type PricingSourceType = (typeof PRICING_SOURCE_TYPES)[number];

// Audit Actions
export const TUTOR_COMMERCIAL_AUDIT_ACTIONS = [
  "TUTOR_CONDITION_CREATED",
  "TUTOR_CONDITION_SCHEDULED",
  "TUTOR_CONDITION_ACTIVATED",
  "TUTOR_CONDITION_SUPERSEDED",
  "TUTOR_CONDITION_REVOKED",
  "TUTOR_CONDITION_CANCELLED",
] as const;
export type TutorCommercialAuditAction = (typeof TUTOR_COMMERCIAL_AUDIT_ACTIONS)[number];

/**
 * 1. Tutor Commercial Conditions (Creche -> Tutor -> Item)
 * R37.B authoritative commercial conditions domain table.
 */
export const tutorCommercialConditionsTable = pgTable(
  "tutor_commercial_conditions",
  {
    id: serial("id").primaryKey(),
    crecheId: integer("creche_id").notNull().references(() => crechesTable.id, { onDelete: "restrict" }),
    tutorId: integer("tutor_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
    catalogueItemId: integer("catalogue_item_id").notNull().references(() => catalogueItemsTable.id, { onDelete: "restrict" }),
    
    conditionType: varchar("condition_type", { length: 32 }).notNull(),
    customPriceCents: integer("custom_price_cents"),
    percentageBps: integer("percentage_bps"),
    fixedDiscountCents: integer("fixed_discount_cents"),
    
    validFrom: timestamp("valid_from").notNull(),
    validUntil: timestamp("valid_until"),
    status: varchar("status", { length: 32 }).default("SCHEDULED").notNull(),
    
    reason: text("reason").notNull(),
    createdByUserId: integer("created_by_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
    supersedesConditionId: integer("supersedes_condition_id"),
    revokedByUserId: integer("revoked_by_user_id").references(() => usersTable.id, { onDelete: "restrict" }),
    revokedAt: timestamp("revoked_at"),
    
    idempotencyKey: varchar("idempotency_key", { length: 64 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    checkConditionType: check(
      "tutor_commercial_condition_type_check",
      sql`${table.conditionType} IN ('CUSTOM_PRICE', 'PERCENTAGE_DISCOUNT', 'FIXED_DISCOUNT')`
    ),
    checkStatus: check(
      "tutor_commercial_status_check",
      sql`${table.status} IN ('SCHEDULED', 'ACTIVE', 'SUPERSEDED', 'EXPIRED', 'REVOKED', 'CANCELLED')`
    ),
    checkValidityWindow: check(
      "tutor_commercial_validity_window_check",
      sql`${table.validUntil} IS NULL OR ${table.validUntil} > ${table.validFrom}`
    ),
    checkCustomPrice: check(
      "tutor_commercial_custom_price_check",
      sql`${table.conditionType} != 'CUSTOM_PRICE' OR (${table.customPriceCents} IS NOT NULL AND ${table.customPriceCents} >= 0 AND ${table.percentageBps} IS NULL AND ${table.fixedDiscountCents} IS NULL)`
    ),
    checkPercentageDiscount: check(
      "tutor_commercial_percentage_check",
      sql`${table.conditionType} != 'PERCENTAGE_DISCOUNT' OR (${table.percentageBps} IS NOT NULL AND ${table.percentageBps} >= 0 AND ${table.percentageBps} <= 10000 AND ${table.customPriceCents} IS NULL AND ${table.fixedDiscountCents} IS NULL)`
    ),
    checkFixedDiscount: check(
      "tutor_commercial_fixed_discount_check",
      sql`${table.conditionType} != 'FIXED_DISCOUNT' OR (${table.fixedDiscountCents} IS NOT NULL AND ${table.fixedDiscountCents} >= 0 AND ${table.customPriceCents} IS NULL AND ${table.percentageBps} IS NULL)`
    ),
    crecheTutorItemIdx: index("tutor_commercial_creche_tutor_item_idx").on(
      table.crecheId,
      table.tutorId,
      table.catalogueItemId
    ),
    statusValidityIdx: index("tutor_commercial_status_validity_idx").on(
      table.crecheId,
      table.tutorId,
      table.catalogueItemId,
      table.status,
      table.validFrom,
      table.validUntil
    ),
    uniqueIdempotencyIdx: uniqueIndex("tutor_commercial_unique_idempotency_idx")
      .on(table.crecheId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
  })
);

export const tutorCommercialConditionsRelations = relations(tutorCommercialConditionsTable, ({ one }) => ({
  creche: one(crechesTable, {
    fields: [tutorCommercialConditionsTable.crecheId],
    references: [crechesTable.id],
  }),
  tutor: one(usersTable, {
    fields: [tutorCommercialConditionsTable.tutorId],
    references: [usersTable.id],
  }),
  catalogueItem: one(catalogueItemsTable, {
    fields: [tutorCommercialConditionsTable.catalogueItemId],
    references: [catalogueItemsTable.id],
  }),
  createdByUser: one(usersTable, {
    fields: [tutorCommercialConditionsTable.createdByUserId],
    references: [usersTable.id],
  }),
  revokedByUser: one(usersTable, {
    fields: [tutorCommercialConditionsTable.revokedByUserId],
    references: [usersTable.id],
  }),
}));

/**
 * 2. Tutor Commercial Operations Ledger (Idempotency Engine)
 * Replays identical requests, conflicts on mismatched payloads/tutors.
 */
export const tutorCommercialOperationsTable = pgTable(
  "tutor_commercial_operations",
  {
    id: serial("id").primaryKey(),
    crecheId: integer("creche_id").notNull().references(() => crechesTable.id, { onDelete: "restrict" }),
    tutorId: integer("tutor_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
    idempotencyKey: varchar("idempotency_key", { length: 64 }).notNull(),
    operationType: varchar("operation_type", { length: 64 }).notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(), // 'IN_PROGRESS', 'SUCCEEDED', 'FAILED'
    responseJson: jsonb("response_json"),
    conditionId: integer("condition_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqueCrecheKeyIdx: uniqueIndex("tutor_commercial_ops_creche_key_idx").on(
      table.crecheId,
      table.idempotencyKey
    ),
  })
);

/**
 * 3. Tutor Commercial Audits (Append-only Audit Log)
 * Immutable audit trail for B2C commercial condition mutations.
 */
export const tutorCommercialAuditsTable = pgTable(
  "tutor_commercial_audits",
  {
    id: serial("id").primaryKey(),
    crecheId: integer("creche_id").notNull().references(() => crechesTable.id, { onDelete: "restrict" }),
    tutorId: integer("tutor_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
    conditionId: integer("condition_id"),
    catalogueItemId: integer("catalogue_item_id"),
    action: varchar("action", { length: 64 }).notNull(),
    actorUserId: integer("actor_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
    actorRole: varchar("actor_role", { length: 32 }).notNull(),
    reason: text("reason").notNull(),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    requestId: varchar("request_id", { length: 64 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    crecheTutorCreatedIdx: index("tutor_commercial_audits_creche_tutor_idx").on(
      table.crecheId,
      table.tutorId,
      table.createdAt
    ),
  })
);

export type TutorCommercialCondition = typeof tutorCommercialConditionsTable.$inferSelect;
export type InsertTutorCommercialCondition = typeof tutorCommercialConditionsTable.$inferInsert;

export type TutorCommercialOperation = typeof tutorCommercialOperationsTable.$inferSelect;
export type InsertTutorCommercialOperation = typeof tutorCommercialOperationsTable.$inferInsert;

export type TutorCommercialAudit = typeof tutorCommercialAuditsTable.$inferSelect;
export type InsertTutorCommercialAudit = typeof tutorCommercialAuditsTable.$inferInsert;
