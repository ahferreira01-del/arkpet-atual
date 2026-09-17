import { db } from "@workspace/db";
import {
  crechePromotionalCampaignsTable,
  crechePromotionalCampaignTutorsTable,
  crechePromotionalCampaignRedemptionsTable,
  crechePromotionalCampaignRedemptionItemsTable,
  crechePromotionalCampaignAuditsTable,
  tutorCommercialConditionsTable,
  invoicesTable,
  invoiceItemsTable,
  type CampaignStatus,
  type CampaignBenefitType,
} from "@workspace/db/schema";
import { eq, and, sql, inArray, gte, lt, desc, isNull } from "drizzle-orm";
import {
  getBusinessDate,
  getPreviousCalendarDay,
  getBusinessDayStartInstant,
} from "../lib/date.js";
import {
  CrecheCampaignForbiddenError,
  CrecheCampaignNotFoundError,
} from "./crecheCampaignPricing.js";

// ─── Types & Interfaces ───────────────────────────────────────────────────────

export interface MetricsActorContext {
  userId: number;
  role: string;
  crecheId?: number | null;
  source?: "http" | "internal";
}

export interface MetricsDateFilter {
  period?: "7d" | "30d" | "90d" | "all" | "custom";
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
}

export interface ResolvedTimeWindow {
  period: string;
  startInstant: Date | null;
  endInstant: Date | null;
  startDateStr: string | null;
  endDateStr: string | null;
}

export interface InvoiceStatusBucket {
  lineCount: number;
  finalChargedAmountCents: number;
  discountGrantedCents: number;
}

export interface InvoiceStatusBreakdown {
  pending: InvoiceStatusBucket;
  awaitingConfirmation: InvoiceStatusBucket;
  overdue: InvoiceStatusBucket;
  paid: InvoiceStatusBucket;
  voided: InvoiceStatusBucket;
  refunded: InvoiceStatusBucket;
}

export interface CampaignFinancialMetrics {
  grossAppliedBaseAmountCents: number;
  grossAppliedDiscountCents: number;
  grossAppliedFinalAmountCents: number;
  nonVoidedNonRefundedFinalAmountCents: number;
  monetaryApplicationsCount: number;
  complimentaryApplicationsCount: number;
  complimentaryBaseValueCents: number;
  complimentaryDiscountGrantedCents: number;
  invoiceStatusBreakdown: InvoiceStatusBreakdown;
}

export interface CampaignOverviewMetricsResult {
  crecheId: number;
  timeWindow: ResolvedTimeWindow;
  campaignsByStatus: {
    total: number;
    draft: number;
    scheduled: number;
    active: number;
    paused: number;
    ended: number;
    revoked: number;
  };
  redemptionCohort: {
    totalReservedInPeriod: number;
    currentlyReserved: number;
    currentlyPartiallyApplied: number;
    currentlyApplied: number;
    currentlyReleased: number;
    uniqueTutorsInCohort: number;
  };
  applicationsInPeriod: {
    redemptionsFirstAppliedCount: number;
    uniqueTutorsAppliedCount: number;
  };
  hasFinancialAccess: boolean;
  financial: CampaignFinancialMetrics | null;
}

export interface CampaignDetailMetricsResult {
  crecheId: number;
  campaignId: number;
  campaignName: string;
  status: CampaignStatus;
  benefitType: CampaignBenefitType;
  audienceType: string;
  audienceAvailability: "EXACT_MATERIALIZED" | "UNAVAILABLE_HISTORICAL";
  currentSelectedAudienceSize: number | null;
  crmAudienceAtCreation: number | null;
  utilizationRatePercentage: number | null;
  redemptionSummary: {
    totalRedemptions: number;
    reservedCount: number;
    partiallyAppliedCount: number;
    appliedCount: number;
    releasedCount: number;
    uniqueTutorsCount: number;
    uniqueTutorsAppliedCount: number;
  };
  hasFinancialAccess: boolean;
  financial: CampaignFinancialMetrics | null;
}

export interface ConditionTypeBreakdownItem {
  conditionType: "CUSTOM_PRICE" | "PERCENTAGE_DISCOUNT" | "FIXED_DISCOUNT";
  conditionsConfigured: number;
  appliedLinesCount: number;
  discountGrantedCents: number;
  finalChargedAmountCents: number;
}

export interface TutorConditionMetricsResult {
  crecheId: number;
  timeWindow: ResolvedTimeWindow;
  conditionsCount: {
    total: number;
    scheduledCount: number;
    activeCount: number; // Effective active count (temporally active)
    persistedActiveCount: number; // Persisted status='ACTIVE' count
    effectiveActiveCount: number; // Temporally effective active count (status='ACTIVE' & validUntil > businessNow)
    revokedCount: number;
    expiredByTimeCount: number; // Derived reporting state: validUntil <= businessNow and not revoked/cancelled
  };
  uniqueTutorsWithActiveCondition: number;
  hasFinancialAccess: boolean;
  financial: {
    appliedLinesCount: number;
    baseAmountCents: number;
    discountGrantedCents: number;
    finalChargedAmountCents: number;
    typeBreakdown: ConditionTypeBreakdownItem[];
  } | null;
}

