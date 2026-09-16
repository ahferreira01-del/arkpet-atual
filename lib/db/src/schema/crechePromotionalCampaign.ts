import { pgTable, serial, integer, varchar, timestamp, text, check, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { crechesTable } from "./creches";
import { usersTable } from "./users";
import { catalogueItemsTable, bookingServicesTable, invoicesTable, invoiceItemsTable } from "./financial";
import { bookingsTable } from "./bookings";

// Allowed Campaign Benefit Types
export const CAMPAIGN_BENEFIT_TYPES = [
  "PERCENTAGE_DISCOUNT",
  "FIXED_DISCOUNT",
  "FIXED_PROMOTIONAL_PRICE",
] as const;
export type CampaignBenefitType = (typeof CAMPAIGN_BENEFIT_TYPES)[number];

// Allowed Campaign Statuses (CANONICAL: NO CANCELLED)
export const CAMPAIGN_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "ACTIVE",
  "PAUSED",
  "ENDED",
  "REVOKED",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

// Allowed Audience Types
export const CAMPAIGN_AUDIENCE_TYPES = [
  "ALL_ACTIVE_TUTORS",
  "SELECTED_TUTORS",
] as const;
export type CampaignAudienceType = (typeof CAMPAIGN_AUDIENCE_TYPES)[number];

// Allowed Condition Interaction Policies
export const CAMPAIGN_INTERACTION_POLICIES = [
  "EXCLUDE_IF_TUTOR_CONDITION",
  "ALLOW_IF_BETTER",
] as const;
export type CampaignInteractionPolicy = (typeof CAMPAIGN_INTERACTION_POLICIES)[number];

// Allowed Usage Limit Types
export const CAMPAIGN_USAGE_LIMIT_TYPES = [
  "UNLIMITED",
  "ONCE_PER_TUTOR",
  "N_PER_TUTOR",
] as const;
export type CampaignUsageLimitType = (typeof CAMPAIGN_USAGE_LIMIT_TYPES)[number];

// Allowed Campaign Audit Actions
export const CAMPAIGN_AUDIT_ACTIONS = [
  "CAMPAIGN_CREATED",
  "CAMPAIGN_UPDATED_DRAFT",
  "CAMPAIGN_PUBLISHED",
  "CAMPAIGN_PAUSED",
  "CAMPAIGN_RESUMED",
  "CAMPAIGN_SUPERSEDED",
  "CAMPAIGN_REVOKED",
  "CAMPAIGN_ENDED",
  "CAMPAIGN_REDEMPTION_RESERVED",
  "CAMPAIGN_REDEMPTION_RELEASED",
] as const;
export type CampaignAuditAction = (typeof CAMPAIGN_AUDIT_ACTIONS)[number];

// Allowed Campaign Redemption Statuses (CANONICAL: RESERVED, APPLIED, RELEASED)
export const CAMPAIGN_REDEMPTION_STATUSES = [
  "RESERVED",
  "APPLIED",
  "RELEASED",
] as const;
export type CampaignRedemptionStatus = (typeof CAMPAIGN_REDEMPTION_STATUSES)[number];

// Allowed Campaign Redemption Context Types
export const CAMPAIGN_REDEMPTION_CONTEXT_TYPES = ["BOOKING"] as const;
export type CampaignRedemptionContextType = (typeof CAMPAIGN_REDEMPTION_CONTEXT_TYPES)[number];

// Allowed Campaign Redemption Line Types
export const CAMPAIGN_REDEMPTION_LINE_TYPES = [
  "PRIMARY",
  "BOOKING_SERVICE",
] as const;
export type CampaignRedemptionLineType = (typeof CAMPAIGN_REDEMPTION_LINE_TYPES)[number];

/**
 * 1. Creche Promotional Campaigns (Creche -> Tutor)
 * R37.C1 authoritative promotional campaigns domain table.
 * Idempotency is exclusively managed via creche_promotional_campaign_operations.
 */
export const crechePromotionalCampaignsTable = pgTable(
  "creche_promotional_campaigns",
  {
    id: serial("id").primaryKey(),
    crecheId: integer("creche_id").notNull().references(() => crechesTable.id, { onDelete: "restrict" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),

    benefitType: varchar("benefit_type", { length: 32 }).notNull(),
    percentageBps: integer("percentage_bps"),
    fixedDiscountCents: integer("fixed_discount_cents"),
    fixedPromotionalPriceCents: integer("fixed_promotional_price_cents"),

    audienceType: varchar("audience_type", { length: 32 }).default("ALL_ACTIVE_TUTORS").notNull(),
    conditionInteractionPolicy: varchar("condition_interaction_policy", { length: 32 })
      .default("EXCLUDE_IF_TUTOR_CONDITION")
      .notNull(),

    usageLimitType: varchar("usage_limit_type", { length: 32 }).default("UNLIMITED").notNull(),
    usageLimitPerTutor: integer("usage_limit_per_tutor"),

    priority: integer("priority").default(100).notNull(),

    validFrom: timestamp("valid_from").notNull(),
    validUntil: timestamp("valid_until").notNull(),
    status: varchar("status", { length: 32 }).default("DRAFT").notNull(),

    reason: text("reason"),
    createdByUserId: integer("created_by_user_id").notNull().references(() => usersTable.id, { onDelete: "restrict" }),
    supersedesCampaignId: integer("supersedes_campaign_id"),
    revokedByUserId: integer("revoked_by_user_id").references(() => usersTable.id, { onDelete: "restrict" }),
    revokedAt: timestamp("revoked_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    checkBenefitType: check(
      "creche_promotional_benefit_type_check",
      sql`${table.benefitType} IN ('PERCENTAGE_DISCOUNT', 'FIXED_DISCOUNT', 'FIXED_PROMOTIONAL_PRICE')`
    ),
    checkStatus: check(
      "creche_promotional_status_check",
      sql`${table.status} IN ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED', 'REVOKED')`
    ),
    checkAudienceType: check(
      "creche_promotional_audience_type_check",
      sql`${table.audienceType} IN ('ALL_ACTIVE_TUTORS', 'SELECTED_TUTORS')`
    ),
    checkInteractionPolicy: check(
      "creche_promotional_interaction_policy_check",
      sql`${table.conditionInteractionPolicy} IN ('EXCLUDE_IF_TUTOR_CONDITION', 'ALLOW_IF_BETTER')`
    ),
    checkUsageLimitType: check(
      "creche_promotional_usage_limit_type_check",
      sql`${table.usageLimitType} IN ('UNLIMITED', 'ONCE_PER_TUTOR', 'N_PER_TUTOR')`
    ),
    checkValidityWindow: check(
      "creche_promotional_validity_window_check",
      sql`${table.validUntil} > ${table.validFrom}`
    ),
    checkPercentageDiscount: check(
      "creche_promotional_percentage_check",
      sql`${table.benefitType} != 'PERCENTAGE_DISCOUNT' OR (${table.percentageBps} IS NOT NULL AND ${table.percentageBps} >= 1 AND ${table.percentageBps} <= 10000 AND ${table.fixedDiscountCents} IS NULL AND ${table.fixedPromotionalPriceCents} IS NULL)`
    ),
    checkFixedDiscount: check(
      "creche_promotional_fixed_discount_check",
      sql`${table.benefitType} != 'FIXED_DISCOUNT' OR (${table.fixedDiscountCents} IS NOT NULL AND ${table.fixedDiscountCents} > 0 AND ${table.percentageBps} IS NULL AND ${table.fixedPromotionalPriceCents} IS NULL)`
    ),
    checkFixedPrice: check(
      "creche_promotional_fixed_price_check",
      sql`${table.benefitType} != 'FIXED_PROMOTIONAL_PRICE' OR (${table.fixedPromotionalPriceCents} IS NOT NULL AND ${table.fixedPromotionalPriceCents} >= 0 AND ${table.percentageBps} IS NULL AND ${table.fixedDiscountCents} IS NULL)`
    ),
    checkUsageLimit: check(
      "creche_promotional_usage_limit_check",
      sql`${table.usageLimitType} != 'N_PER_TUTOR' OR (${table.usageLimitPerTutor} IS NOT NULL AND ${table.usageLimitPerTutor} > 0)`
    ),
    checkPriority: check(
      "creche_promotional_priority_check",
      sql`${table.priority} >= 0`
    ),
    lookupIdx: index("creche_promotional_campaigns_lookup_idx").on(
      table.crecheId,
      table.status
    ),
    temporalIdx: index("creche_promotional_campaigns_temporal_idx").on(
      table.crecheId,
      table.status,
      table.validFrom,
      table.validUntil
    ),
  })
);

export const crechePromotionalCampaignsRelations = relations(crechePromotionalCampaignsTable, ({ one, many }) => ({
  creche: one(crechesTable, {
    fields: [crechePromotionalCampaignsTable.crecheId],
    references: [crechesTable.id],
  }),
  createdByUser: one(usersTable, {
    fields: [crechePromotionalCampaignsTable.createdByUserId],
    references: [usersTable.id],
  }),
  revokedByUser: one(usersTable, {
    fields: [crechePromotionalCampaignsTable.revokedByUserId],
    references: [usersTable.id],
  }),
  supersedesCampaign: one(crechePromotionalCampaignsTable, {
    fields: [crechePromotionalCampaignsTable.supersedesCampaignId],
    references: [crechePromotionalCampaignsTable.id],
  }),
  items: many(crechePromotionalCampaignItemsTable),
  tutors: many(crechePromotionalCampaignTutorsTable),
  audits: many(crechePromotionalCampaignAuditsTable),
}));

/**
 * 2. Campaign Items (1:N explicit association)
 */
export const crechePromotionalCampaignItemsTable = pgTable(
  "creche_promotional_campaign_items",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => crechePromotionalCampaignsTable.id, { onDelete: "cascade" }),
    crecheId: integer("creche_id")
      .notNull()
      .references(() => crechesTable.id, { onDelete: "restrict" }),
    catalogueItemId: integer("catalogue_item_id")
      .notNull()
      .references(() => catalogueItemsTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqueCampaignItemIdx: uniqueIndex("creche_promotional_items_unique_idx").on(
      table.campaignId,
      table.catalogueItemId
    ),
    crecheItemIdx: index("creche_promotional_items_creche_item_idx").on(
      table.crecheId,
      table.catalogueItemId
    ),
  })
);

