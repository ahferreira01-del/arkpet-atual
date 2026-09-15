import { db } from "@workspace/db";
import {
  crechePromotionalCampaignsTable,
  crechePromotionalCampaignItemsTable,
  crechePromotionalCampaignTutorsTable,
  crechePromotionalCampaignAuditsTable,
  crechePromotionalCampaignRedemptionsTable,
  crechePromotionalCampaignRedemptionItemsTable,
  catalogueItemsTable,
  usersTable,
  bookingsTable,
  bookingServicesTable,
  type CrechePromotionalCampaign,
  type CrechePromotionalCampaignRedemption,
  type CrechePromotionalCampaignRedemptionItem,
  type CampaignBenefitType,
  type CampaignStatus,
} from "@workspace/db/schema";
import { eq, and, sql, inArray, desc, ne } from "drizzle-orm";
import {
  CrecheCampaignError,
  CrecheCampaignValidationError,
  CrecheCampaignNotFoundError,
  CrecheCampaignConflictError,
  calculateCampaignPrice,
  isCampaignActive,
  resolveCommercialPreview,
  type CampaignPricingResult,
} from "./crecheCampaignPricing.js";
import {
  TutorCommercialPricingService,
  decimalStringToCents,
  centsToDecimalString,
} from "./tutorCommercialPricing.js";
import { CrecheCampaignService } from "./crecheCampaign.service.js";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ReserveBookingCampaignsItemInput {
  lineType: "PRIMARY" | "BOOKING_SERVICE";
  catalogueItemId: number;
  bookingServiceId?: number | null;
  quantity?: number;
}

export interface ReserveBookingCampaignsInput {
  crecheId: number;
  tutorId: number;
  bookingId: number;
  petSize?: string | null;
  primaryCatalogueItemId?: number | null;
  additionalServiceItems?: Array<{
    bookingServiceId: number;
    catalogueItemId: number;
    quantity?: number;
  }>;
  atTime?: Date;
  actor?: {
    userId: number;
    role: string;
    source?: "http" | "internal";
    requestId?: string;
  };
}

export interface ReservedCampaignItemSummary {
  catalogueItemId: number;
  lineType: "PRIMARY" | "BOOKING_SERVICE";
  bookingServiceId: number | null;
  pricingSource: "CATALOG" | "TUTOR_CONDITION" | "CAMPAIGN";
  campaignId: number | null;
  campaignName: string | null;
  baseUnitPriceCents: number;
  effectiveUnitPriceCents: number;
  unitDiscountCents: number;
  baseUnitPrice: string;
  effectiveUnitPrice: string;
  unitDiscount: string;
  quantity: number;
  baseLineTotalCents: number;
  discountLineTotalCents: number;
  finalLineTotalCents: number;
  baseLineTotal: string;
  discountLineTotal: string;
  finalLineTotal: string;
  reservationStatus: "RESERVED" | null;
}

export interface BookingCommercialReservationSummary {
  bookingId: number;
  hasReservedCampaign: boolean;
  totalDiscountCents: number;
  totalDiscount: string;
  items: ReservedCampaignItemSummary[];
  redemptions: Array<{
    redemptionId: number;
    campaignId: number;
    campaignName: string;
    status: "RESERVED";
    reservedAt: string;
    itemsCount: number;
  }>;
}

// ─── Service Implementation ───────────────────────────────────────────────────

export class CrecheCampaignReservationService {
  /**
   * Contract 4: Acquires a transaction-level PostgreSQL advisory lock namespaced by (crecheId, tutorId).
   * This strictly serializes commercial reservations for the SAME tutor, preventing capacity races
   * on ONCE_PER_TUTOR / N_PER_TUTOR while preserving full concurrency between different tutors.
   */
  static async acquireTutorCampaignLock(
    tx: any,
    crecheId: number,
    tutorId: number
  ): Promise<void> {
    const lockKey = `campaign_redemption_${crecheId}_${tutorId}`;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
  }

