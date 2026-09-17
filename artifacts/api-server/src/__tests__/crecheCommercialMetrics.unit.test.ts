import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CrecheCommercialMetricsService,
  resolveTimeWindow,
  type MetricsActorContext,
} from "../services/crecheCommercialMetrics.service.js";
import {
  CrecheCampaignForbiddenError,
  CrecheCampaignNotFoundError,
} from "../services/crecheCampaignPricing.js";
import { db } from "@workspace/db";

function mockDrizzle(sequence: any[]) {
  let callIndex = 0;
  vi.spyOn(db, "select").mockImplementation((() => {
    const currentResult = sequence[callIndex] !== undefined ? sequence[callIndex] : [];
    callIndex++;
    const query: any = {
      from: vi.fn().mockImplementation(() => query),
      where: vi.fn().mockImplementation(() => query),
      groupBy: vi.fn().mockImplementation(() => query),
      limit: vi.fn().mockImplementation(() => query),
      orderBy: vi.fn().mockImplementation(() => query),
      innerJoin: vi.fn().mockImplementation(() => query),
      then: (resolve: any) => resolve(currentResult),
    };
    return query;
  }) as any);
}

describe("CrecheCommercialMetricsService — Unit Tests (R37.E)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Security, Tenant Isolation & RBAC Projection", () => {
    it("allows creche_admin within own tenant and grants financial access", () => {
      const actor: MetricsActorContext = {
        userId: 10,
        role: "creche_admin",
        crecheId: 1,
        source: "http",
      };
      const result = CrecheCommercialMetricsService.assertAuthorized(1, actor);
      expect(result.hasFinancialAccess).toBe(true);
    });

    it("allows staff within own tenant and denies financial access (operational only)", () => {
      const actor: MetricsActorContext = {
        userId: 20,
        role: "staff",
        crecheId: 1,
        source: "http",
      };
      const result = CrecheCommercialMetricsService.assertAuthorized(1, actor);
      expect(result.hasFinancialAccess).toBe(false);
    });

    it("denies tutor with 403 Forbidden", () => {
      const actor: MetricsActorContext = {
        userId: 30,
        role: "tutor",
        crecheId: 1,
        source: "http",
      };
      expect(() => CrecheCommercialMetricsService.assertAuthorized(1, actor)).toThrow(
        CrecheCampaignForbiddenError
      );
    });

    it("denies master_admin without active support session with 403 Forbidden", () => {
      const actor: MetricsActorContext = {
        userId: 1,
        role: "master_admin",
        crecheId: null,
        source: "http",
      };
      expect(() => CrecheCommercialMetricsService.assertAuthorized(1, actor)).toThrow(
        CrecheCampaignForbiddenError
      );
    });

    it("fails closed on cross-tenant access with 403 Forbidden", () => {
      const actor: MetricsActorContext = {
        userId: 10,
        role: "creche_admin",
        crecheId: 2, // Belongs to creche 2
        source: "http",
      };
      // Attempting to access creche 1
      expect(() => CrecheCommercialMetricsService.assertAuthorized(1, actor)).toThrow(
        CrecheCampaignForbiddenError
      );
    });

    it("rejects unauthenticated caller with 403 Forbidden", () => {
      expect(() =>
        CrecheCommercialMetricsService.assertAuthorized(1, {} as any)
      ).toThrow(CrecheCampaignForbiddenError);
    });
  });

  describe("2. Date Window Resolution (America/Sao_Paulo)", () => {
    it("resolves 'all' period with null start/end instants", () => {
      const window = resolveTimeWindow({ period: "all" });
      expect(window.period).toBe("all");
      expect(window.startInstant).toBeNull();
      expect(window.endInstant).toBeNull();
    });

    it("resolves '7d', '30d', and '90d' periods with valid UTC timestamps", () => {
      const w7 = resolveTimeWindow({ period: "7d" });
      const w30 = resolveTimeWindow({ period: "30d" });
      const w90 = resolveTimeWindow({ period: "90d" });

      expect(w7.period).toBe("7d");
      expect(w7.startInstant).toBeInstanceOf(Date);
      expect(w7.endInstant).toBeInstanceOf(Date);
      expect(w7.startInstant!.getTime()).toBeLessThan(w7.endInstant!.getTime());

      expect(w30.period).toBe("30d");
      expect(w90.period).toBe("90d");
      expect(w90.startInstant!.getTime()).toBeLessThan(w30.startInstant!.getTime());
    });

    it("resolves custom period [startInclusive, endExclusive)", () => {
      const custom = resolveTimeWindow({
        period: "custom",
        startDate: "2026-08-01",
        endDate: "2026-08-31",
      });
      expect(custom.period).toBe("custom");
      expect(custom.startDateStr).toBe("2026-08-01");
      expect(custom.endDateStr).toBe("2026-08-31");
      expect(custom.startInstant).toBeInstanceOf(Date);
      expect(custom.endInstant).toBeInstanceOf(Date);
      expect(custom.startInstant!.getTime()).toBeLessThan(custom.endInstant!.getTime());
    });
  });

  describe("3. Overview Metrics & Anti-Double-Counting", () => {
    it("returns null financial data for staff role (strictly no zeros)", async () => {
      mockDrizzle([
        [{ status: "ACTIVE", count: 2 }, { status: "DRAFT", count: 1 }], // campaignsByStatus
        [{ status: "APPLIED", count: 1, uniqueTutors: 1 }],               // cohort status
        [{ count: 1 }],                                                   // cohort unique tutors
        [{ count: 1, uniqueTutors: 1 }],                                 // applications in period
      ]);

      const staffActor: MetricsActorContext = {
        userId: 20,
        role: "staff",
        crecheId: 1,
        source: "http",
      };

      const result = await CrecheCommercialMetricsService.getCampaignOverviewMetrics(
        1,
        { period: "30d" },
        staffActor
      );

      expect(result.hasFinancialAccess).toBe(false);
      expect(result.financial).toBeNull();
      expect(result.campaignsByStatus.active).toBe(2);
      expect(result.campaignsByStatus.draft).toBe(1);
      expect(result.redemptionCohort.currentlyApplied).toBe(1);
      expect(result.redemptionCohort.uniqueTutorsInCohort).toBe(1);
    });

    it("computes all 6 invoice status buckets accurately for creche_admin", async () => {
      const mockMonetaryItems = [
        {
          id: 1,
          quantity: 1,
          baseUnitPrice: "100.00",
          discountAmount: "20.00",
          finalPrice: "80.00",
          amount: "80.00",
          invoiceStatus: "paid",
        },
        {
          id: 2,
          quantity: 1,
          baseUnitPrice: "100.00",
          discountAmount: "20.00",
          finalPrice: "80.00",
          amount: "80.00",
          invoiceStatus: "pending",
        },
        {
          id: 3,
          quantity: 1,
          baseUnitPrice: "100.00",
          discountAmount: "20.00",
          finalPrice: "80.00",
          amount: "80.00",
          invoiceStatus: "awaiting_confirmation",
        },
        {
          id: 4,
          quantity: 1,
          baseUnitPrice: "100.00",
          discountAmount: "20.00",
          finalPrice: "80.00",
          amount: "80.00",
          invoiceStatus: "overdue",
        },
        {
          id: 5,
          quantity: 1,
          baseUnitPrice: "100.00",
          discountAmount: "20.00",
          finalPrice: "80.00",
          amount: "80.00",
          invoiceStatus: "voided",
        },
        {
          id: 6,
          quantity: 1,
          baseUnitPrice: "100.00",
          discountAmount: "20.00",
          finalPrice: "80.00",
          amount: "80.00",
          invoiceStatus: "refunded",
        },
      ];

      mockDrizzle([
        [], // campaignsByStatus
        [], // cohort status
        [{ count: 0 }], // cohort unique tutors
        [{ count: 0, uniqueTutors: 0 }], // applications in period
        mockMonetaryItems, // monetaryItems in calculateCampaignFinancialMetrics
        [], // complimentaryItems in calculateCampaignFinancialMetrics
      ]);

      const adminActor: MetricsActorContext = {
        userId: 10,
        role: "creche_admin",
        crecheId: 1,
        source: "http",
      };

      const result = await CrecheCommercialMetricsService.getCampaignOverviewMetrics(
        1,
        { period: "30d" },
        adminActor
      );

      expect(result.hasFinancialAccess).toBe(true);
      expect(result.financial).not.toBeNull();
      const fin = result.financial!;

      expect(fin.invoiceStatusBreakdown.pending.lineCount).toBe(1);
      expect(fin.invoiceStatusBreakdown.pending.finalChargedAmountCents).toBe(8000);
      expect(fin.invoiceStatusBreakdown.awaitingConfirmation.lineCount).toBe(1);
      expect(fin.invoiceStatusBreakdown.overdue.lineCount).toBe(1);
      expect(fin.invoiceStatusBreakdown.paid.lineCount).toBe(1);
      expect(fin.invoiceStatusBreakdown.voided.lineCount).toBe(1);
      expect(fin.invoiceStatusBreakdown.refunded.lineCount).toBe(1);

      // Voided and refunded are excluded from valid net amount
      expect(fin.nonVoidedNonRefundedFinalAmountCents).toBe(32000);
      expect(fin.grossAppliedFinalAmountCents).toBe(48000);
      expect(fin.grossAppliedDiscountCents).toBe(12000);
      expect(fin.grossAppliedBaseAmountCents).toBe(60000);
    });
  });

  describe("4. Campaign Detail Metrics & Audience Availability", () => {
    it("reports UNAVAILABLE_HISTORICAL and null audience size for ALL_ACTIVE_TUTORS", async () => {
      mockDrizzle([
        [{
          id: 100,
          crecheId: 1,
          name: "Black Friday Geral",
          status: "ACTIVE",
          benefitType: "PERCENTAGE_DISCOUNT",
          audienceType: "ALL_ACTIVE_TUTORS",
        }], // campaign
        [], // crmAuditRow
        [], // redemptionRows
        [{ count: 0 }], // uniqueTotalRow
        [{ count: 0 }], // uniqueAppliedRow
        [], // monetaryItems
        [], // compItems
      ]);

      const adminActor: MetricsActorContext = {
        userId: 10,
        role: "creche_admin",
        crecheId: 1,
        source: "http",
      };

      const detail = await CrecheCommercialMetricsService.getCampaignDetailMetrics(
        1,
        100,
        adminActor
      );

      expect(detail.audienceType).toBe("ALL_ACTIVE_TUTORS");
      expect(detail.audienceAvailability).toBe("UNAVAILABLE_HISTORICAL");
      expect(detail.currentSelectedAudienceSize).toBeNull();
      expect(detail.utilizationRatePercentage).toBeNull();
    });

    it("reports EXACT_MATERIALIZED and calculates utilization rate for SELECTED_TUTORS", async () => {
      mockDrizzle([
        [{
          id: 101,
          crecheId: 1,
          name: "Campanha Segmentada",
          status: "ACTIVE",
          benefitType: "PERCENTAGE_DISCOUNT",
          audienceType: "SELECTED_TUTORS",
        }], // campaign
        [{ count: 50 }], // tutorsCountRow (audience size)
        [], // crmAuditRow
        [{ status: "APPLIED", count: 10 }], // redemptionRows
        [{ count: 15 }], // uniqueTotalRow
        [{ count: 10 }], // uniqueAppliedRow
        [], // monetaryItems
        [], // compItems
      ]);

      const adminActor: MetricsActorContext = {
        userId: 10,
        role: "creche_admin",
        crecheId: 1,
        source: "http",
      };

      const detail = await CrecheCommercialMetricsService.getCampaignDetailMetrics(
        1,
        101,
        adminActor
      );

      expect(detail.audienceType).toBe("SELECTED_TUTORS");
      expect(detail.audienceAvailability).toBe("EXACT_MATERIALIZED");
      expect(detail.currentSelectedAudienceSize).toBe(50);
      // 10 / 50 = 20.00%
      expect(detail.utilizationRatePercentage).toBe(20);
    });

    it("safely handles zero audience size without division by zero or NaN", async () => {
      mockDrizzle([
        [{
          id: 102,
          crecheId: 1,
          name: "Vazia",
          status: "DRAFT",
          benefitType: "PERCENTAGE_DISCOUNT",
          audienceType: "SELECTED_TUTORS",
        }],
        [{ count: 0 }], // audience = 0
        [],
        [],
        [{ count: 0 }],
        [{ count: 0 }],
        [],
        [],
      ]);

      const adminActor: MetricsActorContext = {
        userId: 10,
        role: "creche_admin",
        crecheId: 1,
        source: "http",
      };

      const detail = await CrecheCommercialMetricsService.getCampaignDetailMetrics(
        1,
        102,
        adminActor
      );

      expect(detail.currentSelectedAudienceSize).toBe(0);
      expect(detail.utilizationRatePercentage).toBeNull();
      expect(Number.isNaN(detail.utilizationRatePercentage)).toBe(false);
    });

    it("throws 404 when campaign is not found in the creche", async () => {
      mockDrizzle([
        [], // campaign not found
      ]);

      const adminActor: MetricsActorContext = {
        userId: 10,
        role: "creche_admin",
        crecheId: 1,
        source: "http",
      };

      await expect(
        CrecheCommercialMetricsService.getCampaignDetailMetrics(1, 9999, adminActor)
      ).rejects.toThrow(CrecheCampaignNotFoundError);
    });
  });

  describe("5. Tutor Commercial Conditions Metrics & Expired Derived State", () => {
    it("correctly derives expiredByTimeCount for conditions past validUntil", async () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      const futureDate = new Date(Date.now() + 86400000).toISOString();

      mockDrizzle([
        [
          { status: "ACTIVE", conditionType: "PERCENTAGE_DISCOUNT", validFrom: pastDate, validUntil: pastDate }, // expired
          { status: "ACTIVE", conditionType: "CUSTOM_PRICE", validFrom: pastDate, validUntil: futureDate },       // active
          { status: "REVOKED", conditionType: "FIXED_DISCOUNT", validFrom: pastDate, validUntil: pastDate },    // revoked
          { status: "SCHEDULED", conditionType: "CUSTOM_PRICE", validFrom: futureDate, validUntil: null },      // scheduled
        ],
        [{ count: 1 }], // unique tutors with active condition
        [], // conditionItems
      ]);

      const adminActor: MetricsActorContext = {
        userId: 10,
        role: "creche_admin",
        crecheId: 1,
        source: "http",
      };

      const metrics = await CrecheCommercialMetricsService.getTutorConditionMetrics(
        1,
        { period: "30d" },
        adminActor
      );

      expect(metrics.conditionsCount.total).toBe(4);
      expect(metrics.conditionsCount.expiredByTimeCount).toBe(1);
      expect(metrics.conditionsCount.activeCount).toBe(1);
      expect(metrics.conditionsCount.revokedCount).toBe(1);
      expect(metrics.conditionsCount.scheduledCount).toBe(1);
    });
  });

  describe("6. CRM Origin Metrics & Audit Trail Parsing", () => {
    it("deduplicates audit entries and classifies opportunity types correctly", async () => {
      const mockAudits = [
        {
          campaignId: 201,
          action: "CAMPAIGN_DRAFT_CREATED_FROM_OPPORTUNITY",
          reason: "Criada a partir de oportunidade CRM (INACTIVE_TUTORS: 60 dias)",
          afterState: { opportunityType: "INACTIVE_TUTORS", selectedTutorCount: 15 },
          createdAt: new Date(),
        },
        // Duplicate audit for same campaign
        {
          campaignId: 201,
          action: "CAMPAIGN_DRAFT_CREATED_FROM_OPPORTUNITY",
          reason: "Criada a partir de oportunidade CRM (INACTIVE_TUTORS: 60 dias)",
          afterState: { opportunityType: "INACTIVE_TUTORS", selectedTutorCount: 15 },
          createdAt: new Date(Date.now() - 1000),
        },
        {
          campaignId: 202,
          action: "CAMPAIGN_DRAFT_CREATED_FROM_OPPORTUNITY",
          reason: "Criada a partir de oportunidade CRM (NEW_TUTORS: 30 dias)",
          afterState: { opportunityType: "NEW_TUTORS", selectedTutorCount: 8 },
          createdAt: new Date(),
        },
      ];

      mockDrizzle([
        mockAudits, // auditRows
        // For campaign 201:
        [{ id: 201, crecheId: 1, name: "Reativação 60d", status: "ACTIVE" }], // camp
        [{ count: 15 }], // tutorCountRow
        [{ count: 2 }],  // redCountRow
        [{ count: 1 }],  // appliedTutorsRow
        // financial calculation for 201:
        [{ id: 1, quantity: 1, baseUnitPrice: "100.00", discountAmount: "20.00", finalPrice: "80.00", amount: "80.00", invoiceStatus: "paid" }], // monetary
        [], // comp
        // For campaign 202:
        [{ id: 202, crecheId: 1, name: "Boas Vindas 30d", status: "ACTIVE" }], // camp
        [{ count: 8 }], // tutorCountRow
        [{ count: 1 }], // redCountRow
        [{ count: 1 }], // appliedTutorsRow
        // financial calculation for 202:
        [], // monetary
        [], // comp
      ]);

      const adminActor: MetricsActorContext = {
        userId: 10,
        role: "creche_admin",
        crecheId: 1,
        source: "http",
      };

      const crmMetrics = await CrecheCommercialMetricsService.getCrmOriginMetrics(
        1,
        adminActor
      );

      // 2 unique campaigns despite duplicate audit entry
      expect(crmMetrics.totalCampaignsCreatedFromOpportunity).toBe(2);
      expect(crmMetrics.byOpportunityType.inactiveTutorsCount).toBe(1);
      expect(crmMetrics.byOpportunityType.newTutorsCount).toBe(1);
      expect(crmMetrics.byOpportunityType.neverUsedServiceCount).toBe(0);

      expect(crmMetrics.campaigns[0].campaignId).toBe(201);
      expect(crmMetrics.campaigns[0].opportunityType).toBe("INACTIVE_TUTORS");
      expect(crmMetrics.campaigns[0].crmAudienceAtCreation).toBe(15);
      expect(crmMetrics.campaigns[0].finalChargedAmountCents).toBe(8000);
      expect(crmMetrics.campaigns[0].discountGrantedCents).toBe(2000);
    });
  });

  describe("7. Anti-Double-Counting, Complimentary Math & Financial Isolation", () => {
    it("aggregates monetary and complimentary zero-value items correctly without double-counting", async () => {
      // 1 monetary line ($100 base, $20 discount, $80 final)
      const mockMonetary = [
        {
          id: 10,
          quantity: 2,
          baseUnitPrice: "50.00", // 2 * 50 = $100 base
          discountAmount: "20.00",
          finalPrice: "40.00",
          amount: "80.00",
          invoiceStatus: "paid",
        },
      ];

      // 1 complimentary item ($60 base, $60 discount, $0 final)
      const mockComp = [
        {
          id: 20,
          baseLineTotalCents: 6000,
          discountLineTotalCents: 6000,
          finalLineTotalCents: 0,
        },
      ];

      mockDrizzle([
        [], // campaigns
        [], // cohort
        [{ count: 0 }], // cohort tutors
        [{ count: 0, uniqueTutors: 0 }], // apps
        mockMonetary,
        mockComp,
      ]);

      const adminActor: MetricsActorContext = {
        userId: 10,
        role: "creche_admin",
        crecheId: 1,
        source: "http",
      };

      const result = await CrecheCommercialMetricsService.getCampaignOverviewMetrics(
        1,
        { period: "all" },
        adminActor
      );

      const fin = result.financial!;
      expect(fin.monetaryApplicationsCount).toBe(1);
      expect(fin.complimentaryApplicationsCount).toBe(1);

      // Base: $100 (monetary) + $60 (complimentary) = $160 = 16000 cents
      expect(fin.grossAppliedBaseAmountCents).toBe(16000);

      // Discount: $20 (monetary) + $60 (complimentary) = $80 = 8000 cents
      expect(fin.grossAppliedDiscountCents).toBe(8000);

      // Final charged: $80 (monetary) + $0 (complimentary) = $80 = 8000 cents
      expect(fin.grossAppliedFinalAmountCents).toBe(8000);

      // Status breakdown only accounts for monetary invoice lines
      expect(fin.invoiceStatusBreakdown.paid.lineCount).toBe(1);
      expect(fin.invoiceStatusBreakdown.paid.finalChargedAmountCents).toBe(8000);
    });
  });
});