export const crechePromotionalCampaignItemsRelations = relations(crechePromotionalCampaignItemsTable, ({ one }) => ({
  campaign: one(crechePromotionalCampaignsTable, {
    fields: [crechePromotionalCampaignItemsTable.campaignId],
    references: [crechePromotionalCampaignsTable.id],
  }),
  catalogueItem: one(catalogueItemsTable, {
    fields: [crechePromotionalCampaignItemsTable.catalogueItemId],
    references: [catalogueItemsTable.id],
  }),
}));

/**
 * 3. Campaign Selected Tutors (when audienceType = 'SELECTED_TUTORS')
 */
export const crechePromotionalCampaignTutorsTable = pgTable(
  "creche_promotional_campaign_tutors",
  {
    id: serial("id").primaryKey(),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => crechePromotionalCampaignsTable.id, { onDelete: "cascade" }),
    crecheId: integer("creche_id")
      .notNull()
      .references(() => crechesTable.id, { onDelete: "restrict" }),
    tutorId: integer("tutor_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqueCampaignTutorIdx: uniqueIndex("creche_promotional_tutors_unique_idx").on(
      table.campaignId,
      table.tutorId
    ),
    crecheTutorIdx: index("creche_promotional_tutors_creche_tutor_idx").on(
      table.crecheId,
      table.tutorId
    ),
  })
);