  /**
   * Counts active redemptions for a tutor on a given campaign.
   * Contabiliza como ocupado: RESERVED e APPLIED.
   * Não contabiliza: RELEASED.
   * Optionally excludes a bookingId to support "owned capacity" preservation during modification.
   */
  static async countActiveTutorRedemptions(
    tx: any,
    crecheId: number,
    campaignId: number,
    tutorId: number,
    excludeBookingId?: number
  ): Promise<number> {
    const conditions = [
      eq(crechePromotionalCampaignRedemptionsTable.crecheId, crecheId),
      eq(crechePromotionalCampaignRedemptionsTable.campaignId, campaignId),
      eq(crechePromotionalCampaignRedemptionsTable.tutorId, tutorId),
      inArray(crechePromotionalCampaignRedemptionsTable.status, ["RESERVED", "APPLIED"]),
    ];

    if (excludeBookingId) {
      conditions.push(ne(crechePromotionalCampaignRedemptionsTable.bookingId, excludeBookingId));
    }

    const [row] = await tx
      .select({ countVal: sql<number>`count(*)::int` })
      .from(crechePromotionalCampaignRedemptionsTable)
      .where(and(...conditions));

    return Number(row?.countVal ?? 0);
  }

  /**
   * Checks whether a tutor has capacity to redeem a given campaign.
   * Contract 11 & 15:
   * - UNLIMITED: always true
   * - ONCE_PER_TUTOR: activeCount < 1
   * - N_PER_TUTOR: activeCount < usageLimitPerTutor
   */
  static async hasTutorCapacity(
    tx: any,
    campaign: {
      id: number;
      usageLimitType: string;
      usageLimitPerTutor?: number | null;
    },
    crecheId: number,
    tutorId: number,
    excludeBookingId?: number
  ): Promise<boolean> {
    const usageLimitType = campaign.usageLimitType || "UNLIMITED";
    if (usageLimitType === "UNLIMITED") {
      return true;
    }

    const activeCount = await this.countActiveTutorRedemptions(
      tx,
      crecheId,
      campaign.id,
      tutorId,
      excludeBookingId
    );

    if (campaign.usageLimitType === "ONCE_PER_TUTOR") {
      return activeCount < 1;
    }

    if (campaign.usageLimitType === "N_PER_TUTOR") {
      const limit = campaign.usageLimitPerTutor != null ? Number(campaign.usageLimitPerTutor) : 1;
      return activeCount < limit;
    }

    return false;
  }

