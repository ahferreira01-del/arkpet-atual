import { db } from "@workspace/db";
import { catalogueItemsTable } from "@workspace/db/schema";
import { eq, and, sql, asc } from "drizzle-orm";
import {
  TutorCommercialPricingService,
  decimalStringToCents,
  centsToDecimalString,
} from "./tutorCommercialPricing.js";
import { CrecheCampaignService } from "./crecheCampaign.service.js";
import { CrecheCampaignReservationService } from "./crecheCampaignReservation.service.js";
import { resolveCommercialPreview } from "./crecheCampaignPricing.js";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface TutorCommercialOffer {
  catalogueItemId: number;
  catalogueItemName: string;
  itemType: string;
  pricingSourceType: "TUTOR_CONDITION" | "CAMPAIGN";
  basePrice: string;
  effectivePrice: string;
  discountAmount: string;
  discountPercentage: number;
  campaignId?: number | null;
  campaignName?: string | null;
  validUntil?: string | null;
  statusForTutor: "ELIGIBLE";
  statusLabel: string;
  isComplimentaryZeroValue: boolean;
  explanation: string;
}

export interface TutorCommercialOffersResponse {
  tutorId: number;
  crecheId: number;
  offers: TutorCommercialOffer[];
  evaluatedAt: string;
}

// ─── Service Class ────────────────────────────────────────────────────────────

export class TutorCommercialExperienceService {
  /**
   * Resolves sanitized commercial offers and eligible promotional benefits for a tutor.
   * - Authoritative pricing only (no client-side math).
   * - Does NOT reserve or create redemptions.
   * - Status is strictly 'ELIGIBLE' ("Oferta disponível").
   * - Zero leak of administrative audit trails, priority, or other tutors' data.
   */
  static async getTutorCommercialOffers(
    crecheId: number,
    tutorId: number,
    options?: { atTime?: Date; client?: any }
  ): Promise<TutorCommercialOffersResponse> {
    const client = options?.client || db;
    const atTime = options?.atTime || new Date();

    // 1. Fetch active service and day_use items of the creche
    const catalogueItems = await client
      .select()
      .from(catalogueItemsTable)
      .where(
        and(
          eq(catalogueItemsTable.crecheId, crecheId),
          sql`${catalogueItemsTable.type} IN ('service', 'day_use')`
        )
      )
      .orderBy(asc(catalogueItemsTable.name));

    const offers: TutorCommercialOffer[] = [];

    for (const item of catalogueItems) {
      // Resolve tutor condition pricing snapshot (R37.B)
      const r37bSnapshot = await TutorCommercialPricingService.resolveItemPriceForTutor(
        crecheId,
        tutorId,
        item.id,
        { atTime, tx: client }
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

      // Fetch eligible campaigns targeting this item (R37.C1)
      const candidateCampaigns = await CrecheCampaignService.resolveEligibleCampaignsForTutor(
        crecheId,
        tutorId,
        item.id,
        basePriceCents,
        atTime,
        client
      );

      // Filter campaigns by tutor remaining capacity
      const candidatesWithCapacity: typeof candidateCampaigns = [];
      for (const candidate of candidateCampaigns) {
        const hasCapacity = await CrecheCampaignReservationService.hasTutorCapacity(
          client,
          candidate.campaign,
          crecheId,
          tutorId
        );
        if (hasCapacity) {
          candidatesWithCapacity.push(candidate);
        }
      }

      // Run pure deterministic composition
      const preview = resolveCommercialPreview({
        baseUnitPriceCents: basePriceCents,
        tutorCondition,
        eligibleCampaigns: candidatesWithCapacity,
      });

      // Only present items with actual promotional/special commercial benefit
      if (preview.pricingSourceType === "CAMPAIGN" && preview.appliedCampaignId != null) {
        const winningCandidate = candidatesWithCapacity.find(
          (c) => c.campaign.id === preview.appliedCampaignId
        )!;

        const isComplimentaryZeroValue = preview.effectiveUnitPriceCents === 0;
        const discountPct = basePriceCents > 0
          ? Math.round((preview.unitDiscountCents / basePriceCents) * 100)
          : 0;

        const explanation = isComplimentaryZeroValue
          ? "Cortesia promocional (100% de desconto)"
          : `Campanha "${winningCandidate.campaign.name}" disponível`;

        offers.push({
          catalogueItemId: item.id,
          catalogueItemName: item.name,
          itemType: item.type,
          pricingSourceType: "CAMPAIGN",
          basePrice: centsToDecimalString(basePriceCents),
          effectivePrice: centsToDecimalString(preview.effectiveUnitPriceCents),
          discountAmount: centsToDecimalString(preview.unitDiscountCents),
          discountPercentage: discountPct,
          campaignId: winningCandidate.campaign.id,
          campaignName: winningCandidate.campaign.name,
          validUntil: winningCandidate.campaign.validUntil
            ? new Date(winningCandidate.campaign.validUntil).toISOString()
            : null,
          statusForTutor: "ELIGIBLE",
          statusLabel: isComplimentaryZeroValue
            ? "Cortesia promocional (100% OFF)"
            : "Oferta disponível",
          isComplimentaryZeroValue,
          explanation,
        });
      } else if (preview.pricingSourceType === "TUTOR_CONDITION" && preview.appliedConditionId != null) {
        const isComplimentaryZeroValue = preview.effectiveUnitPriceCents === 0;
        const discountPct = basePriceCents > 0
          ? Math.round((preview.unitDiscountCents / basePriceCents) * 100)
          : 0;

        offers.push({
          catalogueItemId: item.id,
          catalogueItemName: item.name,
          itemType: item.type,
          pricingSourceType: "TUTOR_CONDITION",
          basePrice: centsToDecimalString(basePriceCents),
          effectivePrice: centsToDecimalString(preview.effectiveUnitPriceCents),
          discountAmount: centsToDecimalString(preview.unitDiscountCents),
          discountPercentage: discountPct,
          campaignId: null,
          campaignName: null,
          validUntil: null,
          statusForTutor: "ELIGIBLE",
          statusLabel: "Preço especial",
          isComplimentaryZeroValue,
          explanation: isComplimentaryZeroValue
            ? "Cortesia promocional (100% de desconto)"
            : "Condição comercial especial aplicada",
        });
      }
    }

    return {
      tutorId,
      crecheId,
      offers,
      evaluatedAt: atTime.toISOString(),
    };
  }
}