export const crechePromotionalCampaignTutorsRelations = relations(crechePromotionalCampaignTutorsTable, ({ one }) => ({
  campaign: one(crechePromotionalCampaignsTable, {
    fields: [crechePromotionalCampaignTutorsTable.campaignId],
    references: [crechePromotionalCampaignsTable.id],
  }),
  tutor: one(usersTable, {
    fields: [crechePromotionalCampaignTutorsTable.tutorId],
    references: [usersTable.id],
  }),
}));

/**
 * 4. Campaign Audits (Append-only Audit Log)
 */
export const crechePromotionalCampaignAuditsTable = pgTable(
  "creche_promotional_campaign_audits",
  {
    id: serial("id").primaryKey(),
    crecheId: integer("creche_id")
      .notNull()
      .references(() => crechesTable.id, { onDelete: "restrict" }),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => crechePromotionalCampaignsTable.id, { onDelete: "restrict" }),
    action: varchar("action", { length: 64 }).notNull(),
    actorUserId: integer("actor_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    actorRole: varchar("actor_role", { length: 32 }).notNull(),
    reason: text("reason").notNull(),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    requestId: varchar("request_id", { length: 64 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    crecheCampaignAuditsIdx: index("creche_promotional_audits_campaign_idx").on(
      table.crecheId,
      table.campaignId,
      table.createdAt
    ),
  })
);

export const crechePromotionalCampaignAuditsRelations = relations(crechePromotionalCampaignAuditsTable, ({ one }) => ({
  campaign: one(crechePromotionalCampaignsTable, {
    fields: [crechePromotionalCampaignAuditsTable.campaignId],
    references: [crechePromotionalCampaignsTable.id],
  }),
  actorUser: one(usersTable, {
    fields: [crechePromotionalCampaignAuditsTable.actorUserId],
    references: [usersTable.id],
  }),
}));

/**
 * 5. Campaign Operations Ledger (Sole Authority for Request Idempotency)
 */
export const crechePromotionalCampaignOperationsTable = pgTable(
  "creche_promotional_campaign_operations",
  {
    id: serial("id").primaryKey(),
    crecheId: integer("creche_id")
      .notNull()
      .references(() => crechesTable.id, { onDelete: "restrict" }),
    campaignId: integer("campaign_id"), // Nullable during initial CREATE reservation
    idempotencyKey: varchar("idempotency_key", { length: 64 }).notNull(),
    operationType: varchar("operation_type", { length: 64 }).notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(), // 'IN_PROGRESS', 'SUCCEEDED', 'FAILED'
    responseJson: jsonb("response_json"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqueCrecheKeyIdx: uniqueIndex("creche_promotional_ops_creche_key_idx").on(
      table.crecheId,
      table.idempotencyKey
    ),
  })
);

export type CrechePromotionalCampaign = typeof crechePromotionalCampaignsTable.$inferSelect;
export type InsertCrechePromotionalCampaign = typeof crechePromotionalCampaignsTable.$inferInsert;

export type CrechePromotionalCampaignItem = typeof crechePromotionalCampaignItemsTable.$inferSelect;
export type InsertCrechePromotionalCampaignItem = typeof crechePromotionalCampaignItemsTable.$inferInsert;

export type CrechePromotionalCampaignTutor = typeof crechePromotionalCampaignTutorsTable.$inferSelect;
export type InsertCrechePromotionalCampaignTutor = typeof crechePromotionalCampaignTutorsTable.$inferInsert;

export type CrechePromotionalCampaignAudit = typeof crechePromotionalCampaignAuditsTable.$inferSelect;
export type InsertCrechePromotionalCampaignAudit = typeof crechePromotionalCampaignAuditsTable.$inferInsert;

export type CrechePromotionalCampaignOperation = typeof crechePromotionalCampaignOperationsTable.$inferSelect;
export type InsertCrechePromotionalCampaignOperation = typeof crechePromotionalCampaignOperationsTable.$inferInsert;

/**
 * 6. Campaign Redemptions (1 Redemption per Commercial Context/Booking)
 * R37.C2A operational redemption & reservation entity.
 * Statuses in C2A are strictly 'RESERVED' and 'RELEASED' ('APPLIED' is reserved for R37.C2B).
 */
export const crechePromotionalCampaignRedemptionsTable = pgTable(
  "creche_promotional_campaign_redemptions",
  {
    id: serial("id").primaryKey(),
    crecheId: integer("creche_id")
      .notNull()
      .references(() => crechesTable.id, { onDelete: "restrict" }),
    campaignId: integer("campaign_id")
      .notNull()
      .references(() => crechePromotionalCampaignsTable.id, { onDelete: "restrict" }),
    tutorId: integer("tutor_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "restrict" }),
    bookingId: integer("booking_id")
      .notNull()
      .references(() => bookingsTable.id, { onDelete: "restrict" }),
    contextType: varchar("context_type", { length: 32 }).default("BOOKING").notNull(),
    status: varchar("status", { length: 32 }).default("RESERVED").notNull(),
    reservedAt: timestamp("reserved_at").defaultNow().notNull(),
    appliedAt: timestamp("applied_at"),
    releasedAt: timestamp("released_at"),
    releaseReason: text("release_reason"),
    campaignSnapshot: jsonb("campaign_snapshot").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    checkStatus: check(
      "creche_promotional_redemption_status_check",
      sql`${table.status} IN ('RESERVED', 'PARTIALLY_APPLIED', 'APPLIED', 'RELEASED')`
    ),
    checkContextType: check(
      "creche_promotional_redemption_context_type_check",
      sql`${table.contextType} IN ('BOOKING')`
    ),
    uniqueContextIdx: uniqueIndex("creche_promotional_redemptions_unique_context_idx").on(
      table.crecheId,
      table.campaignId,
      table.tutorId,
      table.bookingId
    ),
    usageIdx: index("creche_promotional_redemptions_usage_idx").on(
      table.crecheId,
      table.tutorId,
      table.campaignId,
      table.status
    ),
    bookingIdx: index("creche_promotional_redemptions_booking_idx").on(
      table.crecheId,
      table.bookingId
    ),
  })
);

export const crechePromotionalCampaignRedemptionsRelations = relations(
  crechePromotionalCampaignRedemptionsTable,
  ({ one, many }) => ({
    creche: one(crechesTable, {
      fields: [crechePromotionalCampaignRedemptionsTable.crecheId],
      references: [crechesTable.id],
    }),
    campaign: one(crechePromotionalCampaignsTable, {
      fields: [crechePromotionalCampaignRedemptionsTable.campaignId],
      references: [crechePromotionalCampaignsTable.id],
    }),
    tutor: one(usersTable, {
      fields: [crechePromotionalCampaignRedemptionsTable.tutorId],
      references: [usersTable.id],
    }),
    booking: one(bookingsTable, {
      fields: [crechePromotionalCampaignRedemptionsTable.bookingId],
      references: [bookingsTable.id],
    }),
    items: many(crechePromotionalCampaignRedemptionItemsTable),
  })
);

/**
 * 7. Campaign Redemption Items (1..N Items per Redemption)
 * Distinguishes PRIMARY booking item from BOOKING_SERVICE add-on items.
 */
export const crechePromotionalCampaignRedemptionItemsTable = pgTable(
  "creche_promotional_campaign_redemption_items",
  {
    id: serial("id").primaryKey(),
    redemptionId: integer("redemption_id")
      .notNull()
      .references(() => crechePromotionalCampaignRedemptionsTable.id, { onDelete: "restrict" }),
    catalogueItemId: integer("catalogue_item_id")
      .notNull()
      .references(() => catalogueItemsTable.id, { onDelete: "restrict" }),
    lineType: varchar("line_type", { length: 32 }).notNull(),
    bookingServiceId: integer("booking_service_id")
      .references(() => bookingServicesTable.id, { onDelete: "restrict" }),
    baseUnitPriceCents: integer("base_unit_price_cents").notNull(),
    effectiveUnitPriceCents: integer("effective_unit_price_cents").notNull(),
    unitDiscountCents: integer("unit_discount_cents").notNull(),
    quantity: integer("quantity").default(1).notNull(),
    baseLineTotalCents: integer("base_line_total_cents").notNull(),
    discountLineTotalCents: integer("discount_line_total_cents").notNull(),
    finalLineTotalCents: integer("final_line_total_cents").notNull(),
    campaignSnapshot: jsonb("campaign_snapshot").notNull(),
    status: varchar("status", { length: 32 }).default("RESERVED").notNull(),
    applicationMode: varchar("application_mode", { length: 32 }),
    appliedInvoiceId: integer("applied_invoice_id")
      .references(() => invoicesTable.id, { onDelete: "restrict" }),
    appliedInvoiceItemId: integer("applied_invoice_item_id")
      .references(() => invoiceItemsTable.id, { onDelete: "restrict" }),
    appliedAt: timestamp("applied_at"),
    releasedAt: timestamp("released_at"),
    releaseReason: text("release_reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    checkLineType: check(
      "creche_promotional_redemption_item_line_type_check",
      sql`${table.lineType} IN ('PRIMARY', 'BOOKING_SERVICE')`
    ),
    checkBookingServiceId: check(
      "creche_promotional_redemption_item_service_fk_check",
      sql`(${table.lineType} = 'PRIMARY' AND ${table.bookingServiceId} IS NULL) OR (${table.lineType} = 'BOOKING_SERVICE' AND ${table.bookingServiceId} IS NOT NULL)`
    ),
    checkBasePrice: check(
      "creche_promotional_redemption_item_base_price_check",
      sql`${table.baseUnitPriceCents} >= 0`
    ),
    checkEffectivePrice: check(
      "creche_promotional_redemption_item_effective_price_check",
      sql`${table.effectiveUnitPriceCents} >= 0 AND ${table.effectiveUnitPriceCents} <= ${table.baseUnitPriceCents}`
    ),
    checkUnitDiscount: check(
      "creche_promotional_redemption_item_unit_discount_check",
      sql`${table.unitDiscountCents} = ${table.baseUnitPriceCents} - ${table.effectiveUnitPriceCents}`
    ),
    checkQuantity: check(
      "creche_promotional_redemption_item_quantity_check",
      sql`${table.quantity} > 0`
    ),
    checkBaseLineTotal: check(
      "creche_promotional_redemption_item_base_line_total_check",
      sql`${table.baseLineTotalCents} = ${table.baseUnitPriceCents} * ${table.quantity}`
    ),
    checkFinalLineTotal: check(
      "creche_promotional_redemption_item_final_line_total_check",
      sql`${table.finalLineTotalCents} = ${table.effectiveUnitPriceCents} * ${table.quantity}`
    ),
    checkDiscountLineTotal: check(
      "creche_promotional_redemption_item_discount_line_total_check",
      sql`${table.discountLineTotalCents} = ${table.baseLineTotalCents} - ${table.finalLineTotalCents}`
    ),
    checkItemStatus: check(
      "creche_promotional_redemption_item_status_check",
      sql`${table.status} IN ('RESERVED', 'APPLIED', 'RELEASED')`
    ),
    checkApplicationMode: check(
      "creche_promotional_redemption_item_app_mode_check",
      sql`${table.applicationMode} IS NULL OR ${table.applicationMode} IN ('INVOICE_ITEM', 'COMPLIMENTARY_ZERO_VALUE')`
    ),
    checkApplicationConsistency: check(
      "creche_promotional_redemption_item_app_consistency_check",
      sql`(${table.status} = 'RESERVED' AND ${table.applicationMode} IS NULL AND ${table.appliedInvoiceId} IS NULL AND ${table.appliedInvoiceItemId} IS NULL AND ${table.appliedAt} IS NULL) OR (${table.status} = 'RELEASED' AND ${table.applicationMode} IS NULL AND ${table.appliedInvoiceId} IS NULL AND ${table.appliedInvoiceItemId} IS NULL) OR (${table.status} = 'APPLIED' AND ${table.applicationMode} IS NOT NULL AND ((${table.applicationMode} = 'INVOICE_ITEM' AND ${table.appliedInvoiceId} IS NOT NULL AND ${table.appliedInvoiceItemId} IS NOT NULL AND ${table.appliedAt} IS NOT NULL) OR (${table.status} = 'APPLIED' AND ${table.applicationMode} = 'COMPLIMENTARY_ZERO_VALUE' AND ${table.appliedInvoiceId} IS NULL AND ${table.appliedInvoiceItemId} IS NULL AND ${table.appliedAt} IS NOT NULL)))`
    ),
    primaryItemUniqueIdx: uniqueIndex("creche_promotional_items_primary_unique_idx")
      .on(table.redemptionId)
      .where(sql`${table.lineType} = 'PRIMARY'`),
    serviceItemUniqueIdx: uniqueIndex("creche_promotional_items_service_unique_idx")
      .on(table.redemptionId, table.bookingServiceId)
      .where(sql`${table.lineType} = 'BOOKING_SERVICE'`),
    redemptionIdx: index("creche_promotional_redemption_items_redemption_idx").on(
      table.redemptionId
    ),
    catalogueIdx: index("creche_promotional_redemption_items_catalogue_idx").on(
      table.catalogueItemId
    ),
  })
);