  /**
   * Transforms an eligible campaign into a frozen commercial promise in status RESERVED.
   * Contract 14, 15, 16, 17, 22:
   * - Executes within the caller's transaction.
   * - Acquires tutor lock.
   * - Resolves authority with capacity checks.
   * - Inserts 1 redemption per campaign for the booking.
   * - Distinguishes PRIMARY from BOOKING_SERVICE lines.
   * - Zero billing mutation (capturedPrice is untouched).
   */
  static async reserveBookingCampaigns(
    tx: any,
    input: ReserveBookingCampaignsInput
  ): Promise<BookingCommercialReservationSummary> {
    const {
      crecheId,
      tutorId,
      bookingId,
      petSize,
      primaryCatalogueItemId,
      additionalServiceItems = [],
      atTime = new Date(),
      actor,
    } = input;

    // 1. Acquire tutor-level concurrency lock
    await this.acquireTutorCampaignLock(tx, crecheId, tutorId);

    // 2. Validate booking existence and tenant isolation
    const [booking] = await tx
      .select()
      .from(bookingsTable)
      .where(and(eq(bookingsTable.id, bookingId), eq(bookingsTable.crecheId, crecheId)))
      .limit(1);

    if (!booking) {
      throw new CrecheCampaignNotFoundError(
        `Booking #${bookingId} não encontrado nesta creche (violação multi-tenant ou ID inexistente).`
      );
    }

    if (booking.tutorId !== tutorId) {
      throw new CrecheCampaignValidationError(
        `Booking #${bookingId} pertence ao tutor #${booking.tutorId}, divergente do tutor informado #${tutorId}.`
      );
    }

    // 3. Check for idempotent retry: if redemptions already exist for this booking
    const existingRedemptions = await tx
      .select()
      .from(crechePromotionalCampaignRedemptionsTable)
      .where(
        and(
          eq(crechePromotionalCampaignRedemptionsTable.crecheId, crecheId),
          eq(crechePromotionalCampaignRedemptionsTable.bookingId, bookingId)
        )
      );

    // If there are already active RESERVED redemptions for this booking, return existing summary
    const reservedRedemptions = existingRedemptions.filter((r: any) => r.status === "RESERVED");
    if (reservedRedemptions.length > 0) {
      return this.getBookingCommercialSummary(crecheId, bookingId, tx);
    }

    // 4. Assemble items to be commercially evaluated
    const itemsToEvaluate: Array<{
      lineType: "PRIMARY" | "BOOKING_SERVICE";
      catalogueItemId: number;
      bookingServiceId: number | null;
      quantity: number;
    }> = [];

    if (primaryCatalogueItemId != null && primaryCatalogueItemId > 0) {
      itemsToEvaluate.push({
        lineType: "PRIMARY",
        catalogueItemId: primaryCatalogueItemId,
        bookingServiceId: null,
        quantity: 1,
      });
    }

    for (const addon of additionalServiceItems) {
      itemsToEvaluate.push({
        lineType: "BOOKING_SERVICE",
        catalogueItemId: addon.catalogueItemId,
        bookingServiceId: addon.bookingServiceId,
        quantity: Math.max(1, addon.quantity ?? 1),
      });
    }

    if (itemsToEvaluate.length === 0) {
      return {
        bookingId,
        hasReservedCampaign: false,
        totalDiscountCents: 0,
        totalDiscount: "0.00",
        items: [],
        redemptions: [],
      };
    }

    // 5. Track campaigns assigned within this booking (Contract 14 & 22)
    // If a campaign is already assigned to this booking by an earlier item,
    // subsequent items join the SAME redemption without requiring extra tutor capacity!
    const assignedCampaignsInBooking = new Set<number>();
    const winningEvaluations: Array<{
      item: (typeof itemsToEvaluate)[number];
      winner: {
        pricingSource: "CATALOG" | "TUTOR_CONDITION" | "CAMPAIGN";
        campaign: CrechePromotionalCampaign | null;
        conditionId: number | null;
        baseUnitPriceCents: number;
        effectiveUnitPriceCents: number;
        unitDiscountCents: number;
        quantity: number;
        baseLineTotalCents: number;
        discountLineTotalCents: number;
        finalLineTotalCents: number;
        explanation: string;
      };
    }> = [];

    for (const item of itemsToEvaluate) {
      // Resolve base price and tutor condition pricing snapshot (R37.B contract)
      const r37bSnapshot = await TutorCommercialPricingService.resolveItemPriceForTutor(
        crecheId,
        tutorId,
        item.catalogueItemId,
        { petSize, tx, atTime }
      );

      const basePriceCents = decimalStringToCents(r37bSnapshot.baseUnitPrice);
      const conditionEffectiveCents = decimalStringToCents(r37bSnapshot.effectiveUnitPrice);
      const conditionDiscountCents = decimalStringToCents(r37bSnapshot.unitDiscount);

      const tutorCondition =
        r37bSnapshot.appliedConditionId != null
          ? {
              conditionId: r37bSnapshot.appliedConditionId,
              effectiveUnitPriceCents: conditionEffectiveCents,
              unitDiscountCents: conditionDiscountCents,
            }
          : null;

      // Fetch eligible campaigns targeting this item
      const candidateCampaigns = await CrecheCampaignService.resolveEligibleCampaignsForTutor(
        crecheId,
        tutorId,
        item.catalogueItemId,
        basePriceCents,
        atTime,
        tx
      );

      // Filter candidate campaigns based on tutor usage capacity
      const candidatesWithCapacity: typeof candidateCampaigns = [];
      for (const candidate of candidateCampaigns) {
        // If this campaign is already participating in this booking, capacity is already accounted for
        if (assignedCampaignsInBooking.has(candidate.campaign.id)) {
          candidatesWithCapacity.push(candidate);
          continue;
        }

        const hasCapacity = await this.hasTutorCapacity(
          tx,
          candidate.campaign,
          crecheId,
          tutorId,
          bookingId
        );

        if (hasCapacity) {
          candidatesWithCapacity.push(candidate);
        }
      }

      // Run deterministic precedence resolution
      const preview = resolveCommercialPreview({
        baseUnitPriceCents: basePriceCents,
        quantity: item.quantity,
        tutorCondition,
        eligibleCampaigns: candidatesWithCapacity,
      });

      if (preview.pricingSourceType === "CAMPAIGN" && preview.appliedCampaignId != null) {
        const winningCandidate = candidatesWithCapacity.find(
          (c) => c.campaign.id === preview.appliedCampaignId
        )!;

        // Fail-closed defense-in-depth: fixed promotional price cannot exceed resolved base price
        if (preview.effectiveUnitPriceCents > basePriceCents) {
          throw new CrecheCampaignConflictError(
            `Invariante violada: preço promocional (${preview.effectiveUnitPriceCents}) superior ao preço base (${basePriceCents}).`
          );
        }

        assignedCampaignsInBooking.add(winningCandidate.campaign.id);

        winningEvaluations.push({
          item,
          winner: {
            pricingSource: "CAMPAIGN",
            campaign: winningCandidate.campaign,
            conditionId: null,
            baseUnitPriceCents: basePriceCents,
            effectiveUnitPriceCents: preview.effectiveUnitPriceCents,
            unitDiscountCents: preview.unitDiscountCents,
            quantity: item.quantity,
            baseLineTotalCents: preview.baseUnitPriceCents * item.quantity,
            discountLineTotalCents: preview.unitDiscountCents * item.quantity,
            finalLineTotalCents: preview.finalLineTotalCents,
            explanation: preview.precedenceExplanation,
          },
        });
      } else if (preview.pricingSourceType === "TUTOR_CONDITION") {
        winningEvaluations.push({
          item,
          winner: {
            pricingSource: "TUTOR_CONDITION",
            campaign: null,
            conditionId: preview.appliedConditionId,
            baseUnitPriceCents: basePriceCents,
            effectiveUnitPriceCents: preview.effectiveUnitPriceCents,
            unitDiscountCents: preview.unitDiscountCents,
            quantity: item.quantity,
            baseLineTotalCents: preview.baseUnitPriceCents * item.quantity,
            discountLineTotalCents: preview.unitDiscountCents * item.quantity,
            finalLineTotalCents: preview.finalLineTotalCents,
            explanation: preview.precedenceExplanation,
          },
        });
      } else {
        winningEvaluations.push({
          item,
          winner: {
            pricingSource: "CATALOG",
            campaign: null,
            conditionId: null,
            baseUnitPriceCents: basePriceCents,
            effectiveUnitPriceCents: basePriceCents,
            unitDiscountCents: 0,
            quantity: item.quantity,
            baseLineTotalCents: basePriceCents * item.quantity,
            discountLineTotalCents: 0,
            finalLineTotalCents: basePriceCents * item.quantity,
            explanation: preview.precedenceExplanation,
          },
        });
      }
    }

    // 6. Group items where campaign won by campaignId (Contract 14: 1 redemption per campaign per booking)
    const campaignItemsMap = new Map<
      number,
      Array<{
        item: (typeof itemsToEvaluate)[number];
        winner: (typeof winningEvaluations)[number]["winner"];
      }>
    >();

    for (const ev of winningEvaluations) {
      if (ev.winner.pricingSource === "CAMPAIGN" && ev.winner.campaign != null) {
        const campId = ev.winner.campaign.id;
        const arr = campaignItemsMap.get(campId) ?? [];
        arr.push(ev);
        campaignItemsMap.set(campId, arr);
      }
    }

    // 7. Persist redemptions and redemption items
    const now = atTime;
    const actorId = actor?.userId ?? (booking.tutorId || 1);
    const actorRole = actor?.role ?? "tutor";

    for (const [campaignId, evaluatedItems] of campaignItemsMap.entries()) {
      const campaign = evaluatedItems[0].winner.campaign!;

      // Frozen campaign snapshot (Contract 8 & 17)
      const campaignSnapshot = {
        campaignId: campaign.id,
        campaignName: campaign.name,
        benefitType: campaign.benefitType,
        percentageBps: campaign.percentageBps,
        fixedDiscountCents: campaign.fixedDiscountCents,
        fixedPromotionalPriceCents: campaign.fixedPromotionalPriceCents,
        conditionInteractionPolicy: campaign.conditionInteractionPolicy,
        usageLimitType: campaign.usageLimitType,
        usageLimitPerTutor: campaign.usageLimitPerTutor,
        priority: campaign.priority,
        validFrom: campaign.validFrom,
        validUntil: campaign.validUntil,
        reservedAt: now.toISOString(),
        pricingDecisionExplanation: `Promessa comercial promocional reservada com sucesso para o booking #${bookingId}.`,
      };

      // Insert redemption header (Contract 1: bookingId FK on delete restrict)
      const [redemption] = await tx
        .insert(crechePromotionalCampaignRedemptionsTable)
        .values({
          crecheId,
          campaignId,
          tutorId,
          bookingId,
          contextType: "BOOKING",
          status: "RESERVED",
          reservedAt: now,
          campaignSnapshot,
        })
        .returning();

      // Insert redemption items (Contract 2: lineType PRIMARY vs BOOKING_SERVICE)
      for (const ev of evaluatedItems) {
        const itemSnapshot = {
          catalogueItemId: ev.item.catalogueItemId,
          lineType: ev.item.lineType,
          bookingServiceId: ev.item.bookingServiceId,
          baseUnitPriceCents: ev.winner.baseUnitPriceCents,
          effectiveUnitPriceCents: ev.winner.effectiveUnitPriceCents,
          unitDiscountCents: ev.winner.unitDiscountCents,
          quantity: ev.item.quantity,
          baseLineTotalCents: ev.winner.baseLineTotalCents,
          discountLineTotalCents: ev.winner.discountLineTotalCents,
          finalLineTotalCents: ev.winner.finalLineTotalCents,
          campaignId: campaign.id,
          campaignName: campaign.name,
        };

        await tx.insert(crechePromotionalCampaignRedemptionItemsTable).values({
          redemptionId: redemption.id,
          catalogueItemId: ev.item.catalogueItemId,
          lineType: ev.item.lineType,
          bookingServiceId: ev.item.bookingServiceId,
          baseUnitPriceCents: ev.winner.baseUnitPriceCents,
          effectiveUnitPriceCents: ev.winner.effectiveUnitPriceCents,
          unitDiscountCents: ev.winner.unitDiscountCents,
          quantity: ev.item.quantity,
          baseLineTotalCents: ev.winner.baseLineTotalCents,
          discountLineTotalCents: ev.winner.discountLineTotalCents,
          finalLineTotalCents: ev.winner.finalLineTotalCents,
          campaignSnapshot: itemSnapshot,
        });
      }

      // Audit: CAMPAIGN_REDEMPTION_RESERVED
      await tx.insert(crechePromotionalCampaignAuditsTable).values({
        crecheId,
        campaignId,
        action: "CAMPAIGN_REDEMPTION_RESERVED",
        actorUserId: actorId,
        actorRole,
        reason: `Reserva promocional registrada para o booking #${bookingId}`,
        beforeState: null,
        afterState: {
          redemptionId: redemption.id,
          bookingId,
          tutorId,
          itemsCount: evaluatedItems.length,
          status: "RESERVED",
        },
        requestId: actor?.requestId,
      });
    }

    // 8. Return canonical commercial summary
    return this.getBookingCommercialSummary(crecheId, bookingId, tx);
  }

