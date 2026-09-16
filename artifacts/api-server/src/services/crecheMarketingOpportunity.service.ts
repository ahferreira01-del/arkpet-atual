import { db } from "@workspace/db";
import {
  usersTable,
  bookingsTable,
  bookingServicesTable,
  catalogueItemsTable,
  petsTable,
  crechePromotionalCampaignAuditsTable,
  type CrechePromotionalCampaign,
} from "@workspace/db/schema";
import { eq, and, inArray, sql, desc, asc } from "drizzle-orm";
import {
  CrecheCampaignValidationError,
  CrecheCampaignNotFoundError,
  CrecheCampaignForbiddenError,
} from "./crecheCampaignPricing.js";
import {
  CrecheCampaignService,
  type ActorContext,
} from "./crecheCampaign.service.js";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface OpportunityTutorSummary {
  tutorId: number;
  tutorName: string;
  email: string;
  petNames: string[];
  lastActivityDate?: string | null;
  registeredAt: string;
  reason: string;
}

export interface OpportunityResult<T = OpportunityTutorSummary> {
  opportunityType: "INACTIVE_TUTORS" | "NEW_TUTORS" | "NEVER_USED_SERVICE";
  count: number;
  criteria: Record<string, unknown>;
  items: T[];
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface GetInactiveTutorsParams {
  crecheId: number;
  days?: number;
  page?: number;
  pageSize?: number;
  client?: any;
}

export interface GetNewTutorsParams {
  crecheId: number;
  days?: number;
  page?: number;
  pageSize?: number;
  client?: any;
}

export interface GetNeverUsedServiceParams {
  crecheId: number;
  catalogueItemId: number;
  page?: number;
  pageSize?: number;
  client?: any;
}

export interface CreateDraftFromOpportunityParams {
  crecheId: number;
  opportunityType: "INACTIVE_TUTORS" | "NEW_TUTORS" | "NEVER_USED_SERVICE";
  days?: number;
  catalogueItemId?: number;
  campaignName?: string;
  actor: ActorContext;
  idempotencyKey?: string;
  client?: any;
}

// ─── Service Class ────────────────────────────────────────────────────────────

export class CrecheMarketingOpportunityService {
  /**
   * RBAC: creche_admin and staff can view opportunities. Tutors are forbidden.
   */
  static assertCanView(role: string): void {
    if (role === "tutor") {
      throw new CrecheCampaignForbiddenError("Tutores não possuem acesso ao CRM de oportunidades.");
    }
    if (role !== "creche_admin" && role !== "staff" && role !== "master_admin") {
      throw new CrecheCampaignForbiddenError("Acesso restrito à gestão da creche.");
    }
  }

  /**
   * RBAC: Only creche_admin can create campaign drafts from CRM opportunities.
   */
  static assertCanMutate(role: string): void {
    if (role !== "creche_admin") {
      throw new CrecheCampaignForbiddenError(
        "Apenas administradores da creche podem criar campanhas a partir de oportunidades."
      );
    }
  }
  /**
   * INACTIVE_TUTORS:
   * Active tutors belonging to crecheId who:
   * 1. Registered prior to cutoff (createdAt < now - N days)
   * 2. Have NO upcoming/current bookings (status IN ('confirmed', 'active') with startDate >= CURRENT_DATE)
   * 3. Have NO completed bookings on or after cutoff (checkOutTime or startDate >= now - N days)
   */
  static async getInactiveTutors(
    params: GetInactiveTutorsParams
  ): Promise<OpportunityResult> {
    const { crecheId, days = 60, page = 1, pageSize = 20, client = db } = params;
    const safeDays = Math.max(1, Math.min(365, Math.floor(days)));
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.max(1, Math.min(100, Math.floor(pageSize)));
    const offset = (safePage - 1) * safePageSize;

    const cutoffDate = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);