export const crechePromotionalCampaignRedemptionItemsRelations = relations(
  crechePromotionalCampaignRedemptionItemsTable,
  ({ one }) => ({
    redemption: one(crechePromotionalCampaignRedemptionsTable, {
      fields: [crechePromotionalCampaignRedemptionItemsTable.redemptionId],
      references: [crechePromotionalCampaignRedemptionsTable.id],
    }),
    catalogueItem: one(catalogueItemsTable, {
      fields: [crechePromotionalCampaignRedemptionItemsTable.catalogueItemId],
      references: [catalogueItemsTable.id],
    }),
    bookingService: one(bookingServicesTable, {
      fields: [crechePromotionalCampaignRedemptionItemsTable.bookingServiceId],
      references: [bookingServicesTable.id],
    }),
    appliedInvoice: one(invoicesTable, {
      fields: [crechePromotionalCampaignRedemptionItemsTable.appliedInvoiceId],
      references: [invoicesTable.id],
    }),
    appliedInvoiceItem: one(invoiceItemsTable, {
      fields: [crechePromotionalCampaignRedemptionItemsTable.appliedInvoiceItemId],
      references: [invoiceItemsTable.id],
    }),
  })
);

export type CrechePromotionalCampaignRedemption =
  typeof crechePromotionalCampaignRedemptionsTable.$inferSelect;
export type InsertCrechePromotionalCampaignRedemption =
  typeof crechePromotionalCampaignRedemptionsTable.$inferInsert;

export type CrechePromotionalCampaignRedemptionItem =
  typeof crechePromotionalCampaignRedemptionItemsTable.$inferSelect;
export type InsertCrechePromotionalCampaignRedemptionItem =
  typeof crechePromotionalCampaignRedemptionItemsTable.$inferInsert;
