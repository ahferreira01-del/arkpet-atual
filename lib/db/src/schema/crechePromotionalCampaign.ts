import { pgTable, serial, integer, varchar, timestamp, text, check, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { crechesTable } from "./creches";
import { usersTable } from "./users";
import { catalogueItemsTable } from "./financial";

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
] as const;
export type CampaignAuditAction = (typeof CAMPAIGN_AUDIT_ACTIONS)[number];

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