    // SQL conditions for inactive tutors
    const inactiveWhere = sql`
      ${usersTable.crecheId} = ${crecheId}
      AND ${usersTable.role} = 'tutor'
      AND ${usersTable.isActive} = true
      AND ${usersTable.createdAt} < ${cutoffDate}
      AND NOT EXISTS (
        SELECT 1 FROM ${bookingsTable} b
        WHERE b.tutor_id = ${usersTable.id}
          AND b.creche_id = ${crecheId}
          AND b.status IN ('confirmed', 'active')
          AND b.start_date >= CURRENT_DATE
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${bookingsTable} b
        WHERE b.tutor_id = ${usersTable.id}
          AND b.creche_id = ${crecheId}
          AND b.status = 'completed'
          AND COALESCE(b.check_out_time, b.start_date::timestamp) >= ${cutoffDate}
      )
    `;

    // 1. Total count
    const [countResult] = await client
      .select({ total: sql<number>`count(*)::integer` })
      .from(usersTable)
      .where(inactiveWhere);

    const totalCount = Number(countResult?.total || 0);

    // 2. Paginated rows with last completed booking date
    const rows = await client
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        createdAt: usersTable.createdAt,
        lastCompletedDate: sql<Date | null>`(
          SELECT MAX(COALESCE(b.check_out_time, b.start_date::timestamp))
          FROM ${bookingsTable} b
          WHERE b.tutor_id = ${usersTable.id}
            AND b.creche_id = ${crecheId}
            AND b.status = 'completed'
        )`,
      })
      .from(usersTable)
      .where(inactiveWhere)
      .orderBy(desc(usersTable.createdAt))
      .limit(safePageSize)
      .offset(offset);

    // 3. Batch fetch pets for these tutors
    const tutorIds = rows.map((r: any) => r.id);
    const petsMap = await this.getTutorPetsMap(crecheId, tutorIds, client);

    const now = Date.now();
    const items: OpportunityTutorSummary[] = rows.map((r: any) => {
      const petNames = petsMap.get(r.id) || [];
      let reason: string;
      let lastActivityDate: string | null = null;

      if (r.lastCompletedDate) {
        const lastDate = new Date(r.lastCompletedDate);
        lastActivityDate = lastDate.toISOString();
        const daysAgo = Math.max(0, Math.floor((now - lastDate.getTime()) / (1000 * 3600 * 24)));
        reason = `Última reserva concluída há ${daysAgo} dias`;
      } else {
        const daysRegistered = Math.max(0, Math.floor((now - new Date(r.createdAt).getTime()) / (1000 * 3600 * 24)));
        reason = `Cadastrado há ${daysRegistered} dias sem reservas concluídas`;
      }

      return {
        tutorId: r.id,
        tutorName: r.name,
        email: r.email,
        petNames,
        lastActivityDate,
        registeredAt: new Date(r.createdAt).toISOString(),
        reason,
      };
    });

    return {
      opportunityType: "INACTIVE_TUTORS",
      count: totalCount,
      criteria: { days: safeDays, cutoffDate: cutoffDate.toISOString() },
      items,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.ceil(totalCount / safePageSize),
    };
  }

  /**
   * NEW_TUTORS:
   * Active tutors registered within the last N days (createdAt >= now - N days).
   */
  static async getNewTutors(
    params: GetNewTutorsParams
  ): Promise<OpportunityResult> {
    const { crecheId, days = 30, page = 1, pageSize = 20, client = db } = params;
    const safeDays = Math.max(1, Math.min(365, Math.floor(days)));
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.max(1, Math.min(100, Math.floor(pageSize)));
    const offset = (safePage - 1) * safePageSize;

    const cutoffDate = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);

    const newWhere = sql`
      ${usersTable.crecheId} = ${crecheId}
      AND ${usersTable.role} = 'tutor'
      AND ${usersTable.isActive} = true
      AND ${usersTable.createdAt} >= ${cutoffDate}
    `;

    const [countResult] = await client
      .select({ total: sql<number>`count(*)::integer` })
      .from(usersTable)
      .where(newWhere);

    const totalCount = Number(countResult?.total || 0);

    const rows = await client
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(newWhere)
      .orderBy(desc(usersTable.createdAt))
      .limit(safePageSize)
      .offset(offset);

    const tutorIds = rows.map((r: any) => r.id);
    const petsMap = await this.getTutorPetsMap(crecheId, tutorIds, client);

    const now = Date.now();
    const items: OpportunityTutorSummary[] = rows.map((r: any) => {
      const petNames = petsMap.get(r.id) || [];
      const daysSince = Math.max(0, Math.floor((now - new Date(r.createdAt).getTime()) / (1000 * 3600 * 24)));
      return {
        tutorId: r.id,
        tutorName: r.name,
        email: r.email,
        petNames,
        registeredAt: new Date(r.createdAt).toISOString(),
        reason: `Cadastrado há ${daysSince} dias`,
      };
    });

    return {
      opportunityType: "NEW_TUTORS",
      count: totalCount,
      criteria: { days: safeDays, cutoffDate: cutoffDate.toISOString() },
      items,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.ceil(totalCount / safePageSize),
    };
  }

  /**
   * NEVER_USED_SERVICE:
   * Active tutors of the creche who have never completed a booking featuring catalogueItemId
   * (neither as primary item nor as an add-on booking service).
   */
  static async getTutorsWhoNeverUsedService(
    params: GetNeverUsedServiceParams
  ): Promise<OpportunityResult> {
    const { crecheId, catalogueItemId, page = 1, pageSize = 20, client = db } = params;
    const safeItemId = Math.floor(catalogueItemId);
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.max(1, Math.min(100, Math.floor(pageSize)));
    const offset = (safePage - 1) * safePageSize;

    // Verify catalogue item existence and tenant boundary
    const [item] = await client
      .select()
      .from(catalogueItemsTable)
      .where(
        and(
          eq(catalogueItemsTable.id, safeItemId),
          eq(catalogueItemsTable.crecheId, crecheId)
        )
      )
      .limit(1);

    if (!item) {
      throw new CrecheCampaignNotFoundError(
        `Item de catálogo #${safeItemId} não encontrado ou não pertence a esta creche.`
      );
    }

    const neverUsedWhere = sql`
      ${usersTable.crecheId} = ${crecheId}
      AND ${usersTable.role} = 'tutor'
      AND ${usersTable.isActive} = true
      AND NOT EXISTS (
        SELECT 1 FROM ${bookingsTable} b
        WHERE b.tutor_id = ${usersTable.id}
          AND b.creche_id = ${crecheId}
          AND b.status = 'completed'
          AND b.primary_catalogue_item_id = ${safeItemId}
      )
      AND NOT EXISTS (
        SELECT 1 FROM ${bookingServicesTable} bs
        JOIN ${bookingsTable} b2 ON b2.id = bs.booking_id
        WHERE b2.tutor_id = ${usersTable.id}
          AND b2.creche_id = ${crecheId}
          AND b2.status = 'completed'
          AND bs.catalogue_item_id = ${safeItemId}
          AND bs.status != 'cancelled'
      )
    `;

    const [countResult] = await client
      .select({ total: sql<number>`count(*)::integer` })
      .from(usersTable)
      .where(neverUsedWhere);

    const totalCount = Number(countResult?.total || 0);

    const rows = await client
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(neverUsedWhere)
      .orderBy(asc(usersTable.name))
      .limit(safePageSize)
      .offset(offset);

    const tutorIds = rows.map((r: any) => r.id);
    const petsMap = await this.getTutorPetsMap(crecheId, tutorIds, client);

    const items: OpportunityTutorSummary[] = rows.map((r: any) => {
      const petNames = petsMap.get(r.id) || [];
      return {
        tutorId: r.id,
        tutorName: r.name,
        email: r.email,
        petNames,
        registeredAt: new Date(r.createdAt).toISOString(),
        reason: `Nunca utilizou o serviço "${item.name}"`,
      };
    });

    return {
      opportunityType: "NEVER_USED_SERVICE",
      count: totalCount,
      criteria: { catalogueItemId: safeItemId, catalogueItemName: item.name },
      items,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.ceil(totalCount / safePageSize),
    };
  }

  /**
   * Helper: Resolves all tutor IDs for an opportunity (unpaginated).
   */
  static async resolveAllOpportunityTutorIds(
    crecheId: number,
    opportunityType: "INACTIVE_TUTORS" | "NEW_TUTORS" | "NEVER_USED_SERVICE",
    options: { days?: number; catalogueItemId?: number },
    client: any = db
  ): Promise<{ tutorIds: number[]; criteria: Record<string, unknown> }> {
    if (opportunityType === "INACTIVE_TUTORS") {
      const safeDays = Math.max(1, Math.min(365, Math.floor(options.days ?? 60)));
      const cutoffDate = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);

      const rows = await client
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(sql`
          ${usersTable.crecheId} = ${crecheId}
          AND ${usersTable.role} = 'tutor'
          AND ${usersTable.isActive} = true
          AND ${usersTable.createdAt} < ${cutoffDate}
          AND NOT EXISTS (
            SELECT 1 FROM ${bookingsTable} b
            WHERE b.tutor_id = ${usersTable.id}
              AND b.creche_id = ${crecheId}
              AND b.status IN ('confirmed', 'active')
              AND b.start_date >= CURRENT_DATE
          )
          AND NOT EXISTS (
            SELECT 1 FROM ${bookingsTable} b
            WHERE b.tutor_id = ${usersTable.id}
              AND b.creche_id = ${crecheId}
              AND b.status = 'completed'
              AND COALESCE(b.check_out_time, b.start_date::timestamp) >= ${cutoffDate}
          )
        `);

      return {
        tutorIds: rows.map((r: any) => r.id),
        criteria: { days: safeDays, cutoffDate: cutoffDate.toISOString() },
      };
    }

    if (opportunityType === "NEW_TUTORS") {
      const safeDays = Math.max(1, Math.min(365, Math.floor(options.days ?? 30)));
      const cutoffDate = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);

      const rows = await client
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(sql`
          ${usersTable.crecheId} = ${crecheId}
          AND ${usersTable.role} = 'tutor'
          AND ${usersTable.isActive} = true
          AND ${usersTable.createdAt} >= ${cutoffDate}
        `);

      return {
        tutorIds: rows.map((r: any) => r.id),
        criteria: { days: safeDays, cutoffDate: cutoffDate.toISOString() },
      };
    }

    if (opportunityType === "NEVER_USED_SERVICE") {
      const safeItemId = Math.floor(options.catalogueItemId ?? 0);
      const [item] = await client
        .select()
        .from(catalogueItemsTable)
        .where(
          and(
            eq(catalogueItemsTable.id, safeItemId),
            eq(catalogueItemsTable.crecheId, crecheId)
          )
        )
        .limit(1);

      if (!item) {
        throw new CrecheCampaignNotFoundError(
          `Item de catálogo #${safeItemId} não encontrado ou não pertence a esta creche.`
        );
      }

      const rows = await client
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(sql`
          ${usersTable.crecheId} = ${crecheId}
          AND ${usersTable.role} = 'tutor'
          AND ${usersTable.isActive} = true
          AND NOT EXISTS (
            SELECT 1 FROM ${bookingsTable} b
            WHERE b.tutor_id = ${usersTable.id}
              AND b.creche_id = ${crecheId}
              AND b.status = 'completed'
              AND b.primary_catalogue_item_id = ${safeItemId}
          )
          AND NOT EXISTS (
            SELECT 1 FROM ${bookingServicesTable} bs
            JOIN ${bookingsTable} b2 ON b2.id = bs.booking_id
            WHERE b2.tutor_id = ${usersTable.id}
              AND b2.creche_id = ${crecheId}
              AND b2.status = 'completed'
              AND bs.catalogue_item_id = ${safeItemId}
              AND bs.status != 'cancelled'
          )
        `);

      return {
        tutorIds: rows.map((r: any) => r.id),
        criteria: { catalogueItemId: safeItemId, catalogueItemName: item.name },
      };
    }

    throw new CrecheCampaignValidationError(`Tipo de oportunidade inválido: ${opportunityType}`);
  }

  /**
   * Materializes an opportunity into a DRAFT campaign with SELECTED_TUTORS audience.
   * - Requires creche_admin role
   * - Blocks empty audiences fail-closed
   * - Does NOT publish
   * - Does NOT send notifications
   */
  static async createCampaignDraftFromOpportunity(
    params: CreateDraftFromOpportunityParams
  ): Promise<CrechePromotionalCampaign> {
    const {
      crecheId,
      opportunityType,
      days,
      catalogueItemId,
      campaignName,
      actor,
      idempotencyKey,
      client = db,
    } = params;

    // RBAC: Only creche_admin can create campaigns
    if (actor.role !== "creche_admin") {
      throw new CrecheCampaignForbiddenError(
        "Apenas administradores de creche podem criar campanhas a partir de oportunidades."
      );
    }

    // Materialize target audience
    const { tutorIds, criteria } = await this.resolveAllOpportunityTutorIds(
      crecheId,
      opportunityType,
      { days, catalogueItemId },
      client
    );

    if (tutorIds.length === 0) {
      throw new CrecheCampaignValidationError(
        "Nenhum tutor encontrado para esta oportunidade no momento. Não é possível criar uma campanha com público vazio."
      );
    }

    // Determine default eligible item(s)
    let targetItemIds: number[] = [];
    if (opportunityType === "NEVER_USED_SERVICE" && catalogueItemId) {
      targetItemIds = [catalogueItemId];
    } else {
      // Pick all available services and day_use items of the creche
      const availableItems = await client
        .select({ id: catalogueItemsTable.id })
        .from(catalogueItemsTable)
        .where(
          and(
            eq(catalogueItemsTable.crecheId, crecheId),
            sql`${catalogueItemsTable.type} IN ('service', 'day_use')`
          )
        );
      targetItemIds = availableItems.map((i: any) => i.id);
    }

    if (targetItemIds.length === 0) {
      throw new CrecheCampaignValidationError(
        "A creche não possui itens de serviço ou day use cadastrados para vincular à campanha."
      );
    }

    // Build default name
    let defaultName: string;
    if (opportunityType === "INACTIVE_TUTORS") {
      defaultName = `Reativação — Inativos ${days ?? 60} dias`;
    } else if (opportunityType === "NEW_TUTORS") {
      defaultName = `Boas-vindas — Novos Tutores (${days ?? 30} dias)`;
    } else {
      const itemName = (criteria as any)?.catalogueItemName || "Serviço";
      defaultName = `Experimente ${itemName}`;
    }

    const finalName = campaignName?.trim() || defaultName;

    // Validity window: [now, now + 30 days]
    const validFrom = new Date();
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 30);

    const description = `Campanha criada a partir da oportunidade CRM: ${opportunityType}. Público materializado: ${tutorIds.length} tutores selecionados.`;

    // Create draft campaign via authoritative campaign service
    const campaign = await CrecheCampaignService.createDraft(
      crecheId,
      actor,
      {
        name: finalName,
        description,
        benefitType: "PERCENTAGE_DISCOUNT",
        percentageBps: 1500, // 15% OFF initial template
        audienceType: "SELECTED_TUTORS",
        selectedTutorIds: tutorIds,
        itemIds: targetItemIds,
        conditionInteractionPolicy: "EXCLUDE_IF_TUTOR_CONDITION",
        usageLimitType: "ONCE_PER_TUTOR",
        usageLimitPerTutor: 1,
        priority: 100,
        validFrom,
        validUntil,
      },
      idempotencyKey
    );

    // Record domain audit for CRM opportunity materialization
    await client.insert(crechePromotionalCampaignAuditsTable).values({
      crecheId,
      campaignId: campaign.id,
      action: "CAMPAIGN_DRAFT_CREATED_FROM_OPPORTUNITY" as any,
      actorUserId: actor.userId,
      actorRole: actor.role,
      actorSource: actor.source || "http",
      reason: `Criada a partir de oportunidade CRM ${opportunityType}`,
      payloadAfter: {
        opportunityType,
        criteria,
        selectedTutorCount: tutorIds.length,
        campaignId: campaign.id,
        name: finalName,
      },
    });

    return campaign;
  }

  /**
   * Helper: Batch fetches pet names per tutor.
   */
  private static async getTutorPetsMap(
    crecheId: number,
    tutorIds: number[],
    client: any
  ): Promise<Map<number, string[]>> {
    const map = new Map<number, string[]>();
    if (tutorIds.length === 0) return map;

    const pets = await client
      .select({
        tutorId: petsTable.tutorId,
        name: petsTable.name,
      })
      .from(petsTable)
      .where(
        and(
          eq(petsTable.crecheId, crecheId),
          inArray(petsTable.tutorId, tutorIds)
        )
      );

    for (const pet of pets) {
      const list = map.get(pet.tutorId) || [];
      list.push(pet.name);
      map.set(pet.tutorId, list);
    }

    return map;
  }
}
