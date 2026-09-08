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
    snapshotBillingInterval: varchar("snapshot_billing_interval", { length: 20 }),
    snapshotBasePriceCents: integer("snapshot_base_price_cents"),
    lastSynchronizedAmountCents: integer("last_synchronized_amount_cents"),
    lastSyncError: text("last_sync_error"),
    assignedBenefitId: integer("assigned_benefit_id"),
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
    assignedBenefitIdx: index("customer_commercial_conditions_assigned_benefit_idx").on(
      table.assignedBenefitId,
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

// 5. Commercial Operation Requests
// Durable idempotency ledger for privileged commercial lifecycle operations.
// Supports atomic lease claim, concurrency containment, multi-command historical replay,
// and safe failure categorization.
export const commercialOperationStatusValues = [
  "PROCESSING",
  "SUCCEEDED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
] as const;
export type CommercialOperationStatus = (typeof commercialOperationStatusValues)[number];

export const commercialOperationRequestsTable = pgTable(
  "commercial_operation_requests",
  {
    id: serial("id").primaryKey(),
    crecheId: integer("creche_id").references(() => crechesTable.id),
    operation: varchar("operation", { length: 64 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    resourceType: varchar("resource_type", { length: 64 }),
    resourceId: integer("resource_id"),
    status: varchar("status", { length: 32 }).notNull().default("PROCESSING"),
    attemptCount: integer("attempt_count").notNull().default(1),
    statusCode: integer("status_code"),
    responsePayload: jsonb("response_payload"),
    errorCode: varchar("error_code", { length: 64 }),
    errorMessage: text("error_message"),
    processingStartedAt: timestamp("processing_started_at").notNull().defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => ({
    crecheIdempotencyIdx: uniqueIndex("commercial_operation_requests_creche_idempotency_unique")
      .on(table.crecheId, table.idempotencyKey)
      .where(sql`${table.crecheId} IS NOT NULL`),
    globalIdempotencyIdx: uniqueIndex("commercial_operation_requests_global_idempotency_unique")
      .on(table.idempotencyKey)
      .where(sql`${table.crecheId} IS NULL`),
    crecheOperationIdx: index("commercial_operation_requests_creche_operation_idx").on(
      table.crecheId,
      table.operation,
    ),
    statusLeaseIdx: index("commercial_operation_requests_status_lease_idx").on(
      table.status,
      table.leaseExpiresAt,
    ),
  }),
);

export const insertCommercialOperationRequestSchema = createInsertSchema(
  commercialOperationRequestsTable,
).omit({ id: true, createdAt: true });
export type InsertCommercialOperationRequest = z.infer<typeof insertCommercialOperationRequestSchema>;
export type CommercialOperationRequest = typeof commercialOperationRequestsTable.$inferSelect;

// 6. Commercial Campaigns
export const commercialCampaignStatusValues = [
  "draft",
  "active",
  "paused",
  "closed",
  "archived",
] as const;
export type CommercialCampaignStatus = (typeof commercialCampaignStatusValues)[number];

export const commercialBenefitTypeValues = [
  "PERCENTAGE_DISCOUNT",
  "FIXED_DISCOUNT",
  "FIXED_PROMOTIONAL_PRICE",
] as const;
export type CommercialBenefitType = (typeof commercialBenefitTypeValues)[number];

export const assignedCommercialBenefitStatusValues = [
  "pending_activation",
  "scheduled",
  "active",
  "completed",
  "failed",
  "cancelled",
  "restoration_review",
] as const;
export type AssignedCommercialBenefitStatus = (typeof assignedCommercialBenefitStatusValues)[number];

export const campaignAssignmentModeValues = [
  "MASTER_ADMIN_SAFE_ASSIGNMENT",
] as const;
export type CampaignAssignmentMode = (typeof campaignAssignmentModeValues)[number];

export const commercialCampaignsTable = pgTable(
  "commercial_campaigns",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    status: varchar("status", { length: 32 }).notNull().default("draft"),
    eligibleFrom: timestamp("eligible_from"),
    eligibleUntil: timestamp("eligible_until"),
    priority: integer("priority").notNull().default(0),
    assignmentMode: varchar("assignment_mode", { length: 64 }).notNull().default("MASTER_ADMIN_SAFE_ASSIGNMENT"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index("commercial_campaigns_status_idx").on(table.status),
    priorityIdx: index("commercial_campaigns_priority_idx").on(table.priority),
  }),
);

export const insertCommercialCampaignSchema = createInsertSchema(commercialCampaignsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCommercialCampaign = z.infer<typeof insertCommercialCampaignSchema>;
export type CommercialCampaign = typeof commercialCampaignsTable.$inferSelect;

// 7. Commercial Campaign Benefits
export const commercialCampaignBenefitsTable = pgTable(
  "commercial_campaign_benefits",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id").notNull().references(() => commercialCampaignsTable.id),
    benefitType: varchar("benefit_type", { length: 64 }).notNull(),
    benefitValue: integer("benefit_value").notNull(),
    billingCycles: integer("billing_cycles").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    singleBenefitPerCampaignIdx: uniqueIndex("commercial_campaign_benefits_campaign_unique").on(table.campaignId),
  }),
);

export const insertCommercialCampaignBenefitSchema = createInsertSchema(commercialCampaignBenefitsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCommercialCampaignBenefit = z.infer<typeof insertCommercialCampaignBenefitSchema>;
export type CommercialCampaignBenefit = typeof commercialCampaignBenefitsTable.$inferSelect;

// 8. Assigned Commercial Benefits (Immutable Snapshot)
export const assignedCommercialBenefitsTable = pgTable(
  "assigned_commercial_benefits",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id").notNull().references(() => commercialCampaignsTable.id),
    campaignBenefitId: integer("campaign_benefit_id").notNull().references(() => commercialCampaignBenefitsTable.id),
    crecheId: integer("creche_id").notNull().references(() => crechesTable.id),
    status: varchar("status", { length: 32 }).notNull().default("scheduled"),
    campaignName: text("campaign_name").notNull(),
    benefitType: varchar("benefit_type", { length: 64 }).notNull(),
    benefitValue: integer("benefit_value").notNull(),
    billingCycles: integer("billing_cycles").notNull(),
    targetPlanId: integer("target_plan_id").notNull(),
    targetBillingInterval: varchar("target_billing_interval", { length: 32 }).notNull(),
    catalogPriceCents: integer("catalog_price_cents").notNull(),
    predecessorConditionId: integer("predecessor_condition_id").references(() => customerCommercialConditionsTable.id),
    predecessorEffectivePriceCents: integer("predecessor_effective_price_cents").notNull(),
    promotionalPriceCents: integer("promotional_price_cents").notNull(),
    restorationPriceCents: integer("restoration_price_cents").notNull(),
    entitlementPetLimit: integer("entitlement_pet_limit"),
    commercialConditionId: integer("commercial_condition_id").references(() => customerCommercialConditionsTable.id),
    restorationConditionId: integer("restoration_condition_id").references(() => customerCommercialConditionsTable.id),
    stripeSubscriptionId: text("stripe_subscription_id").notNull(),
    stripeScheduleId: text("stripe_schedule_id"),
    promotionalStripePriceId: text("promotional_stripe_price_id"),
    restorationStripePriceId: text("restoration_stripe_price_id"),
    scheduledStartPeriod: timestamp("scheduled_start_period"),
    firstConsumedPeriodStart: timestamp("first_consumed_period_start"),
    lastConsumedPeriodEnd: timestamp("last_consumed_period_end"),
    assignedBy: text("assigned_by"),
    assignedAt: timestamp("assigned_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
    failureReason: text("failure_reason"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    crecheStatusIdx: index("assigned_commercial_benefits_creche_status_idx").on(table.crecheId, table.status),
    campaignCrecheIdx: index("assigned_commercial_benefits_campaign_creche_idx").on(table.campaignId, table.crecheId),
    // Enforces at most ONE active/scheduled/pending/review recurring campaign benefit per creche (Non-stacking rule)
    singleActiveCampaignIdx: uniqueIndex("assigned_commercial_benefits_single_active_idx")
      .on(table.crecheId)
      .where(sql`${table.status} IN ('pending', 'pending_activation', 'scheduled', 'active', 'restoration_review')`),
  }),
);

export const insertAssignedCommercialBenefitSchema = createInsertSchema(assignedCommercialBenefitsTable).omit({
  id: true,
  assignedAt: true,
  updatedAt: true,
});
export type InsertAssignedCommercialBenefit = z.infer<typeof insertAssignedCommercialBenefitSchema>;
export type AssignedCommercialBenefit = typeof assignedCommercialBenefitsTable.$inferSelect;

// 9. Benefit Cycle Consumptions (Canonical Cycle Ledger)
export const benefitCycleConsumptionsTable = pgTable(
  "benefit_cycle_consumptions",
  {
    id: serial("id").primaryKey(),
    assignedBenefitId: integer("assigned_benefit_id").notNull().references(() => assignedCommercialBenefitsTable.id),
    cycleKey: text("cycle_key").notNull(),
    contractualPeriodStart: timestamp("contractual_period_start").notNull(),
    contractualPeriodEnd: timestamp("contractual_period_end").notNull(),
    cycleNumber: integer("cycle_number").notNull(),
    source: varchar("source", { length: 64 }).notNull().default("stripe_subscription_cycle"),
    sourceReferenceId: text("source_reference_id"),
    consumedAt: timestamp("consumed_at").notNull().defaultNow(),
  },
  (table) => ({
    assignedCycleKeyUnique: uniqueIndex("benefit_cycle_consumptions_assigned_cycle_key_unique").on(
      table.assignedBenefitId,
      table.cycleKey,
    ),
    assignedBenefitIdx: index("benefit_cycle_consumptions_assigned_benefit_idx").on(table.assignedBenefitId),
  }),
);

export const insertBenefitCycleConsumptionSchema = createInsertSchema(benefitCycleConsumptionsTable).omit({
  id: true,
  consumedAt: true,
});
export type InsertBenefitCycleConsumption = z.infer<typeof insertBenefitCycleConsumptionSchema>;
export type BenefitCycleConsumption = typeof benefitCycleConsumptionsTable.$inferSelect;