  /**
   * Releases all reserved campaign redemptions for a booking (Contract 6, 10, 20).
   * Triggered when booking transitions to 'cancelled'.
   * RESERVED -> RELEASED with releasedAt and releaseReason.
   * NEVER deletes rows.
   */
  static async releaseBookingCampaigns(
    tx: any,
    crecheId: number,
    bookingId: number,
    releaseReason: string = "booking_cancelled",
    actor?: { userId: number; role: string; requestId?: string }
  ): Promise<CrechePromotionalCampaignRedemption[]> {
    // Acquire tutor lock
    const [booking] = await tx
      .select({ tutorId: bookingsTable.tutorId })
      .from(bookingsTable)
      .where(and(eq(bookingsTable.id, bookingId), eq(bookingsTable.crecheId, crecheId)))
      .limit(1);

    if (booking) {
      await this.acquireTutorCampaignLock(tx, crecheId, booking.tutorId);
    }

    const reservedRedemptions = await tx
      .select()
      .from(crechePromotionalCampaignRedemptionsTable)
      .where(
        and(
          eq(crechePromotionalCampaignRedemptionsTable.crecheId, crecheId),
          eq(crechePromotionalCampaignRedemptionsTable.bookingId, bookingId),
          eq(crechePromotionalCampaignRedemptionsTable.status, "RESERVED")
        )
      );

    if (reservedRedemptions.length === 0) {
      return [];
    }

    const now = new Date();
    const actorId = actor?.userId ?? (booking?.tutorId || 1);
    const actorRole = actor?.role ?? "system";

    const releasedList: CrechePromotionalCampaignRedemption[] = [];

    for (const r of reservedRedemptions) {
      const [updated] = await tx
        .update(crechePromotionalCampaignRedemptionsTable)
        .set({
          status: "RELEASED",
          releasedAt: now,
          releaseReason,
          updatedAt: now,
        })
        .where(eq(crechePromotionalCampaignRedemptionsTable.id, r.id))
        .returning();

      releasedList.push(updated);

      await tx.insert(crechePromotionalCampaignAuditsTable).values({
        crecheId,
        campaignId: r.campaignId,
        action: "CAMPAIGN_REDEMPTION_RELEASED",
        actorUserId: actorId,
        actorRole,
        reason: `Reserva promocional liberada: ${releaseReason}`,
        beforeState: r,
        afterState: updated,
        requestId: actor?.requestId,
      });
    }

    return releasedList;
  }

