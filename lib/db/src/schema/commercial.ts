import { pgTable, serial, text, integer, timestamp, varchar, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { crechesTable } from "./creches";
import { plansTable } from "./plans";

// Status enums as string literals / varchar for maximum robustness and zero-migration runtime safety
export const commercialConditionStatusValues = [
  "draft",
  "pending_activation",
  "active",
  "activation_failed",
  "superseded",
  "cancelled",
  "abandoned",
] as const;
export type CommercialConditionStatus = (typeof commercialConditionStatusValues)[number];

export const pricingOverrideTypeValues = [
  "none",
  "fixed_amount",
  "percentage",
] as const;
export type PricingOverrideType = (typeof pricingOverrideTypeValues)[number];

export const commercialConditionSyncStatusValues = [
  "not_started",
  "sync_pending",
  "synced",
  "sync_failed",
  "divergent",
] as const;
export type CommercialConditionSyncStatus = (typeof commercialConditionSyncStatusValues)[number];

export const commercialAgreementStatusValues = [
  "draft",
  "sent",
  "accepted",
  "declined",
  "expired",
  "superseded",
] as const;
export type CommercialAgreementStatus = (typeof commercialAgreementStatusValues)[number];

export const commercialAuditActorTypeValues = ["user", "system", "gateway"] as const;
export type CommercialAuditActorType = (typeof commercialAuditActorTypeValues)[number];

export const gatewayEventStatusValues = [
  "received",
  "processing",
  "processed",
  "failed_retryable",
  "failed_final",
  "ignored",
] as const;
export type GatewayEventStatus = (typeof gatewayEventStatusValues)[number];

// 1. Customer Commercial Conditions
// Full snapshot model — represents the complete customer-specific condition for that version.
// Never a sparse patch.
export const customerCommercialConditionsTable = pgTable(
  "customer_commercial_conditions",
  {
    id: serial("id").primaryKey(),
    crecheId: integer("creche_id").notNull().references(() => crechesTable.id),
    planId: integer("plan_id").references(() => plansTable.id),
    pricingOverrideType: varchar("pricing_override_type", { length: 50 }).default("none"),
    pricingOverrideValue: integer("pricing_override_value"), // fixed centavos or discount pct
    entitlementPetLimit: integer("entitlement_pet_limit"), // petLimit is the ONLY approved entitlement override
    validFrom: timestamp("valid_from").notNull().defaultNow(),
    validUntil: timestamp("valid_until"),
    status: varchar("status", { length: 30 }).notNull().default("draft"),
    predecessorId: integer("predecessor_id"),
    agreementId: integer("agreement_id"),
    reason: text("reason"),
    executionRequirement: varchar("execution_requirement", { length: 50 }).default("none"),
    syncStatus: varchar("sync_status", { length: 50 }).notNull().default("not_started"),
    idempotencyKey: varchar("idempotency_key", { length: 100 }),
    idempotencyOperation: varchar("idempotency_operation", { length: 50 }),
    requestFingerprint: text("request_fingerprint"),
    stripePriceId: text("stripe_price_id"), // custom recurring Stripe Price created for this condition
    lastSyncError: text("last_sync_error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    // Enforces at most ONE ACTIVE condition per creche at the database level
    singleActiveIdx: uniqueIndex("customer_commercial_conditions_single_active_idx")
      .on(table.crecheId)
      .where(sql`${table.status} = 'active'`),
    idempotencyIdx: uniqueIndex("customer_commercial_conditions_idempotency_idx")
      .on(table.crecheId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
    crecheStatusIdx: index("customer_commercial_conditions_creche_status_idx").on(
      table.crecheId,
      table.status,
    ),
  }),
);

export const insertCustomerCommercialConditionSchema = createInsertSchema(
  customerCommercialConditionsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCustomerCommercialCondition = z.infer<typeof insertCustomerCommercialConditionSchema>;
export type CustomerCommercialCondition = typeof customerCommercialConditionsTable.$inferSelect;

// 2. Commercial Agreements
// Supports proposal states: draft, sent, accepted, declined, expired, superseded.
// accepted terms are historically immutable snapshots stored in snapshotJson.
export const commercialAgreementsTable = pgTable(
  "commercial_agreements",
  {
    id: serial("id").primaryKey(),
    crecheId: integer("creche_id").notNull().references(() => crechesTable.id),
    type: varchar("type", { length: 50 }).notNull(),
    status: varchar("status", { length: 30 }).notNull().default("draft"),
    snapshotJson: jsonb("snapshot_json"),
    sentAt: timestamp("sent_at"),
    acceptedAt: timestamp("accepted_at"),
    acceptedByUserId: integer("accepted_by_user_id"),
    validUntil: timestamp("valid_until"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    crecheTypeIdx: index("commercial_agreements_creche_type_idx").on(table.crecheId, table.type),
    crecheStatusIdx: index("commercial_agreements_creche_status_idx").on(table.crecheId, table.status),
  }),
);

export const insertCommercialAgreementSchema = createInsertSchema(commercialAgreementsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCommercialAgreement = z.infer<typeof insertCommercialAgreementSchema>;
export type CommercialAgreement = typeof commercialAgreementsTable.$inferSelect;

// 3. Commercial Audit Ledger
// Durable append-oriented audit ledger for commercial actions.
// Supports USER, SYSTEM, and GATEWAY actors.
export const commercialAuditLedgerTable = pgTable(
  "commercial_audit_ledger",
  {
    id: serial("id").primaryKey(),
    targetCrecheId: integer("target_creche_id").notNull().references(() => crechesTable.id),
    actorType: varchar("actor_type", { length: 20 }).notNull(), // 'user' | 'system' | 'gateway'
    actorId: integer("actor_id"),
    actorRole: varchar("actor_role", { length: 50 }),
    actorEmail: text("actor_email"),
    action: varchar("action", { length: 100 }).notNull(),
    reason: text("reason"), // Mandatory for actorType = 'user'
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    executionRequirement: varchar("execution_requirement", { length: 50 }),
    executionStatus: varchar("execution_status", { length: 50 }),
    relatedAgreementId: integer("related_agreement_id"),
    relatedConditionId: integer("related_condition_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    targetCrecheIdx: index("commercial_audit_ledger_creche_created_idx").on(
      table.targetCrecheId,
      table.createdAt,
    ),
    actorTypeIdx: index("commercial_audit_ledger_actor_type_idx").on(table.actorType),
  }),
);

export const insertCommercialAuditLedgerSchema = createInsertSchema(commercialAuditLedgerTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCommercialAuditLedger = z.infer<typeof insertCommercialAuditLedgerSchema>;
export type CommercialAuditLedger = typeof commercialAuditLedgerTable.$inferSelect;

// 4. Gateway Events
// Manages external webhook idempotency, concurrency claims, leases, and failure containment.
export const gatewayEventsTable = pgTable(
  "gateway_events",
  {
    id: serial("id").primaryKey(),
    gateway: varchar("gateway", { length: 30 }).notNull().default("stripe"),
    eventId: varchar("event_id", { length: 255 }).notNull().unique(),
    eventType: varchar("event_type", { length: 100 }).notNull(),
    eventCreated: timestamp("event_created"),
    status: varchar("status", { length: 30 }).notNull().default("received"),
    retryCount: integer("retry_count").notNull().default(0),
    errorMessage: text("error_message"),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    processingStartedAt: timestamp("processing_started_at"),
    leaseExpiresAt: timestamp("lease_expires_at"),
    processedAt: timestamp("processed_at"),
    payload: jsonb("payload"),
  },
  (table) => ({
    gatewayEventIdx: uniqueIndex("gateway_events_gateway_event_id_unique").on(
      table.gateway,
      table.eventId,
    ),
    statusLeaseIdx: index("gateway_events_status_lease_idx").on(table.status, table.leaseExpiresAt),
  }),
);

export const insertGatewayEventSchema = createInsertSchema(gatewayEventsTable).omit({
  id: true,
  receivedAt: true,
});
export type InsertGatewayEvent = z.infer<typeof insertGatewayEventSchema>;
export type GatewayEvent = typeof gatewayEventsTable.$inferSelect;
