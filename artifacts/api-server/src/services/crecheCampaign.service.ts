import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  crechePromotionalCampaignsTable,
  crechePromotionalCampaignItemsTable,
  crechePromotionalCampaignTutorsTable,
  crechePromotionalCampaignAuditsTable,
  crechePromotionalCampaignOperationsTable,
  catalogueItemsTable,
  usersTable,
  type CrechePromotionalCampaign,
  type CampaignBenefitType,
  type CampaignStatus,
  type CampaignAudienceType,
  type CampaignInteractionPolicy,
  type CampaignUsageLimitType,
  type CampaignAuditAction,
} from "@workspace/db/schema";
import { eq, and, or, sql, desc, asc, inArray, count } from "drizzle-orm";
import {
  CrecheCampaignError,
  CrecheCampaignValidationError,
  CrecheCampaignNotFoundError,
  CrecheCampaignConflictError,
  CrecheCampaignForbiddenError,
  assertCanManageCampaign,
  validateItemPricesForFixedPromotionalPrice,
  calculateCampaignPrice,
  isCampaignActive,
  type CampaignBenefitInput,
  type CampaignPricingResult,
  type CatalogueItemSalePrices,
} from "./crecheCampaignPricing.js";
import { getBusinessDate } from "../lib/date.js";

// ─── Input Types ──────────────────────────────────────────────────────────────

export interface ActorContext {
  userId: number;
  role: string;
  source?: "http" | "internal";
  requestId?: string;
}

export interface CreateCampaignInput {
  name: string;
  description?: string | null;
  benefitType: CampaignBenefitType;
  percentageBps?: number | null;
  fixedDiscountCents?: number | null;
  fixedPromotionalPriceCents?: number | null;
  audienceType: CampaignAudienceType;
  selectedTutorIds?: number[];
  itemIds: number[];
  conditionInteractionPolicy?: CampaignInteractionPolicy;
  usageLimitType?: CampaignUsageLimitType;
  usageLimitPerTutor?: number | null;
  priority?: number;
  validFrom: string | Date;
  validUntil: string | Date;
  reason?: string;
  auditAction?: string;
  auditAfterState?: any;
}

export interface UpdateDraftCampaignInput {
  name?: string;
  description?: string | null;
  benefitType?: CampaignBenefitType;
  percentageBps?: number | null;
  fixedDiscountCents?: number | null;
  fixedPromotionalPriceCents?: number | null;
  audienceType?: CampaignAudienceType;
  selectedTutorIds?: number[];
  itemIds?: number[];
  conditionInteractionPolicy?: CampaignInteractionPolicy;
  usageLimitType?: CampaignUsageLimitType;
  usageLimitPerTutor?: number | null;
  priority?: number;
  validFrom?: string | Date;
  validUntil?: string | Date;
  reason?: string;
}

export interface CampaignSummaryKPIs {
  total: number;
  active: number;
  scheduled: number;
  paused: number;
  ended: number;
  revoked: number;
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

function hashPayload(payload: any): string {
  const normalized = JSON.stringify(payload ?? {}, Object.keys(payload ?? {}).sort());
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export class CrecheCampaignService {
  /**
   * Validates items:
   * 1. Must belong to the same creche
   * 2. itemType must be 'service' or 'day_use' (rejects 'product' and 'package' in C1)
   * 3. If fixed promotional price, price cannot exceed any item variant price
   */
  private static async validateItems(
    tx: any,
    crecheId: number,
    itemIds: number[],
    benefit: CampaignBenefitInput
  ): Promise<CatalogueItemSalePrices[]> {
    if (!itemIds || itemIds.length === 0) {
      throw new CrecheCampaignValidationError("A campanha deve conter pelo menos um item do catálogo.");
    }

    const uniqueIds = Array.from(new Set(itemIds));
    const rawItems = await tx
      .select()
      .from(catalogueItemsTable)
      .where(
        and(
          eq(catalogueItemsTable.crecheId, crecheId),
          inArray(catalogueItemsTable.id, uniqueIds)
        )
      );

    if (rawItems.length !== uniqueIds.length) {
      throw new CrecheCampaignValidationError(
        "Um ou mais itens informados não foram encontrados nesta creche (violação multi-tenant ou ID inexistente)."
      );
    }

    const items: CatalogueItemSalePrices[] = [];

    // Check allowed item types for C1
    for (const item of rawItems) {
      const type = item.type || "product";
      if (type !== "service" && type !== "day_use") {
        throw new CrecheCampaignValidationError(
          `O item "${item.name}" é do tipo "${type}". Na fase R37.C1, apenas serviços e day_use são elegíveis para campanhas promocionais.`
        );
      }
      items.push({
        id: item.id,
        name: item.name,
        itemType: type,
        crecheId: item.crecheId,
        basePrice: item.basePrice,
        priceSmall: item.priceSmall,
        priceMedium: item.priceMedium,
        priceLarge: item.priceLarge,
      });
    }

    // If fixed promotional price, validate against all variant prices
    if (benefit.benefitType === "FIXED_PROMOTIONAL_PRICE" && benefit.fixedPromotionalPriceCents != null) {
      for (const item of items) {
        validateItemPricesForFixedPromotionalPrice(item, benefit.fixedPromotionalPriceCents);
      }
    }

    return items;
  }

  /**
   * Validates selected tutors:
   * 1. Must belong to the same creche
   * 2. role must be 'tutor'
   * 3. isActive must be true
   */
  private static async validateTutors(
    tx: any,
    crecheId: number,
    tutorIds: number[]
  ): Promise<number[]> {
    if (!tutorIds || tutorIds.length === 0) {
      throw new CrecheCampaignValidationError(
        "Para público 'SELECTED_TUTORS', é obrigatório selecionar pelo menos um tutor."
      );
    }

    const uniqueIds = Array.from(new Set(tutorIds));
    const tutors = await tx
      .select({ id: usersTable.id, role: usersTable.role, isActive: usersTable.isActive, crecheId: usersTable.crecheId })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.crecheId, crecheId),
          inArray(usersTable.id, uniqueIds)
        )
      );

    if (tutors.length !== uniqueIds.length) {
      throw new CrecheCampaignValidationError(
        "Um ou mais tutores informados não foram encontrados nesta creche (violação multi-tenant ou ID inexistente)."
      );
    }