  /**
   * Reconciles booking modification while preserving owned capacity (Contract 7, 11, 23).
   * If items are removed from the booking:
   * - Deletes redemption items that no longer exist.
   * - If a redemption becomes completely empty, transitions it to RELEASED (Contract 11).
   */
  static async reconcileBookingModification(
    tx: any,
    crecheId: number,
    bookingId: number,
    remainingBookingServiceIds: number[],
    actor?: { userId: number; role: string; requestId?: string }
  ): Promise<void> {
    const [booking] = await tx
      .select({ tutorId: bookingsTable.tutorId })
      .from(bookingsTable)
      .where(and(eq(bookingsTable.id, bookingId), eq(bookingsTable.crecheId, crecheId)))
      .limit(1);

    if (!booking) return;

    await this.acquireTutorCampaignLock(tx, crecheId, booking.tutorId);

    const redemptions = await tx
      .select()
      .from(crechePromotionalCampaignRedemptionsTable)
      .where(
        and(
          eq(crechePromotionalCampaignRedemptionsTable.crecheId, crecheId),
          eq(crechePromotionalCampaignRedemptionsTable.bookingId, bookingId),
          eq(crechePromotionalCampaignRedemptionsTable.status, "RESERVED")
        )
      );

    if (redemptions.length === 0) return;

    const remainingSet = new Set(remainingBookingServiceIds);

    for (const r of redemptions) {
      const items = await tx
        .select()
        .from(crechePromotionalCampaignRedemptionItemsTable)
        .where(eq(crechePromotionalCampaignRedemptionItemsTable.redemptionId, r.id));

      for (const item of items) {
        if (
          item.lineType === "BOOKING_SERVICE" &&
          item.bookingServiceId != null &&
          !remainingSet.has(item.bookingServiceId)
        ) {
          await tx
            .delete(crechePromotionalCampaignRedemptionItemsTable)
            .where(eq(crechePromotionalCampaignRedemptionItemsTable.id, item.id));
        }
      }

      // Check if any items remain in this redemption
      const [countRow] = await tx
        .select({ remainingCount: sql<number>`count(*)::int` })
        .from(crechePromotionalCampaignRedemptionItemsTable)
        .where(eq(crechePromotionalCampaignRedemptionItemsTable.redemptionId, r.id));

      if (Number(countRow?.remainingCount ?? 0) === 0) {
        // Empty redemption: transition RESERVED -> RELEASED (Contract 11)
        const now = new Date();
        const [updated] = await tx
          .update(crechePromotionalCampaignRedemptionsTable)
          .set({
            status: "RELEASED",
            releasedAt: now,
            releaseReason: "all_items_removed",
            updatedAt: now,
          })
          .where(eq(crechePromotionalCampaignRedemptionsTable.id, r.id))
          .returning();

        await tx.insert(crechePromotionalCampaignAuditsTable).values({
          crecheId,
          campaignId: r.campaignId,
          action: "CAMPAIGN_REDEMPTION_RELEASED",
          actorUserId: actor?.userId ?? (booking.tutorId || 1),
          actorRole: actor?.role ?? "system",
          reason: "Reserva promocional liberada: todos os itens foram removidos do agendamento",
          beforeState: r,
          afterState: updated,
          requestId: actor?.requestId,
        });
      }
    }
  }