export interface CrmOriginCampaignItem {
  campaignId: number;
  campaignName: string;
  status: CampaignStatus;
  opportunityType: "INACTIVE_TUTORS" | "NEW_TUTORS" | "NEVER_USED_SERVICE" | "UNKNOWN";
  sourceAuthority: "STRUCTURED_AFTER_STATE" | "LEGACY_REASON_FALLBACK";
  createdAt: string;
  currentSelectedAudienceSize: number;
  crmAudienceAtCreation: number | null;
  totalRedemptions: number;
  uniqueTutorsApplied: number;
  hasFinancialAccess: boolean;
  finalChargedAmountCents: number | null;
  discountGrantedCents: number | null;
}

export interface CrmOriginMetricsResult {
  crecheId: number;
  totalCampaignsCreatedFromOpportunity: number;
  byOpportunityType: {
    inactiveTutorsCount: number;
    newTutorsCount: number;
    neverUsedServiceCount: number;
  };
  campaigns: CrmOriginCampaignItem[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseCents(val: any): number {
  if (val == null) return 0;
  const num = typeof val === "string" ? parseFloat(val) : Number(val);
  return isNaN(num) ? 0 : Math.round(num * 100);
}

function emptyInvoiceStatusBreakdown(): InvoiceStatusBreakdown {
  return {
    pending: { lineCount: 0, finalChargedAmountCents: 0, discountGrantedCents: 0 },
    awaitingConfirmation: { lineCount: 0, finalChargedAmountCents: 0, discountGrantedCents: 0 },
    overdue: { lineCount: 0, finalChargedAmountCents: 0, discountGrantedCents: 0 },
    paid: { lineCount: 0, finalChargedAmountCents: 0, discountGrantedCents: 0 },
    voided: { lineCount: 0, finalChargedAmountCents: 0, discountGrantedCents: 0 },
    refunded: { lineCount: 0, finalChargedAmountCents: 0, discountGrantedCents: 0 },
  };
}

export function resolveTimeWindow(filter: MetricsDateFilter = {}): ResolvedTimeWindow {
  const businessToday = getBusinessDate("America/Sao_Paulo");
  const period = filter.period || "30d";

  if (period === "all") {
    return {
      period: "all",
      startInstant: null,
      endInstant: null,
      startDateStr: null,
      endDateStr: null,
    };
  }

  if (period === "custom" && filter.startDate && filter.endDate) {
    const startInstant = getBusinessDayStartInstant(filter.startDate, "America/Sao_Paulo");
    // End date is endExclusive -> start of the day after filter.endDate
    const nextDayStr = getPreviousCalendarDay(filter.endDate, -1);
    const endInstant = getBusinessDayStartInstant(nextDayStr, "America/Sao_Paulo");
    return {
      period: "custom",
      startInstant,
      endInstant,
      startDateStr: filter.startDate,
      endDateStr: filter.endDate,
    };
  }

  let days = 30;
  if (period === "7d") days = 7;
  if (period === "90d") days = 90;

  const startDateStr = getPreviousCalendarDay(businessToday, days);
  const startInstant = getBusinessDayStartInstant(startDateStr, "America/Sao_Paulo");
  // Today's day end: start of tomorrow
  const tomorrowStr = getPreviousCalendarDay(businessToday, -1);
  const endInstant = getBusinessDayStartInstant(tomorrowStr, "America/Sao_Paulo");

  return {
    period,
    startInstant,
    endInstant,
    startDateStr,
    endDateStr: businessToday,
  };
}

// ─── Service Implementation ───────────────────────────────────────────────────

export class CrecheCommercialMetricsService {
  /**
   * Enforces tenant boundary and role permissions.
   * Only creche_admin and staff are permitted.
   * Tutor and master_admin without active support context are rejected with 403.
   */
  static assertAuthorized(crecheId: number, actor: MetricsActorContext): { hasFinancialAccess: boolean } {
    if (!actor || !actor.role) {
      throw new CrecheCampaignForbiddenError("Não autenticado.");
    }

    if (actor.role === "tutor") {
      throw new CrecheCampaignForbiddenError("Tutores não têm acesso a relatórios gerenciais ou métricas da creche.");
    }

    if (actor.role === "master_admin") {
      throw new CrecheCampaignForbiddenError("Master Admin não possui permissão para acesso direto a métricas de creche sem sessão de suporte ativa.");
    }

    if (actor.role !== "creche_admin" && actor.role !== "staff") {
      throw new CrecheCampaignForbiddenError("Acesso negado: perfil não autorizado para visualização de métricas.");
    }

    if (actor.crecheId != null && actor.crecheId !== crecheId) {
      throw new CrecheCampaignForbiddenError("Acesso negado: violação multi-tenant.");
    }

    return {
      hasFinancialAccess: actor.role === "creche_admin",
    };
  }

  /**
   * 1. Overview Metrics across all campaigns in the creche.
   */
  static async getCampaignOverviewMetrics(
    crecheId: number,
    filter: MetricsDateFilter,
    actor: MetricsActorContext
  ): Promise<CampaignOverviewMetricsResult> {
    const { hasFinancialAccess } = this.assertAuthorized(crecheId, actor);
    const window = resolveTimeWindow(filter);

    // 1. Campaign counts by current canonical status
    const campaignStatusRows = await db
      .select({
        status: crechePromotionalCampaignsTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(crechePromotionalCampaignsTable)
      .where(eq(crechePromotionalCampaignsTable.crecheId, crecheId))
      .groupBy(crechePromotionalCampaignsTable.status);

    const statusCounts: Record<string, number> = {};
    let totalCampaigns = 0;
    for (const r of campaignStatusRows) {
      statusCounts[r.status] = r.count;
      totalCampaigns += r.count;
    }

    // 2. Redemption Cohort: redemptions reserved in period
    const redemptionCohortConds = [
      eq(crechePromotionalCampaignRedemptionsTable.crecheId, crecheId),
    ];
    if (window.startInstant) {
      redemptionCohortConds.push(gte(crechePromotionalCampaignRedemptionsTable.reservedAt, window.startInstant));
    }
    if (window.endInstant) {
      redemptionCohortConds.push(lt(crechePromotionalCampaignRedemptionsTable.reservedAt, window.endInstant));
    }

    const cohortRows = await db
      .select({
        status: crechePromotionalCampaignRedemptionsTable.status,
        count: sql<number>`count(*)::int`,
        uniqueTutors: sql<number>`count(distinct ${crechePromotionalCampaignRedemptionsTable.tutorId})::int`,
      })
      .from(crechePromotionalCampaignRedemptionsTable)
      .where(and(...redemptionCohortConds))
      .groupBy(crechePromotionalCampaignRedemptionsTable.status);

    let totalReservedInCohort = 0;
    const cohortStatusMap: Record<string, number> = {};
    for (const r of cohortRows) {
      cohortStatusMap[r.status] = r.count;
      totalReservedInCohort += r.count;
    }

    // Distinct tutors in the cohort
    const [cohortUniqueTutorsRow] = await db
      .select({
        count: sql<number>`count(distinct ${crechePromotionalCampaignRedemptionsTable.tutorId})::int`,
      })
      .from(crechePromotionalCampaignRedemptionsTable)
      .where(and(...redemptionCohortConds));

    // 3. Applications in Period (based on redemption.appliedAt)
    const appConds = [
      eq(crechePromotionalCampaignRedemptionsTable.crecheId, crecheId),
      inArray(crechePromotionalCampaignRedemptionsTable.status, ["PARTIALLY_APPLIED", "APPLIED"]),
    ];
    if (window.startInstant) {
      appConds.push(gte(crechePromotionalCampaignRedemptionsTable.appliedAt, window.startInstant));
    }
    if (window.endInstant) {
      appConds.push(lt(crechePromotionalCampaignRedemptionsTable.appliedAt, window.endInstant));
    }

    const [appRow] = await db
      .select({
        count: sql<number>`count(*)::int`,
        uniqueTutors: sql<number>`count(distinct ${crechePromotionalCampaignRedemptionsTable.tutorId})::int`,
      })
      .from(crechePromotionalCampaignRedemptionsTable)
      .where(and(...appConds));

    // 4. Financial Metrics (Exclusive to creche_admin)
    let financialMetrics: CampaignFinancialMetrics | null = null;

    if (hasFinancialAccess) {
      financialMetrics = await this.calculateCampaignFinancialMetrics(crecheId, null, window);
    }

    return {
      crecheId,
      timeWindow: window,
      campaignsByStatus: {
        total: totalCampaigns,
        draft: statusCounts["DRAFT"] || 0,
        scheduled: statusCounts["SCHEDULED"] || 0,
        active: statusCounts["ACTIVE"] || 0,
        paused: statusCounts["PAUSED"] || 0,
        ended: statusCounts["ENDED"] || 0,
        revoked: statusCounts["REVOKED"] || 0,
      },
      redemptionCohort: {
        totalReservedInPeriod: totalReservedInCohort,
        currentlyReserved: cohortStatusMap["RESERVED"] || 0,
        currentlyPartiallyApplied: cohortStatusMap["PARTIALLY_APPLIED"] || 0,
        currentlyApplied: cohortStatusMap["APPLIED"] || 0,
        currentlyReleased: cohortStatusMap["RELEASED"] || 0,
        uniqueTutorsInCohort: cohortUniqueTutorsRow?.count || 0,
      },
      applicationsInPeriod: {
        redemptionsFirstAppliedCount: appRow?.count || 0,
        uniqueTutorsAppliedCount: appRow?.uniqueTutors || 0,
      },
      hasFinancialAccess,
      financial: financialMetrics,
    };
  }

  /**
   * 2. Campaign Detail Metrics for a specific campaign.
   */
  static async getCampaignDetailMetrics(
    crecheId: number,
    campaignId: number,
    actor: MetricsActorContext
  ): Promise<CampaignDetailMetricsResult> {
    const { hasFinancialAccess } = this.assertAuthorized(crecheId, actor);

    const [campaign] = await db
      .select()
      .from(crechePromotionalCampaignsTable)
      .where(
        and(
          eq(crechePromotionalCampaignsTable.id, campaignId),
          eq(crechePromotionalCampaignsTable.crecheId, crecheId)
        )
      )
      .limit(1);

    if (!campaign) {
      throw new CrecheCampaignNotFoundError(`Campanha #${campaignId} não encontrada nesta creche.`);
    }

    // 1. Audience determination (Exact for SELECTED_TUTORS; null for ALL_ACTIVE_TUTORS)
    let currentSelectedAudienceSize: number | null = null;
    let audienceAvailability: "EXACT_MATERIALIZED" | "UNAVAILABLE_HISTORICAL" = "UNAVAILABLE_HISTORICAL";

    if (campaign.audienceType === "SELECTED_TUTORS") {
      const [tutorsCountRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(crechePromotionalCampaignTutorsTable)
        .where(
          and(
            eq(crechePromotionalCampaignTutorsTable.campaignId, campaignId),
            eq(crechePromotionalCampaignTutorsTable.crecheId, crecheId)
          )
        );
      currentSelectedAudienceSize = tutorsCountRow?.count || 0;
      audienceAvailability = "EXACT_MATERIALIZED";
    }

    // Check if created from CRM opportunity to read crmAudienceAtCreation
    let crmAudienceAtCreation: number | null = null;
    const [crmAuditRow] = await db
      .select()
      .from(crechePromotionalCampaignAuditsTable)
      .where(
        and(
          eq(crechePromotionalCampaignAuditsTable.campaignId, campaignId),
          eq(crechePromotionalCampaignAuditsTable.crecheId, crecheId),
          eq(crechePromotionalCampaignAuditsTable.action, "CAMPAIGN_DRAFT_CREATED_FROM_OPPORTUNITY")
        )
      )
      .limit(1);

    if (crmAuditRow) {
      const afterState = crmAuditRow.afterState as any;
      if (afterState?.selectedTutorCount != null && Number.isInteger(Number(afterState.selectedTutorCount))) {
        crmAudienceAtCreation = Number(afterState.selectedTutorCount);
      }
    }

    // 2. Redemption Status Breakdown
    const redemptionRows = await db
      .select({
        status: crechePromotionalCampaignRedemptionsTable.status,
        count: sql<number>`count(*)::int`,
      })
      .from(crechePromotionalCampaignRedemptionsTable)
      .where(
        and(
          eq(crechePromotionalCampaignRedemptionsTable.campaignId, campaignId),
          eq(crechePromotionalCampaignRedemptionsTable.crecheId, crecheId)
        )
      )
      .groupBy(crechePromotionalCampaignRedemptionsTable.status);

    let totalRedemptions = 0;
    const redMap: Record<string, number> = {};
    for (const r of redemptionRows) {
      redMap[r.status] = r.count;
      totalRedemptions += r.count;
    }

    // Unique tutors count
    const [uniqueTotalRow] = await db
      .select({
        count: sql<number>`count(distinct ${crechePromotionalCampaignRedemptionsTable.tutorId})::int`,
      })
      .from(crechePromotionalCampaignRedemptionsTable)
      .where(
        and(
          eq(crechePromotionalCampaignRedemptionsTable.campaignId, campaignId),
          eq(crechePromotionalCampaignRedemptionsTable.crecheId, crecheId)
        )
      );

    const [uniqueAppliedRow] = await db
      .select({
        count: sql<number>`count(distinct ${crechePromotionalCampaignRedemptionsTable.tutorId})::int`,
      })
      .from(crechePromotionalCampaignRedemptionsTable)
      .where(
        and(
          eq(crechePromotionalCampaignRedemptionsTable.campaignId, campaignId),
          eq(crechePromotionalCampaignRedemptionsTable.crecheId, crecheId),
          inArray(crechePromotionalCampaignRedemptionsTable.status, ["PARTIALLY_APPLIED", "APPLIED"])
        )
      );

    const uniqueTutorsAppliedCount = uniqueAppliedRow?.count || 0;

    // Utilization rate percentage: only valid if audience is known and campaign is not in DRAFT
    let utilizationRatePercentage: number | null = null;
    const denominator = crmAudienceAtCreation ?? currentSelectedAudienceSize;
    if (campaign.status !== "DRAFT" && denominator != null && denominator > 0) {
      utilizationRatePercentage = Math.round((uniqueTutorsAppliedCount / denominator) * 10000) / 100;
    }

    // 3. Financial Metrics (Exclusive to creche_admin)
    let financial: CampaignFinancialMetrics | null = null;
    if (hasFinancialAccess) {
      financial = await this.calculateCampaignFinancialMetrics(crecheId, campaignId, {
        period: "all",
        startInstant: null,
        endInstant: null,
        startDateStr: null,
        endDateStr: null,
      });
    }

    return {
      crecheId,
      campaignId,
      campaignName: campaign.name,
      status: campaign.status as CampaignStatus,
      benefitType: campaign.benefitType as CampaignBenefitType,
      audienceType: campaign.audienceType,
      audienceAvailability,
      currentSelectedAudienceSize,
      crmAudienceAtCreation,
      utilizationRatePercentage,
      redemptionSummary: {
        totalRedemptions,
        reservedCount: redMap["RESERVED"] || 0,
        partiallyAppliedCount: redMap["PARTIALLY_APPLIED"] || 0,
        appliedCount: redMap["APPLIED"] || 0,
        releasedCount: redMap["RELEASED"] || 0,
        uniqueTutorsCount: uniqueTotalRow?.count || 0,
        uniqueTutorsAppliedCount,
      },
      hasFinancialAccess,
      financial,
    };
  }

  /**
   * 3. Tutor Condition Metrics (R37.B commercial conditions).
   */
  static async getTutorConditionMetrics(
    crecheId: number,
    filter: MetricsDateFilter,
    actor: MetricsActorContext
  ): Promise<TutorConditionMetricsResult> {
    const { hasFinancialAccess } = this.assertAuthorized(crecheId, actor);
    const window = resolveTimeWindow(filter);
    const businessNow = new Date();

    // 1. Condition counts and statuses in creche
    const conditionRows = await db
      .select({
        status: tutorCommercialConditionsTable.status,
        conditionType: tutorCommercialConditionsTable.conditionType,
        validFrom: tutorCommercialConditionsTable.validFrom,
        validUntil: tutorCommercialConditionsTable.validUntil,
      })
      .from(tutorCommercialConditionsTable)
      .where(eq(tutorCommercialConditionsTable.crecheId, crecheId));

    let scheduledCount = 0;
    let persistedActiveCount = 0;
    let effectiveActiveCount = 0;
    let revokedCount = 0;
    let expiredByTimeCount = 0;

    for (const c of conditionRows) {
      if (c.status === "REVOKED") {
        revokedCount++;
      } else if (c.validUntil && new Date(c.validUntil) <= businessNow) {
        expiredByTimeCount++;
        if (c.status === "ACTIVE") persistedActiveCount++;
      } else if (c.status === "SCHEDULED" || new Date(c.validFrom) > businessNow) {
        scheduledCount++;
      } else if (c.status === "ACTIVE") {
        persistedActiveCount++;
        effectiveActiveCount++;
      }
    }

    // 2. Unique tutors with active condition
    const [uniqueTutorsRow] = await db
      .select({
        count: sql<number>`count(distinct ${tutorCommercialConditionsTable.tutorId})::int`,
      })
      .from(tutorCommercialConditionsTable)
      .where(
        and(
          eq(tutorCommercialConditionsTable.crecheId, crecheId),
          eq(tutorCommercialConditionsTable.status, "ACTIVE"),
          sql`(${tutorCommercialConditionsTable.validUntil} IS NULL OR ${tutorCommercialConditionsTable.validUntil} > ${businessNow.toISOString()}::timestamp)`
        )
      );

    // 3. Financial applications of tutor conditions (from invoice_items)
    let financialData: TutorConditionMetricsResult["financial"] = null;

    if (hasFinancialAccess) {
      const invConds = [
        eq(invoicesTable.crecheId, crecheId),
        eq(invoiceItemsTable.pricingSourceType, "TUTOR_CONDITION"),
      ];
      if (window.startInstant) {
        invConds.push(gte(invoiceItemsTable.itemDate, window.startInstant));
      }
      if (window.endInstant) {
        invConds.push(lt(invoiceItemsTable.itemDate, window.endInstant));
      }

      const conditionItems = await db
        .select({
          id: invoiceItemsTable.id,
          quantity: invoiceItemsTable.quantity,
          baseUnitPrice: invoiceItemsTable.baseUnitPrice,
          discountAmount: invoiceItemsTable.discountAmount,
          finalPrice: invoiceItemsTable.finalPrice,
          amount: invoiceItemsTable.amount,
          conditionSnapshot: invoiceItemsTable.conditionSnapshot,
        })
        .from(invoiceItemsTable)
        .innerJoin(invoicesTable, eq(invoiceItemsTable.invoiceId, invoicesTable.id))
        .where(and(...invConds));

      let totalBaseCents = 0;
      let totalDiscountCents = 0;
      let totalFinalCents = 0;

      const typeMap: Record<string, { configured: number; appliedLines: number; discountCents: number; finalCents: number }> = {
        CUSTOM_PRICE: { configured: 0, appliedLines: 0, discountCents: 0, finalCents: 0 },
        PERCENTAGE_DISCOUNT: { configured: 0, appliedLines: 0, discountCents: 0, finalCents: 0 },
        FIXED_DISCOUNT: { configured: 0, appliedLines: 0, discountCents: 0, finalCents: 0 },
      };

      for (const c of conditionRows) {
        if (typeMap[c.conditionType]) {
          typeMap[c.conditionType].configured++;
        }
      }

      for (const it of conditionItems) {
        const qty = it.quantity || 1;
        const lineFinalCents = parseCents(it.amount);
        const unitBaseCents = parseCents(it.baseUnitPrice);
        const lineBaseCents = unitBaseCents * qty;
        const lineDiscountCents = Math.max(0, lineBaseCents - lineFinalCents);

        totalBaseCents += lineBaseCents;
        totalDiscountCents += lineDiscountCents;
        totalFinalCents += lineFinalCents;

        const snapType = (it.conditionSnapshot as any)?.conditionType || "CUSTOM_PRICE";
        if (typeMap[snapType]) {
          typeMap[snapType].appliedLines++;
          typeMap[snapType].discountCents += lineDiscountCents;
          typeMap[snapType].finalCents += lineFinalCents;
        }
      }

      financialData = {
        appliedLinesCount: conditionItems.length,
        baseAmountCents: totalBaseCents,
        discountGrantedCents: totalDiscountCents,
        finalChargedAmountCents: totalFinalCents,
        typeBreakdown: (["CUSTOM_PRICE", "PERCENTAGE_DISCOUNT", "FIXED_DISCOUNT"] as const).map((t) => ({
          conditionType: t,
          conditionsConfigured: typeMap[t].configured,
          appliedLinesCount: typeMap[t].appliedLines,
          discountGrantedCents: typeMap[t].discountCents,
          finalChargedAmountCents: typeMap[t].finalCents,
        })),
      };
    }

    return {
      crecheId,
      timeWindow: window,
      conditionsCount: {
        total: conditionRows.length,
        scheduledCount,
        activeCount: effectiveActiveCount, // Temporally active conditions
        persistedActiveCount,
        effectiveActiveCount,
        revokedCount,
        expiredByTimeCount,
      },
      uniqueTutorsWithActiveCondition: uniqueTutorsRow?.count || 0,
      hasFinancialAccess,
      financial: financialData,
    };
  }

  /**
   * 4. CRM Origin Metrics for campaigns born out of CRM opportunities.
   */
  static async getCrmOriginMetrics(
    crecheId: number,
    actor: MetricsActorContext
  ): Promise<CrmOriginMetricsResult> {
    const { hasFinancialAccess } = this.assertAuthorized(crecheId, actor);

    // Locate all campaigns created from opportunities
    const auditRows = await db
      .select({
        campaignId: crechePromotionalCampaignAuditsTable.campaignId,
        action: crechePromotionalCampaignAuditsTable.action,
        reason: crechePromotionalCampaignAuditsTable.reason,
        afterState: crechePromotionalCampaignAuditsTable.afterState,
        createdAt: crechePromotionalCampaignAuditsTable.createdAt,
      })
      .from(crechePromotionalCampaignAuditsTable)
      .where(
        and(
          eq(crechePromotionalCampaignAuditsTable.crecheId, crecheId),
          eq(crechePromotionalCampaignAuditsTable.action, "CAMPAIGN_DRAFT_CREATED_FROM_OPPORTUNITY")
        )
      )
      .orderBy(desc(crechePromotionalCampaignAuditsTable.createdAt));

    // Deduplicate by campaignId
    const seenCampaignIds = new Set<number>();
    const uniqueAudits: typeof auditRows = [];
    for (const a of auditRows) {
      if (!seenCampaignIds.has(a.campaignId)) {
        seenCampaignIds.add(a.campaignId);
        uniqueAudits.push(a);
      }
    }

    const campaignsList: CrmOriginCampaignItem[] = [];
    let inactiveCount = 0;
    let newTutorsCount = 0;
    let neverUsedCount = 0;

    for (const audit of uniqueAudits) {
      const [camp] = await db
        .select()
        .from(crechePromotionalCampaignsTable)
        .where(
          and(
            eq(crechePromotionalCampaignsTable.id, audit.campaignId),
            eq(crechePromotionalCampaignsTable.crecheId, crecheId)
          )
        )
        .limit(1);

      if (!camp) continue;

      // Extract opportunityType and sourceAuthority
      let oppType: "INACTIVE_TUTORS" | "NEW_TUTORS" | "NEVER_USED_SERVICE" | "UNKNOWN" = "UNKNOWN";
      let sourceAuthority: "STRUCTURED_AFTER_STATE" | "LEGACY_REASON_FALLBACK" = "STRUCTURED_AFTER_STATE";
      const afterState = audit.afterState as any;
      if (afterState?.opportunityType) {
        oppType = afterState.opportunityType;
        sourceAuthority = "STRUCTURED_AFTER_STATE";
      } else if (audit.reason.includes("INACTIVE_TUTORS")) {
        oppType = "INACTIVE_TUTORS";
        sourceAuthority = "LEGACY_REASON_FALLBACK";
      } else if (audit.reason.includes("NEW_TUTORS")) {
        oppType = "NEW_TUTORS";
        sourceAuthority = "LEGACY_REASON_FALLBACK";
      } else if (audit.reason.includes("NEVER_USED_SERVICE")) {
        oppType = "NEVER_USED_SERVICE";
        sourceAuthority = "LEGACY_REASON_FALLBACK";
      }

      if (oppType === "INACTIVE_TUTORS") inactiveCount++;
      if (oppType === "NEW_TUTORS") newTutorsCount++;
      if (oppType === "NEVER_USED_SERVICE") neverUsedCount++;

      // Current audience size
      const [tutorCountRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(crechePromotionalCampaignTutorsTable)
        .where(
          and(
            eq(crechePromotionalCampaignTutorsTable.campaignId, camp.id),
            eq(crechePromotionalCampaignTutorsTable.crecheId, crecheId)
          )
        );

      const currentSelectedAudienceSize = tutorCountRow?.count || 0;
      const crmAudienceAtCreation = afterState?.selectedTutorCount != null
        ? Number(afterState.selectedTutorCount)
        : null;

      // Redemptions count
      const [redCountRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(crechePromotionalCampaignRedemptionsTable)
        .where(
          and(
            eq(crechePromotionalCampaignRedemptionsTable.campaignId, camp.id),
            eq(crechePromotionalCampaignRedemptionsTable.crecheId, crecheId)
          )
        );

      // Applied tutors count
      const [appliedTutorsRow] = await db
        .select({
          count: sql<number>`count(distinct ${crechePromotionalCampaignRedemptionsTable.tutorId})::int`,
        })
        .from(crechePromotionalCampaignRedemptionsTable)
        .where(
          and(
            eq(crechePromotionalCampaignRedemptionsTable.campaignId, camp.id),
            eq(crechePromotionalCampaignRedemptionsTable.crecheId, crecheId),
            inArray(crechePromotionalCampaignRedemptionsTable.status, ["PARTIALLY_APPLIED", "APPLIED"])
          )
        );

      let finalChargedAmountCents: number | null = null;
      let discountGrantedCents: number | null = null;

      if (hasFinancialAccess) {
        const fin = await this.calculateCampaignFinancialMetrics(crecheId, camp.id, {
          period: "all",
          startInstant: null,
          endInstant: null,
          startDateStr: null,
          endDateStr: null,
        });
        finalChargedAmountCents = fin.grossAppliedFinalAmountCents;
        discountGrantedCents = fin.grossAppliedDiscountCents;
      }

      campaignsList.push({
        campaignId: camp.id,
        campaignName: camp.name,
        status: camp.status as CampaignStatus,
        opportunityType: oppType,
        sourceAuthority,
        createdAt: audit.createdAt.toISOString(),
        currentSelectedAudienceSize,
        crmAudienceAtCreation,
        totalRedemptions: redCountRow?.count || 0,
        uniqueTutorsApplied: appliedTutorsRow?.count || 0,
        hasFinancialAccess,
        finalChargedAmountCents,
        discountGrantedCents,
      });
    }

    return {
      crecheId,
      totalCampaignsCreatedFromOpportunity: campaignsList.length,
      byOpportunityType: {
        inactiveTutorsCount: inactiveCount,
        newTutorsCount: newTutorsCount,
        neverUsedServiceCount: neverUsedCount,
      },
      campaigns: campaignsList,
    };
  }

  /**
   * Helper: Calculates precise financial amounts and invoice status breakdown.
   * Decoupled queries prevent Cartesian duplicates.
   */
  private static async calculateCampaignFinancialMetrics(
    crecheId: number,
    campaignId: number | null,
    window: ResolvedTimeWindow
  ): Promise<CampaignFinancialMetrics> {
    const statusBreakdown = emptyInvoiceStatusBreakdown();

    // 1. Monetary Applications from invoice_items
    const invConds = [
      eq(invoicesTable.crecheId, crecheId),
      eq(invoiceItemsTable.pricingSourceType, "CAMPAIGN"),
    ];
    if (campaignId != null) {
      invConds.push(eq(invoiceItemsTable.appliedCampaignId, campaignId));
    }
    if (window.startInstant) {
      invConds.push(gte(invoiceItemsTable.itemDate, window.startInstant));
    }
    if (window.endInstant) {
      invConds.push(lt(invoiceItemsTable.itemDate, window.endInstant));
    }

    const monetaryItems = await db
      .select({
        id: invoiceItemsTable.id,
        quantity: invoiceItemsTable.quantity,
        baseUnitPrice: invoiceItemsTable.baseUnitPrice,
        discountAmount: invoiceItemsTable.discountAmount,
        finalPrice: invoiceItemsTable.finalPrice,
        amount: invoiceItemsTable.amount,
        invoiceStatus: invoicesTable.status,
      })
      .from(invoiceItemsTable)
      .innerJoin(invoicesTable, eq(invoiceItemsTable.invoiceId, invoicesTable.id))
      .where(and(...invConds));

    let grossMonetaryBaseCents = 0;
    let grossMonetaryDiscountCents = 0;
    let grossMonetaryFinalCents = 0;
    let nonVoidedNonRefundedFinalAmountCents = 0;

    for (const item of monetaryItems) {
      const qty = item.quantity || 1;
      const lineFinalCents = parseCents(item.amount);
      const unitBaseCents = parseCents(item.baseUnitPrice);
      const lineBaseCents = unitBaseCents * qty;
      const lineDiscountCents = Math.max(0, lineBaseCents - lineFinalCents);

      grossMonetaryBaseCents += lineBaseCents;
      grossMonetaryDiscountCents += lineDiscountCents;
      grossMonetaryFinalCents += lineFinalCents;

      // Status breakdown
      const s = item.invoiceStatus;
      let targetBucket: InvoiceStatusBucket | null = null;
      if (s === "pending") targetBucket = statusBreakdown.pending;
      else if (s === "awaiting_confirmation") targetBucket = statusBreakdown.awaitingConfirmation;
      else if (s === "overdue") targetBucket = statusBreakdown.overdue;
      else if (s === "paid") targetBucket = statusBreakdown.paid;
      else if (s === "voided") targetBucket = statusBreakdown.voided;
      else if (s === "refunded") targetBucket = statusBreakdown.refunded;

      if (targetBucket) {
        targetBucket.lineCount++;
        targetBucket.finalChargedAmountCents += lineFinalCents;
        targetBucket.discountGrantedCents += lineDiscountCents;
      }

      if (s !== "voided" && s !== "refunded") {
        nonVoidedNonRefundedFinalAmountCents += lineFinalCents;
      }
    }

    // 2. Complimentary Applications from redemption_items (Option 2: COMPLIMENTARY_ZERO_VALUE)
    const compConds = [
      eq(crechePromotionalCampaignRedemptionsTable.crecheId, crecheId),
      eq(crechePromotionalCampaignRedemptionItemsTable.status, "APPLIED"),
      eq(crechePromotionalCampaignRedemptionItemsTable.applicationMode, "COMPLIMENTARY_ZERO_VALUE"),
    ];
    if (campaignId != null) {
      compConds.push(eq(crechePromotionalCampaignRedemptionsTable.campaignId, campaignId));
    }
    if (window.startInstant) {
      compConds.push(gte(crechePromotionalCampaignRedemptionItemsTable.appliedAt, window.startInstant));
    }
    if (window.endInstant) {
      compConds.push(lt(crechePromotionalCampaignRedemptionItemsTable.appliedAt, window.endInstant));
    }

    const compItems = await db
      .select({
        id: crechePromotionalCampaignRedemptionItemsTable.id,
        baseLineTotalCents: crechePromotionalCampaignRedemptionItemsTable.baseLineTotalCents,
        discountLineTotalCents: crechePromotionalCampaignRedemptionItemsTable.discountLineTotalCents,
        finalLineTotalCents: crechePromotionalCampaignRedemptionItemsTable.finalLineTotalCents,
      })
      .from(crechePromotionalCampaignRedemptionItemsTable)
      .innerJoin(
        crechePromotionalCampaignRedemptionsTable,
        eq(crechePromotionalCampaignRedemptionItemsTable.redemptionId, crechePromotionalCampaignRedemptionsTable.id)
      )
      .where(and(...compConds));

    let complimentaryBaseValueCents = 0;
    let complimentaryDiscountGrantedCents = 0;

    for (const it of compItems) {
      complimentaryBaseValueCents += it.baseLineTotalCents;
      complimentaryDiscountGrantedCents += it.discountLineTotalCents;
    }

    // Total gross amounts = monetary + complimentary
    const grossAppliedBaseAmountCents = grossMonetaryBaseCents + complimentaryBaseValueCents;
    const grossAppliedDiscountCents = grossMonetaryDiscountCents + complimentaryDiscountGrantedCents;
    const grossAppliedFinalAmountCents = grossMonetaryFinalCents; // Complimentary final charged is 0

    return {
      grossAppliedBaseAmountCents,
      grossAppliedDiscountCents,
      grossAppliedFinalAmountCents,
      nonVoidedNonRefundedFinalAmountCents,
      monetaryApplicationsCount: monetaryItems.length,
      complimentaryApplicationsCount: compItems.length,
      complimentaryBaseValueCents,
      complimentaryDiscountGrantedCents,
      invoiceStatusBreakdown: statusBreakdown,
    };
  }
}