    for (const t of tutors) {
      if (t.role !== "tutor") {
        throw new CrecheCampaignValidationError(`O usuário #${t.id} não possui perfil de tutor.`);
      }
      if (!t.isActive) {
        throw new CrecheCampaignValidationError(`O tutor #${t.id} está inativo.`);
      }
    }

    return uniqueIds;
  }

  /**
   * Idempotency check & lock: executes operation with ledger protection.
   */
  private static async executeWithIdempotency<T>(
    crecheId: number,
    idempotencyKey: string | undefined,
    operationType: string,
    payload: any,
    campaignIdForOp: number | null,
    operationFn: (tx: any) => Promise<{ result: T; campaignId: number }>
  ): Promise<T> {
    if (!idempotencyKey) {
      return db.transaction(async (tx) => {
        const { result } = await operationFn(tx);
        return result;
      });
    }

    const payloadHash = hashPayload(payload);

    const executeTransaction = async (): Promise<T> => {
      return db.transaction(async (tx) => {
        // Check existing operation
        const [existing] = await tx
          .select()
          .from(crechePromotionalCampaignOperationsTable)
          .where(
            and(
              eq(crechePromotionalCampaignOperationsTable.crecheId, crecheId),
              eq(crechePromotionalCampaignOperationsTable.idempotencyKey, idempotencyKey)
            )
          )
          .limit(1);

        if (existing) {
          if (existing.operationType !== operationType) {
            throw new CrecheCampaignConflictError(
              `Chave de idempotência reutilizada para operação incompatível: esperava ${existing.operationType}, recebeu ${operationType}.`
            );
          }
          if (existing.payloadHash !== payloadHash) {
            throw new CrecheCampaignConflictError(
              "Chave de idempotência reutilizada com payload divergente."
            );
          }
          if (existing.status === "SUCCEEDED" && existing.responseJson) {
            return existing.responseJson as T;
          }
          if (existing.status === "IN_PROGRESS") {
            throw new CrecheCampaignConflictError(
              "Operação concorrente com a mesma chave de idempotência já está em processamento."
            );
          }
        }

        // Reserve operation in IN_PROGRESS state
        let opId: number;
        if (!existing) {
          const [insertedOp] = await tx
            .insert(crechePromotionalCampaignOperationsTable)
            .values({
              crecheId,
              campaignId: campaignIdForOp,
              idempotencyKey,
              operationType,
              payloadHash,
              status: "IN_PROGRESS",
            })
            .returning();
          opId = insertedOp.id;
        } else {
          opId = existing.id;
        }

        try {
          const { result, campaignId } = await operationFn(tx);

          // Mark SUCCEEDED and link campaignId
          await tx
            .update(crechePromotionalCampaignOperationsTable)
            .set({
              status: "SUCCEEDED",
              campaignId,
              responseJson: result as any,
              updatedAt: new Date(),
            })
            .where(eq(crechePromotionalCampaignOperationsTable.id, opId));

          return result;
        } catch (err) {
          await tx
            .update(crechePromotionalCampaignOperationsTable)
            .set({
              status: "FAILED",
              updatedAt: new Date(),
            })
            .where(eq(crechePromotionalCampaignOperationsTable.id, opId));
          throw err;
        }
      });
    };

    try {
      return await executeTransaction();
    } catch (err: any) {
      const isUniqueCollision =
        err.code === "23505" ||
        err?.cause?.code === "23505" ||
        (typeof err.message === "string" &&
          (err.message.includes("creche_promotional_ops_creche_key_idx") ||
            err.message.includes("creche_promotional_campaign_operations")));

      if (isUniqueCollision) {
        // A concurrent transaction reserved the key simultaneously.
        // Poll briefly for the concurrent operation to reach terminal state.
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 100));
          const [resolvedOp] = await db
            .select()
            .from(crechePromotionalCampaignOperationsTable)
            .where(
              and(
                eq(crechePromotionalCampaignOperationsTable.crecheId, crecheId),
                eq(crechePromotionalCampaignOperationsTable.idempotencyKey, idempotencyKey)
              )
            )
            .limit(1);

          if (resolvedOp) {
            if (resolvedOp.payloadHash !== payloadHash) {
              throw new CrecheCampaignConflictError(
                "Chave de idempotência reutilizada com payload divergente."
              );
            }
            if (resolvedOp.status === "SUCCEEDED" && resolvedOp.responseJson) {
              return resolvedOp.responseJson as T;
            }
            if (resolvedOp.status === "FAILED") {
              throw new CrecheCampaignConflictError(
                "A operação concorrente falhou durante o processamento."
              );
            }
          }
        }

        throw new CrecheCampaignConflictError(
          "Operação concorrente com a mesma chave de idempotência já está em processamento."
        );
      }
      throw err;
    }
  }

  // ─── CRUD & Lifecycle Operations ───────────────────────────────────────────

  /**
   * Creates a draft campaign structurally complete (Adjustment 7).
   */
  static async createDraft(
    crecheId: number,
    actor: ActorContext,
    input: CreateCampaignInput,
    idempotencyKey?: string
  ): Promise<any> {
    assertCanManageCampaign(actor);

    if (!input.name || !input.name.trim()) {
      throw new CrecheCampaignValidationError("Nome da campanha é obrigatório.");
    }

    const validFrom = new Date(input.validFrom);
    const validUntil = new Date(input.validUntil);

    if (isNaN(validFrom.getTime()) || isNaN(validUntil.getTime())) {
      throw new CrecheCampaignValidationError("Datas de início e término inválidas.");
    }

    if (validUntil.getTime() <= validFrom.getTime()) {
      throw new CrecheCampaignValidationError("Data de término deve ser posterior à data de início.");
    }

    const benefit: CampaignBenefitInput = {
      benefitType: input.benefitType,
      percentageBps: input.percentageBps != null ? Number(input.percentageBps) : null,
      fixedDiscountCents: input.fixedDiscountCents != null ? Number(input.fixedDiscountCents) : null,
      fixedPromotionalPriceCents:
        input.fixedPromotionalPriceCents != null ? Number(input.fixedPromotionalPriceCents) : null,
    };

    const priority = input.priority != null ? Math.max(0, Number(input.priority)) : 100;
    const usageLimitType = input.usageLimitType || "UNLIMITED";
    const usageLimitPerTutor =
      usageLimitType === "N_PER_TUTOR" && input.usageLimitPerTutor != null
        ? Number(input.usageLimitPerTutor)
        : null;

    if (usageLimitType === "N_PER_TUTOR" && (!usageLimitPerTutor || usageLimitPerTutor <= 0)) {
      throw new CrecheCampaignValidationError("Limite por tutor deve ser maior que zero quando N_PER_TUTOR.");
    }

    return this.executeWithIdempotency(
      crecheId,
      idempotencyKey,
      "CREATE",
      input,
      null,
      async (tx) => {
        // Validate items and variant prices
        const items = await this.validateItems(tx, crecheId, input.itemIds, benefit);

        // Validate tutors if SELECTED_TUTORS
        let validTutorIds: number[] = [];
        if (input.audienceType === "SELECTED_TUTORS") {
          validTutorIds = await this.validateTutors(tx, crecheId, input.selectedTutorIds || []);
        }

        // Insert campaign in DRAFT status
        const [campaign] = await tx
          .insert(crechePromotionalCampaignsTable)
          .values({
            crecheId,
            name: input.name.trim(),
            description: input.description?.trim() || null,
            benefitType: benefit.benefitType,
            percentageBps: benefit.percentageBps,
            fixedDiscountCents: benefit.fixedDiscountCents,
            fixedPromotionalPriceCents: benefit.fixedPromotionalPriceCents,
            audienceType: input.audienceType,
            conditionInteractionPolicy: input.conditionInteractionPolicy || "EXCLUDE_IF_TUTOR_CONDITION",
            usageLimitType,
            usageLimitPerTutor,
            priority,
            validFrom,
            validUntil,
            status: "DRAFT",
            reason: input.reason?.trim() || "Criação de campanha",
            createdByUserId: actor.userId,
          })
          .returning();

        // Insert child items atomically
        for (const it of items) {
          await tx.insert(crechePromotionalCampaignItemsTable).values({
            campaignId: campaign.id,
            crecheId,
            catalogueItemId: it.id,
          });
        }

        // Insert child tutors atomically if SELECTED_TUTORS
        if (input.audienceType === "SELECTED_TUTORS") {
          for (const tutorId of validTutorIds) {
            await tx.insert(crechePromotionalCampaignTutorsTable).values({
              campaignId: campaign.id,
              crecheId,
              tutorId,
            });
          }
        }

        // Insert Audit
        await tx.insert(crechePromotionalCampaignAuditsTable).values({
          crecheId,
          campaignId: campaign.id,
          action: input.auditAction || "CAMPAIGN_CREATED",
          actorUserId: actor.userId,
          actorRole: actor.role,
          reason: input.reason?.trim() || "Criação de campanha",
          beforeState: null,
          afterState: input.auditAfterState || { ...campaign, itemIds: items.map((i: any) => i.id), tutorIds: validTutorIds },
          requestId: actor.requestId,
        });

        const fullCampaign = await this.getCampaignById(crecheId, campaign.id, tx);
        return { result: fullCampaign, campaignId: campaign.id };
      }
    );
  }

  /**
   * Updates a campaign in DRAFT (or SCHEDULED prior to validFrom).
   * Atomically replaces child collections (Adjustment 4).
   */
  static async updateDraft(
    crecheId: number,
    campaignId: number,
    actor: ActorContext,
    input: UpdateDraftCampaignInput,
    idempotencyKey?: string
  ): Promise<any> {
    assertCanManageCampaign(actor);

    return this.executeWithIdempotency(
      crecheId,
      idempotencyKey,
      "UPDATE_DRAFT",
      { campaignId, ...input },
      campaignId,
      async (tx) => {
        // Lock and re-read campaign
        const [existing] = await tx
          .select()
          .from(crechePromotionalCampaignsTable)
          .where(
            and(
              eq(crechePromotionalCampaignsTable.crecheId, crecheId),
              eq(crechePromotionalCampaignsTable.id, campaignId)
            )
          )
          .for("update")
          .limit(1);

        if (!existing) {
          throw new CrecheCampaignNotFoundError(`Campanha #${campaignId} não encontrada.`);
        }

        if (existing.status !== "DRAFT" && existing.status !== "SCHEDULED") {
          throw new CrecheCampaignConflictError(
            `Campanhas no status ${existing.status} não podem ter seus dados alterados diretamente.`
          );
        }

        if (existing.status === "SCHEDULED" && new Date().getTime() >= new Date(existing.validFrom).getTime()) {
          throw new CrecheCampaignConflictError(
            "Campanha agendada já atingiu sua data de início e não pode ser editada diretamente."
          );
        }

        const validFrom = input.validFrom ? new Date(input.validFrom) : existing.validFrom;
        const validUntil = input.validUntil ? new Date(input.validUntil) : existing.validUntil;

        if (validUntil.getTime() <= validFrom.getTime()) {
          throw new CrecheCampaignValidationError("Data de término deve ser posterior à data de início.");
        }

        const benefitType = input.benefitType || existing.benefitType;
        const benefit: CampaignBenefitInput = {
          benefitType,
          percentageBps:
            benefitType === "PERCENTAGE_DISCOUNT"
              ? input.percentageBps != null
                ? Number(input.percentageBps)
                : existing.percentageBps
              : null,
          fixedDiscountCents:
            benefitType === "FIXED_DISCOUNT"
              ? input.fixedDiscountCents != null
                ? Number(input.fixedDiscountCents)
                : existing.fixedDiscountCents
              : null,
          fixedPromotionalPriceCents:
            benefitType === "FIXED_PROMOTIONAL_PRICE"
              ? input.fixedPromotionalPriceCents != null
                ? Number(input.fixedPromotionalPriceCents)
                : existing.fixedPromotionalPriceCents
              : null,
        };

        // Determine item IDs
        let targetItemIds = input.itemIds;
        if (!targetItemIds) {
          const currentItems = await tx
            .select()
            .from(crechePromotionalCampaignItemsTable)
            .where(eq(crechePromotionalCampaignItemsTable.campaignId, campaignId));
          targetItemIds = currentItems.map((i: any) => i.catalogueItemId);
        }

        const items = await this.validateItems(tx, crecheId, targetItemIds || [], benefit);

        const audienceType = input.audienceType || existing.audienceType;
        let validTutorIds: number[] = [];
        if (audienceType === "SELECTED_TUTORS") {
          if (input.selectedTutorIds) {
            validTutorIds = await this.validateTutors(tx, crecheId, input.selectedTutorIds || []);
          } else {
            const currentTutors = await tx
              .select()
              .from(crechePromotionalCampaignTutorsTable)
              .where(eq(crechePromotionalCampaignTutorsTable.campaignId, campaignId));
            validTutorIds = currentTutors.map((t: any) => t.tutorId);
            if (validTutorIds.length === 0) {
              throw new CrecheCampaignValidationError(
                "Para público 'SELECTED_TUTORS', é obrigatório selecionar pelo menos um tutor."
              );
            }
          }
        }

        const usageLimitType = input.usageLimitType || existing.usageLimitType;
        const usageLimitPerTutor =
          usageLimitType === "N_PER_TUTOR"
            ? input.usageLimitPerTutor != null
              ? Number(input.usageLimitPerTutor)
              : existing.usageLimitPerTutor
            : null;

        if (usageLimitType === "N_PER_TUTOR" && (!usageLimitPerTutor || usageLimitPerTutor <= 0)) {
          throw new CrecheCampaignValidationError("Limite por tutor deve ser maior que zero quando N_PER_TUTOR.");
        }

        const priority = input.priority != null ? Math.max(0, Number(input.priority)) : existing.priority;

        // Update campaign entity
        const [updatedCampaign] = await tx
          .update(crechePromotionalCampaignsTable)
          .set({
            name: input.name?.trim() || existing.name,
            description: input.description !== undefined ? input.description?.trim() || null : existing.description,
            benefitType: benefit.benefitType,
            percentageBps: benefit.percentageBps,
            fixedDiscountCents: benefit.fixedDiscountCents,
            fixedPromotionalPriceCents: benefit.fixedPromotionalPriceCents,
            audienceType,
            conditionInteractionPolicy: input.conditionInteractionPolicy || existing.conditionInteractionPolicy,
            usageLimitType,
            usageLimitPerTutor,
            priority,
            validFrom,
            validUntil,
            reason: input.reason?.trim() || existing.reason,
            updatedAt: new Date(),
          })
          .where(eq(crechePromotionalCampaignsTable.id, campaignId))
          .returning();

        // Atomically replace child items (Adjustment 4)
        await tx
          .delete(crechePromotionalCampaignItemsTable)
          .where(eq(crechePromotionalCampaignItemsTable.campaignId, campaignId));

        for (const it of items) {
          await tx.insert(crechePromotionalCampaignItemsTable).values({
            campaignId,
            crecheId,
            catalogueItemId: it.id,
          });
        }

        // Atomically replace child tutors (Adjustment 4)
        await tx
          .delete(crechePromotionalCampaignTutorsTable)
          .where(eq(crechePromotionalCampaignTutorsTable.campaignId, campaignId));

        if (audienceType === "SELECTED_TUTORS") {
          for (const tutorId of validTutorIds) {
            await tx.insert(crechePromotionalCampaignTutorsTable).values({
              campaignId,
              crecheId,
              tutorId,
            });
          }
        }

        // Audit
        await tx.insert(crechePromotionalCampaignAuditsTable).values({
          crecheId,
          campaignId,
          action: "CAMPAIGN_UPDATED_DRAFT",
          actorUserId: actor.userId,
          actorRole: actor.role,
          reason: input.reason?.trim() || "Atualização de rascunho de campanha",
          beforeState: existing,
          afterState: { ...updatedCampaign, itemIds: items.map((i: any) => i.id), tutorIds: validTutorIds },
          requestId: actor.requestId,
        });

        const fullCampaign = await this.getCampaignById(crecheId, campaignId, tx);
        return { result: fullCampaign, campaignId };
      }
    );
  }

  /**
   * Publishes a draft or scheduled campaign.
   * State transition serialized via row-level lock (Adjustment 5).
   */
  static async publish(
    crecheId: number,
    campaignId: number,
    actor: ActorContext,
    reason: string,
    idempotencyKey?: string
  ): Promise<any> {
    assertCanManageCampaign(actor);

    if (!reason || !reason.trim()) {
      throw new CrecheCampaignValidationError("Motivo administrativo da publicação é obrigatório.");
    }

    return this.executeWithIdempotency(
      crecheId,
      idempotencyKey,
      "PUBLISH",
      { campaignId, reason },
      campaignId,
      async (tx) => {
        // Row-level lock
        const [campaign] = await tx
          .select()
          .from(crechePromotionalCampaignsTable)
          .where(
            and(
              eq(crechePromotionalCampaignsTable.crecheId, crecheId),
              eq(crechePromotionalCampaignsTable.id, campaignId)
            )
          )
          .for("update")
          .limit(1);

        if (!campaign) {
          throw new CrecheCampaignNotFoundError(`Campanha #${campaignId} não encontrada.`);
        }

        if (campaign.status === "REVOKED") {
          throw new CrecheCampaignConflictError("Campanhas revogadas não podem ser publicadas.");
        }

        if (campaign.status === "ACTIVE") {
          // Already published and active
          const full = await this.getCampaignById(crecheId, campaignId, tx);
          return { result: full, campaignId };
        }

        const now = new Date();
        const validUntil = new Date(campaign.validUntil);
        const validFrom = new Date(campaign.validFrom);

        if (now.getTime() >= validUntil.getTime()) {
          throw new CrecheCampaignConflictError(
            "A campanha já atingiu ou ultrapassou sua data de término e não pode ser publicada."
          );
        }

        // Determine target status
        const nextStatus: CampaignStatus = now.getTime() >= validFrom.getTime() ? "ACTIVE" : "SCHEDULED";

        const [updated] = await tx
          .update(crechePromotionalCampaignsTable)
          .set({
            status: nextStatus,
            reason: reason.trim(),
            updatedAt: now,
          })
          .where(eq(crechePromotionalCampaignsTable.id, campaignId))
          .returning();

        // Audit
        await tx.insert(crechePromotionalCampaignAuditsTable).values({
          crecheId,
          campaignId,
          action: "CAMPAIGN_PUBLISHED",
          actorUserId: actor.userId,
          actorRole: actor.role,
          reason: reason.trim(),
          beforeState: campaign,
          afterState: updated,
          requestId: actor.requestId,
        });

        const full = await this.getCampaignById(crecheId, campaignId, tx);
        return { result: full, campaignId };
      }
    );
  }

  /**
   * Pauses an active campaign.
   */
  static async pause(
    crecheId: number,
    campaignId: number,
    actor: ActorContext,
    reason: string,
    idempotencyKey?: string
  ): Promise<any> {
    assertCanManageCampaign(actor);

    if (!reason || !reason.trim()) {
      throw new CrecheCampaignValidationError("Motivo administrativo para pausar a campanha é obrigatório.");
    }

    return this.executeWithIdempotency(
      crecheId,
      idempotencyKey,
      "PAUSE",
      { campaignId, reason },
      campaignId,
      async (tx) => {
        const [campaign] = await tx
          .select()
          .from(crechePromotionalCampaignsTable)
          .where(
            and(
              eq(crechePromotionalCampaignsTable.crecheId, crecheId),
              eq(crechePromotionalCampaignsTable.id, campaignId)
            )
          )
          .for("update")
          .limit(1);

        if (!campaign) {
          throw new CrecheCampaignNotFoundError(`Campanha #${campaignId} não encontrada.`);
        }

        if (campaign.status === "REVOKED") {
          throw new CrecheCampaignConflictError("Campanhas revogadas não podem ser pausadas.");
        }

        if (campaign.status === "PAUSED") {
          const full = await this.getCampaignById(crecheId, campaignId, tx);
          return { result: full, campaignId };
        }

        if (campaign.status !== "ACTIVE" && campaign.status !== "SCHEDULED") {
          throw new CrecheCampaignConflictError(
            `Apenas campanhas ATIVAS ou AGENDADAS podem ser pausadas (status atual: ${campaign.status}).`
          );
        }

        const [updated] = await tx
          .update(crechePromotionalCampaignsTable)
          .set({
            status: "PAUSED",
            reason: reason.trim(),
            updatedAt: new Date(),
          })
          .where(eq(crechePromotionalCampaignsTable.id, campaignId))
          .returning();

        await tx.insert(crechePromotionalCampaignAuditsTable).values({
          crecheId,
          campaignId,
          action: "CAMPAIGN_PAUSED",
          actorUserId: actor.userId,
          actorRole: actor.role,
          reason: reason.trim(),
          beforeState: campaign,
          afterState: updated,
          requestId: actor.requestId,
        });

        const full = await this.getCampaignById(crecheId, campaignId, tx);
        return { result: full, campaignId };
      }
    );
  }

  /**
   * Resumes a paused campaign.
   */
  static async resume(
    crecheId: number,
    campaignId: number,
    actor: ActorContext,
    reason: string,
    idempotencyKey?: string
  ): Promise<any> {
    assertCanManageCampaign(actor);

    if (!reason || !reason.trim()) {
      throw new CrecheCampaignValidationError("Motivo administrativo para retomar a campanha é obrigatório.");
    }

    return this.executeWithIdempotency(
      crecheId,
      idempotencyKey,
      "RESUME",
      { campaignId, reason },
      campaignId,
      async (tx) => {
        const [campaign] = await tx
          .select()
          .from(crechePromotionalCampaignsTable)
          .where(
            and(
              eq(crechePromotionalCampaignsTable.crecheId, crecheId),
              eq(crechePromotionalCampaignsTable.id, campaignId)
            )
          )
          .for("update")
          .limit(1);

        if (!campaign) {
          throw new CrecheCampaignNotFoundError(`Campanha #${campaignId} não encontrada.`);
        }

        if (campaign.status === "REVOKED") {
          throw new CrecheCampaignConflictError("Campanhas revogadas não podem ser retomadas.");
        }

        if (campaign.status === "ACTIVE") {
          const full = await this.getCampaignById(crecheId, campaignId, tx);
          return { result: full, campaignId };
        }

        if (campaign.status !== "PAUSED") {
          throw new CrecheCampaignConflictError(
            `Apenas campanhas PAUSADAS podem ser retomadas (status atual: ${campaign.status}).`
          );
        }

        const now = new Date();
        const validUntil = new Date(campaign.validUntil);
        const validFrom = new Date(campaign.validFrom);

        if (now.getTime() >= validUntil.getTime()) {
          throw new CrecheCampaignConflictError(
            "A campanha já ultrapassou sua data de término e não pode ser retomada."
          );
        }

        const nextStatus: CampaignStatus = now.getTime() >= validFrom.getTime() ? "ACTIVE" : "SCHEDULED";

        const [updated] = await tx
          .update(crechePromotionalCampaignsTable)
          .set({
            status: nextStatus,
            reason: reason.trim(),
            updatedAt: now,
          })
          .where(eq(crechePromotionalCampaignsTable.id, campaignId))
          .returning();

        await tx.insert(crechePromotionalCampaignAuditsTable).values({
          crecheId,
          campaignId,
          action: "CAMPAIGN_RESUMED",
          actorUserId: actor.userId,
          actorRole: actor.role,
          reason: reason.trim(),
          beforeState: campaign,
          afterState: updated,
          requestId: actor.requestId,
        });

        const full = await this.getCampaignById(crecheId, campaignId, tx);
        return { result: full, campaignId };
      }
    );
  }

  /**
   * Revokes a campaign permanently.
   * State transition serialized via row-level lock (Adjustment 5).
   */
  static async revoke(
    crecheId: number,
    campaignId: number,
    actor: ActorContext,
    reason: string,
    idempotencyKey?: string,
    atTime: Date = new Date()
  ): Promise<any> {
    assertCanManageCampaign(actor);

    if (!reason || !reason.trim()) {
      throw new CrecheCampaignValidationError("Motivo administrativo da revogação é obrigatório.");
    }

    return this.executeWithIdempotency(
      crecheId,
      idempotencyKey,
      "REVOKE",
      { campaignId, reason },
      campaignId,
      async (tx) => {
        const [campaign] = await tx
          .select()
          .from(crechePromotionalCampaignsTable)
          .where(
            and(
              eq(crechePromotionalCampaignsTable.crecheId, crecheId),
              eq(crechePromotionalCampaignsTable.id, campaignId)
            )
          )
          .for("update")
          .limit(1);

        if (!campaign) {
          throw new CrecheCampaignNotFoundError(`Campanha #${campaignId} não encontrada.`);
        }

        if (campaign.status === "REVOKED") {
          // Already revoked
          const full = await this.getCampaignById(crecheId, campaignId, tx);
          return { result: full, campaignId };
        }

        const validUntil = new Date(campaign.validUntil);
        if (campaign.status === "ENDED" || atTime.getTime() >= validUntil.getTime()) {
          throw new CrecheCampaignConflictError(
            "Campanhas cujo período já terminou (ENDED) não podem ser revogadas."
          );
        }

        const now = atTime;
        const [updated] = await tx
          .update(crechePromotionalCampaignsTable)
          .set({
            status: "REVOKED",
            reason: reason.trim(),
            revokedByUserId: actor.userId,
            revokedAt: now,
            updatedAt: now,
          })
          .where(eq(crechePromotionalCampaignsTable.id, campaignId))
          .returning();

        await tx.insert(crechePromotionalCampaignAuditsTable).values({
          crecheId,
          campaignId,
          action: "CAMPAIGN_REVOKED",
          actorUserId: actor.userId,
          actorRole: actor.role,
          reason: reason.trim(),
          beforeState: campaign,
          afterState: updated,
          requestId: actor.requestId,
        });

        const full = await this.getCampaignById(crecheId, campaignId, tx);
        return { result: full, campaignId };
      }
    );
  }

  /**
   * Supersedes an existing campaign with a new version.
   */
  static async supersede(
    crecheId: number,
    campaignId: number,
    actor: ActorContext,
    reason: string,
    newCampaignInput: CreateCampaignInput,
    idempotencyKey?: string
  ): Promise<any> {
    assertCanManageCampaign(actor);

    if (!reason || !reason.trim()) {
      throw new CrecheCampaignValidationError("Motivo administrativo para substituição é obrigatório.");
    }

    return this.executeWithIdempotency(
      crecheId,
      idempotencyKey,
      "SUPERSEDE",
      { campaignId, reason, newCampaignInput },
      campaignId,
      async (tx) => {
        // Lock existing campaign
        const [existing] = await tx
          .select()
          .from(crechePromotionalCampaignsTable)
          .where(
            and(
              eq(crechePromotionalCampaignsTable.crecheId, crecheId),
              eq(crechePromotionalCampaignsTable.id, campaignId)
            )
          )
          .for("update")
          .limit(1);

        if (!existing) {
          throw new CrecheCampaignNotFoundError(`Campanha #${campaignId} não encontrada.`);
        }

        if (existing.status === "REVOKED") {
          throw new CrecheCampaignConflictError("Campanhas já revogadas não podem ser substituídas.");
        }

        // Revoke the old campaign
        const now = new Date();
        await tx
          .update(crechePromotionalCampaignsTable)
          .set({
            status: "REVOKED",
            reason: `Substituída pela nova campanha. Motivo: ${reason.trim()}`,
            revokedByUserId: actor.userId,
            revokedAt: now,
            updatedAt: now,
          })
          .where(eq(crechePromotionalCampaignsTable.id, campaignId));

        await tx.insert(crechePromotionalCampaignAuditsTable).values({
          crecheId,
          campaignId,
          action: "CAMPAIGN_SUPERSEDED",
          actorUserId: actor.userId,
          actorRole: actor.role,
          reason: reason.trim(),
          beforeState: existing,
          afterState: { ...existing, status: "REVOKED", supersededBy: "NEW_VERSION" },
          requestId: actor.requestId,
        });

        // Validate items and tutors for the new campaign
        const benefit: CampaignBenefitInput = {
          benefitType: newCampaignInput.benefitType,
          percentageBps: newCampaignInput.percentageBps != null ? Number(newCampaignInput.percentageBps) : null,
          fixedDiscountCents: newCampaignInput.fixedDiscountCents != null ? Number(newCampaignInput.fixedDiscountCents) : null,
          fixedPromotionalPriceCents:
            newCampaignInput.fixedPromotionalPriceCents != null ? Number(newCampaignInput.fixedPromotionalPriceCents) : null,
        };

        const items = await this.validateItems(tx, crecheId, newCampaignInput.itemIds, benefit);
        let validTutorIds: number[] = [];
        if (newCampaignInput.audienceType === "SELECTED_TUTORS") {
          validTutorIds = await this.validateTutors(tx, crecheId, newCampaignInput.selectedTutorIds || []);
        }

        const validFrom = new Date(newCampaignInput.validFrom);
        const validUntil = new Date(newCampaignInput.validUntil);

        const newStatus: CampaignStatus = now.getTime() >= validFrom.getTime() ? "ACTIVE" : "SCHEDULED";

        // Insert new campaign linking supersedesCampaignId
        const [newCampaign] = await tx
          .insert(crechePromotionalCampaignsTable)
          .values({
            crecheId,
            name: newCampaignInput.name.trim(),
            description: newCampaignInput.description?.trim() || null,
            benefitType: benefit.benefitType,
            percentageBps: benefit.percentageBps,
            fixedDiscountCents: benefit.fixedDiscountCents,
            fixedPromotionalPriceCents: benefit.fixedPromotionalPriceCents,
            audienceType: newCampaignInput.audienceType,
            conditionInteractionPolicy: newCampaignInput.conditionInteractionPolicy || "EXCLUDE_IF_TUTOR_CONDITION",
            usageLimitType: newCampaignInput.usageLimitType || "UNLIMITED",
            usageLimitPerTutor: newCampaignInput.usageLimitPerTutor,
            priority: newCampaignInput.priority != null ? Math.max(0, Number(newCampaignInput.priority)) : 100,
            validFrom,
            validUntil,
            status: newStatus,
            reason: reason.trim(),
            createdByUserId: actor.userId,
            supersedesCampaignId: campaignId,
          })
          .returning();

        for (const it of items) {
          await tx.insert(crechePromotionalCampaignItemsTable).values({
            campaignId: newCampaign.id,
            crecheId,
            catalogueItemId: it.id,
          });
        }

        if (newCampaignInput.audienceType === "SELECTED_TUTORS") {
          for (const tutorId of validTutorIds) {
            await tx.insert(crechePromotionalCampaignTutorsTable).values({
              campaignId: newCampaign.id,
              crecheId,
              tutorId,
            });
          }
        }

        await tx.insert(crechePromotionalCampaignAuditsTable).values({
          crecheId,
          campaignId: newCampaign.id,
          action: "CAMPAIGN_CREATED",
          actorUserId: actor.userId,
          actorRole: actor.role,
          reason: `Criada em substituição à campanha #${campaignId}: ${reason.trim()}`,
          beforeState: null,
          afterState: newCampaign,
          requestId: actor.requestId,
        });

        const full = await this.getCampaignById(crecheId, newCampaign.id, tx);
        return { result: full, campaignId: newCampaign.id };
      }
    );
  }

  /**
   * Generates a preview with item pricing simulation and eligible tutor count.
   */
  static async preview(crecheId: number, input: CreateCampaignInput): Promise<any> {
    const validFrom = new Date(input.validFrom);
    const validUntil = new Date(input.validUntil);

    if (isNaN(validFrom.getTime()) || isNaN(validUntil.getTime())) {
      throw new CrecheCampaignValidationError("Datas de início e término inválidas.");
    }
    if (validUntil.getTime() <= validFrom.getTime()) {
      throw new CrecheCampaignValidationError("Data de término deve ser posterior à data de início.");
    }

    const benefit: CampaignBenefitInput = {
      benefitType: input.benefitType,
      percentageBps: input.percentageBps != null ? Number(input.percentageBps) : null,
      fixedDiscountCents: input.fixedDiscountCents != null ? Number(input.fixedDiscountCents) : null,
      fixedPromotionalPriceCents:
        input.fixedPromotionalPriceCents != null ? Number(input.fixedPromotionalPriceCents) : null,
    };

    const items = await this.validateItems(db, crecheId, input.itemIds, benefit);

    // Calculate eligible audience count
    let eligibleTutorCount = 0;
    if (input.audienceType === "ALL_ACTIVE_TUTORS") {
      const [{ countVal }] = await db
        .select({ countVal: count() })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.crecheId, crecheId),
            eq(usersTable.role, "tutor"),
            eq(usersTable.isActive, true)
          )
        );
      eligibleTutorCount = Number(countVal);
    } else {
      const validTutors = await this.validateTutors(db, crecheId, input.selectedTutorIds || []);
      eligibleTutorCount = validTutors.length;
    }

    // Calculate item pricing examples
    const itemPreviews = items.map((item) => {
      const baseCents = Number(item.basePrice) * 100;
      const pricing = calculateCampaignPrice(baseCents, benefit, { quantity: 1 });
      return {
        catalogueItemId: item.id,
        name: item.name,
        itemType: item.itemType,
        baseUnitPrice: pricing.baseUnitPrice,
        effectiveUnitPrice: pricing.effectiveUnitPrice,
        unitDiscount: pricing.unitDiscount,
      };
    });

    return {
      campaignName: input.name,
      benefitType: input.benefitType,
      audienceType: input.audienceType,
      eligibleTutorCount,
      itemPreviews,
      conditionInteractionPolicy: input.conditionInteractionPolicy || "EXCLUDE_IF_TUTOR_CONDITION",
      precedenceDisclaimer:
        (input.conditionInteractionPolicy || "EXCLUDE_IF_TUTOR_CONDITION") === "EXCLUDE_IF_TUTOR_CONDITION"
          ? "Tutores que já possuem condição comercial individual para este item continuarão utilizando sua condição individual. Os descontos nunca são acumulados."
          : "O ArkPet comparará a condição individual com a campanha e aplicará somente o menor preço. Os descontos nunca serão somados.",
    };
  }

  /**
   * Retrieves single campaign by ID with child items, tutors and audits.
   */
  static async getCampaignById(crecheId: number, campaignId: number, client: any = db): Promise<any> {
    const [campaign] = await client
      .select()
      .from(crechePromotionalCampaignsTable)
      .where(
        and(
          eq(crechePromotionalCampaignsTable.crecheId, crecheId),
          eq(crechePromotionalCampaignsTable.id, campaignId)
        )
      )
      .limit(1);

    if (!campaign) {
      throw new CrecheCampaignNotFoundError(`Campanha #${campaignId} não encontrada.`);
    }

    // Items
    const items = await client
      .select({
        id: crechePromotionalCampaignItemsTable.id,
        catalogueItemId: crechePromotionalCampaignItemsTable.catalogueItemId,
        name: catalogueItemsTable.name,
        itemType: catalogueItemsTable.type,
        basePrice: catalogueItemsTable.basePrice,
      })
      .from(crechePromotionalCampaignItemsTable)
      .innerJoin(
        catalogueItemsTable,
        eq(crechePromotionalCampaignItemsTable.catalogueItemId, catalogueItemsTable.id)
      )
      .where(eq(crechePromotionalCampaignItemsTable.campaignId, campaignId));

    // Tutors (if SELECTED_TUTORS)
    const tutors = await client
      .select({
        id: crechePromotionalCampaignTutorsTable.id,
        tutorId: crechePromotionalCampaignTutorsTable.tutorId,
        name: usersTable.name,
        email: usersTable.email,
      })
      .from(crechePromotionalCampaignTutorsTable)
      .innerJoin(
        usersTable,
        eq(crechePromotionalCampaignTutorsTable.tutorId, usersTable.id)
      )
      .where(eq(crechePromotionalCampaignTutorsTable.campaignId, campaignId));

    // Audits
    const audits = await client
      .select()
      .from(crechePromotionalCampaignAuditsTable)
      .where(eq(crechePromotionalCampaignAuditsTable.campaignId, campaignId))
      .orderBy(desc(crechePromotionalCampaignAuditsTable.createdAt));

    return {
      ...campaign,
      items,
      tutors,
      audits,
    };
  }

  /**
   * Lists campaigns with summary KPIs and filter options.
   */
  static async listCampaigns(
    crecheId: number,
    options: { status?: CampaignStatus; search?: string } = {}
  ): Promise<{ campaigns: any[]; kpis: CampaignSummaryKPIs }> {
    let whereConditions = [eq(crechePromotionalCampaignsTable.crecheId, crecheId)];

    if (options.status) {
      whereConditions.push(eq(crechePromotionalCampaignsTable.status, options.status));
    }

    if (options.search && options.search.trim()) {
      whereConditions.push(
        sql`${crechePromotionalCampaignsTable.name} ILIKE ${'%' + options.search.trim() + '%'}`
      );
    }

    const rows = await db
      .select()
      .from(crechePromotionalCampaignsTable)
      .where(and(...whereConditions))
      .orderBy(desc(crechePromotionalCampaignsTable.createdAt));

    // Populate item counts and eligible counts
    const campaigns = await Promise.all(
      rows.map(async (camp: any) => {
        const [{ countVal: itemCount }] = await db
          .select({ countVal: count() })
          .from(crechePromotionalCampaignItemsTable)
          .where(eq(crechePromotionalCampaignItemsTable.campaignId, camp.id));

        let eligibleTutorsCount = 0;
        if (camp.audienceType === "ALL_ACTIVE_TUTORS") {
          const [{ countVal: allTutors }] = await db
            .select({ countVal: count() })
            .from(usersTable)
            .where(
              and(
                eq(usersTable.crecheId, crecheId),
                eq(usersTable.role, "tutor"),
                eq(usersTable.isActive, true)
              )
            );
          eligibleTutorsCount = Number(allTutors);
        } else {
          const [{ countVal: selectedTutors }] = await db
            .select({ countVal: count() })
            .from(crechePromotionalCampaignTutorsTable)
            .where(eq(crechePromotionalCampaignTutorsTable.campaignId, camp.id));
          eligibleTutorsCount = Number(selectedTutors);
        }

        return {
          ...camp,
          itemCount: Number(itemCount),
          eligibleTutorsCount,
        };
      })
    );

    // Compute KPIs across all campaigns of this creche
    const allForCreche = await db
      .select({ status: crechePromotionalCampaignsTable.status })
      .from(crechePromotionalCampaignsTable)
      .where(eq(crechePromotionalCampaignsTable.crecheId, crecheId));

    const kpis: CampaignSummaryKPIs = {
      total: allForCreche.length,
      active: allForCreche.filter((c: any) => c.status === "ACTIVE").length,
      scheduled: allForCreche.filter((c: any) => c.status === "SCHEDULED").length,
      paused: allForCreche.filter((c: any) => c.status === "PAUSED").length,
      ended: allForCreche.filter((c: any) => c.status === "ENDED").length,
      revoked: allForCreche.filter((c: any) => c.status === "REVOKED").length,
    };

    return { campaigns, kpis };
  }

  /**
   * Resolves eligible campaigns for a tutor and catalogue item at a specific business time.
   * Candidate resolution only (no billing mutation in C1).
   */
  static async resolveEligibleCampaignsForTutor(
    crecheId: number,
    tutorId: number | null | undefined,
    catalogueItemId: number,
    baseUnitPriceCents: number,
    atTime: Date = new Date(),
    client: any = db
  ): Promise<
    {
      campaign: CrechePromotionalCampaign;
      effectiveUnitPriceCents: number;
      unitDiscountCents: number;
    }[]
  > {
    // 1. Query campaigns targeting this item
    const targetedCampaigns = await client
      .select({ campaign: crechePromotionalCampaignsTable })
      .from(crechePromotionalCampaignItemsTable)
      .innerJoin(
        crechePromotionalCampaignsTable,
        eq(crechePromotionalCampaignItemsTable.campaignId, crechePromotionalCampaignsTable.id)
      )
      .where(
        and(
          eq(crechePromotionalCampaignItemsTable.crecheId, crecheId),
          eq(crechePromotionalCampaignItemsTable.catalogueItemId, catalogueItemId),
          or(
            eq(crechePromotionalCampaignsTable.status, "ACTIVE"),
            eq(crechePromotionalCampaignsTable.status, "SCHEDULED")
          )
        )
      );

    const eligibleCandidates: {
      campaign: CrechePromotionalCampaign;
      effectiveUnitPriceCents: number;
      unitDiscountCents: number;
    }[] = [];

    for (const { campaign } of targetedCampaigns) {
      // Check temporal activity
      if (!isCampaignActive(campaign, atTime)) {
        continue;
      }

      // Check audience eligibility
      if (campaign.audienceType === "SELECTED_TUTORS") {
        if (!tutorId) continue;
        const [isTargeted] = await client
          .select()
          .from(crechePromotionalCampaignTutorsTable)
          .where(
            and(
              eq(crechePromotionalCampaignTutorsTable.campaignId, campaign.id),
              eq(crechePromotionalCampaignTutorsTable.tutorId, tutorId)
            )
          )
          .limit(1);

        if (!isTargeted) continue;
      } else {
        // ALL_ACTIVE_TUTORS: verify tutor is active if tutorId is provided
        if (tutorId) {
          const [tutorUser] = await client
            .select()
            .from(usersTable)
            .where(
              and(
                eq(usersTable.id, tutorId),
                eq(usersTable.crecheId, crecheId),
                eq(usersTable.role, "tutor"),
                eq(usersTable.isActive, true)
              )
            )
            .limit(1);

          if (!tutorUser) continue;
        }
      }

      // Calculate benefit pricing
      try {
        const pricing = calculateCampaignPrice(
          baseUnitPriceCents,
          {
            benefitType: campaign.benefitType as CampaignBenefitType,
            percentageBps: campaign.percentageBps,
            fixedDiscountCents: campaign.fixedDiscountCents,
            fixedPromotionalPriceCents: campaign.fixedPromotionalPriceCents,
          },
          { quantity: 1, campaignId: campaign.id }
        );

        eligibleCandidates.push({
          campaign,
          effectiveUnitPriceCents: pricing.effectiveUnitPriceCents,
          unitDiscountCents: pricing.unitDiscountCents,
        });
      } catch {
        // Skip if benefit calculation fails on this item
        continue;
      }
    }

    return eligibleCandidates;
  }
}