  /**
   * Retrieves sanitized commercial summary for a booking.
   * Returns authoritative pricing numbers without exposing administrative audit or internals (Contract 31).
   */
  static async getBookingCommercialSummary(
    crecheId: number,
    bookingId: number,
    client: any = db
  ): Promise<BookingCommercialReservationSummary> {
    const redemptions = await client
      .select({
        redemption: crechePromotionalCampaignRedemptionsTable,
        campaignName: crechePromotionalCampaignsTable.name,
      })
      .from(crechePromotionalCampaignRedemptionsTable)
      .innerJoin(
        crechePromotionalCampaignsTable,
        eq(crechePromotionalCampaignRedemptionsTable.campaignId, crechePromotionalCampaignsTable.id)
      )
      .where(
        and(
          eq(crechePromotionalCampaignRedemptionsTable.crecheId, crecheId),
          eq(crechePromotionalCampaignRedemptionsTable.bookingId, bookingId),
          eq(crechePromotionalCampaignRedemptionsTable.status, "RESERVED")
        )
      );

    if (redemptions.length === 0) {
      return {
        bookingId,
        hasReservedCampaign: false,
        totalDiscountCents: 0,
        totalDiscount: "0.00",
        items: [],
        redemptions: [],
      };
    }

    const redemptionIds = redemptions.map((r: any) => r.redemption.id);
    const rawItems = await client
      .select()
      .from(crechePromotionalCampaignRedemptionItemsTable)
      .where(inArray(crechePromotionalCampaignRedemptionItemsTable.redemptionId, redemptionIds));

    const redemptionMap = new Map<number, any>(
      redemptions.map((r: any) => [r.redemption.id, r])
    );

    let totalDiscountCents = 0;
    const items: ReservedCampaignItemSummary[] = rawItems.map((item: any) => {
      const parent = redemptionMap.get(item.redemptionId);
      totalDiscountCents += item.discountLineTotalCents;

      return {
        catalogueItemId: item.catalogueItemId,
        lineType: item.lineType,
        bookingServiceId: item.bookingServiceId,
        pricingSource: "CAMPAIGN",
        campaignId: parent?.redemption?.campaignId ?? null,
        campaignName: parent?.campaignName ?? null,
        baseUnitPriceCents: item.baseUnitPriceCents,
        effectiveUnitPriceCents: item.effectiveUnitPriceCents,
        unitDiscountCents: item.unitDiscountCents,
        baseUnitPrice: centsToDecimalString(item.baseUnitPriceCents),
        effectiveUnitPrice: centsToDecimalString(item.effectiveUnitPriceCents),
        unitDiscount: centsToDecimalString(item.unitDiscountCents),
        quantity: item.quantity,
        baseLineTotalCents: item.baseLineTotalCents,
        discountLineTotalCents: item.discountLineTotalCents,
        finalLineTotalCents: item.finalLineTotalCents,
        baseLineTotal: centsToDecimalString(item.baseLineTotalCents),
        discountLineTotal: centsToDecimalString(item.discountLineTotalCents),
        finalLineTotal: centsToDecimalString(item.finalLineTotalCents),
        reservationStatus: "RESERVED",
      };
    });

    const formattedRedemptions = redemptions.map((r: any) => ({
      redemptionId: r.redemption.id,
      campaignId: r.redemption.campaignId,
      campaignName: r.campaignName,
      status: "RESERVED" as const,
      reservedAt: new Date(r.redemption.reservedAt).toISOString(),
      itemsCount: rawItems.filter((i: any) => i.redemptionId === r.redemption.id).length,
    }));

    return {
      bookingId,
      hasReservedCampaign: true,
      totalDiscountCents,
      totalDiscount: centsToDecimalString(totalDiscountCents),
      items,
      redemptions: formattedRedemptions,
    };
  }
}
