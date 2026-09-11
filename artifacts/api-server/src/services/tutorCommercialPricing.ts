import crypto from "node:crypto";
import { db } from "@workspace/db";
import {
  tutorCommercialConditionsTable,
  tutorCommercialOperationsTable,
  tutorCommercialAuditsTable,
  catalogueItemsTable,
  usersTable,
  type TutorCommercialCondition,
} from "@workspace/db/schema";
import { eq, and, or, sql, desc, asc } from "drizzle-orm";
import { BillingService } from "./billing.js";
import { getBusinessDate } from "../lib/date.js";

// ─── Domain Errors ────────────────────────────────────────────────────────────

export class TutorCommercialError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "TutorCommercialError";
    this.status = status;
  }
}

export class TutorCommercialValidationError extends TutorCommercialError {
  constructor(message: string) {
    super(message, 422);
    this.name = "TutorCommercialValidationError";
  }
}

export class TutorCommercialNotFoundError extends TutorCommercialError {
  constructor(message: string) {
    super(message, 404);
    this.name = "TutorCommercialNotFoundError";
  }
}

export class TutorCommercialConflictError extends TutorCommercialError {
  constructor(message: string) {
    super(message, 409);
    this.name = "TutorCommercialConflictError";
  }
}

export class TutorCommercialForbiddenError extends TutorCommercialError {
  constructor(message: string) {
    super(message, 403);
    this.name = "TutorCommercialForbiddenError";
  }
}

// ─── Types & Interfaces ───────────────────────────────────────────────────────

export type TutorConditionType = "CUSTOM_PRICE" | "PERCENTAGE_DISCOUNT" | "FIXED_DISCOUNT";
export type TutorConditionStatus =
  | "SCHEDULED"
  | "ACTIVE"
  | "SUPERSEDED"
  | "EXPIRED"
  | "REVOKED"
  | "CANCELLED";

export type PricingSourceType = "CATALOG" | "TUTOR_CONDITION";

export interface ConditionSnapshotData {
  conditionId: number | null;
  conditionType: TutorConditionType | null;
  value: {
    customPriceCents?: number | null;
    percentageBps?: number | null;
    fixedDiscountCents?: number | null;
  } | null;
  baseUnitPriceCents: number;
  effectiveUnitPriceCents: number;
  unitDiscountCents: number;
  quantity: number;
  baseLineTotalCents: number;
  discountLineTotalCents: number;
  finalLineTotalCents: number;
  catalogueItemId: number;
  petSize?: string | null;
  snapshotTimestamp: string;
}

export interface ResolvedPriceSnapshot {
  pricingSourceType: PricingSourceType;
  appliedConditionId: number | null;
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
  conditionSnapshot: ConditionSnapshotData | null;
}

export interface ActorContext {
  userId: number;
  role: string;
  requestId?: string;
}

export interface CreateConditionInput {
  catalogueItemId: number;
  conditionType: TutorConditionType;
  customPriceCents?: number | null;
  percentageBps?: number | null;
  fixedDiscountCents?: number | null;
  validFrom?: Date | string;
  validUntil?: Date | string | null;
  reason: string;
  idempotencyKey?: string;
}

export interface SupersedeConditionInput {
  conditionType: TutorConditionType;
  customPriceCents?: number | null;
  percentageBps?: number | null;
  fixedDiscountCents?: number | null;
  validFrom?: Date | string;
  validUntil?: Date | string | null;
  reason: string;
  idempotencyKey?: string;
}

export interface PreviewConditionInput {
  catalogueItemId: number;
  conditionType: TutorConditionType;
  customPriceCents?: number | null;
  percentageBps?: number | null;
  fixedDiscountCents?: number | null;
  petSize?: string | null;
  quantity?: number;
}

// ─── Pure Math Functions ──────────────────────────────────────────────────────

export function decimalStringToCents(val: string | number | null | undefined): number {
  if (val == null) return 0;
  if (typeof val === "number") return Math.round(val * 100);
  const parsed = parseFloat(val);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

export function centsToDecimalString(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * BigInt roundHalfUp percentage calculation:
 * effectiveUnitPrice = roundHalfUp(baseUnitPrice * (10000 - bps) / 10000)
 */
export function applyPercentageDiscount(
  baseUnitPriceCents: number,
  percentageBps: number
): { effectiveUnitPriceCents: number; unitDiscountCents: number } {
  if (percentageBps <= 0) {
    return { effectiveUnitPriceCents: baseUnitPriceCents, unitDiscountCents: 0 };
  }
  if (percentageBps >= 10000) {
    return { effectiveUnitPriceCents: 0, unitDiscountCents: baseUnitPriceCents };
  }
  const discountCents = Number(
    (BigInt(baseUnitPriceCents) * BigInt(percentageBps) + 5000n) / 10000n
  );
  const effectiveUnitPriceCents = Math.max(0, baseUnitPriceCents - discountCents);
  return { effectiveUnitPriceCents, unitDiscountCents: discountCents };
}

export function applyFixedDiscount(
  baseUnitPriceCents: number,
  fixedDiscountCents: number
): { effectiveUnitPriceCents: number; unitDiscountCents: number } {
  const actualDiscount = Math.min(baseUnitPriceCents, Math.max(0, fixedDiscountCents));
  const effectiveUnitPriceCents = Math.max(0, baseUnitPriceCents - actualDiscount);
  return { effectiveUnitPriceCents, unitDiscountCents: actualDiscount };
}

export function applyCustomPrice(
  baseUnitPriceCents: number,
  customPriceCents: number
): { effectiveUnitPriceCents: number; unitDiscountCents: number } {
  const effectiveUnitPriceCents = Math.max(0, customPriceCents);
  const unitDiscountCents = Math.max(0, baseUnitPriceCents - effectiveUnitPriceCents);
  return { effectiveUnitPriceCents, unitDiscountCents };
}

export function resolveBasePriceCents(
  catalogueItem: {
    basePrice: string | number;
    priceSmall?: string | number | null;
    priceMedium?: string | number | null;
    priceLarge?: string | number | null;
  },
  petSize?: string | null
): number {
  if (petSize === "small" && catalogueItem.priceSmall != null) {
    return decimalStringToCents(catalogueItem.priceSmall);
  }
  if (petSize === "medium" && catalogueItem.priceMedium != null) {
    return decimalStringToCents(catalogueItem.priceMedium);
  }
  if (petSize === "large" && catalogueItem.priceLarge != null) {
    return decimalStringToCents(catalogueItem.priceLarge);
  }
  return decimalStringToCents(catalogueItem.basePrice);
}

/**
 * Calculates line totals and snapshot strictly separating unit vs line metrics.
 */
export function calculateResolvedSnapshot(params: {
  baseUnitPriceCents: number;
  conditionType?: TutorConditionType | null;
  customPriceCents?: number | null;
  percentageBps?: number | null;
  fixedDiscountCents?: number | null;
  quantity?: number;
  catalogueItemId: number;
  appliedConditionId?: number | null;
  petSize?: string | null;
  snapshotTimestamp?: string;
}): ResolvedPriceSnapshot {
  const quantity = Math.max(1, params.quantity ?? 1);
  const baseUnitPriceCents = Math.max(0, params.baseUnitPriceCents);
  let effectiveUnitPriceCents = baseUnitPriceCents;
  let unitDiscountCents = 0;
  const hasCondition = Boolean(params.conditionType && params.appliedConditionId);

  if (hasCondition) {
    switch (params.conditionType) {
      case "PERCENTAGE_DISCOUNT": {
        const res = applyPercentageDiscount(baseUnitPriceCents, params.percentageBps ?? 0);
        effectiveUnitPriceCents = res.effectiveUnitPriceCents;
        unitDiscountCents = res.unitDiscountCents;
        break;
      }
      case "FIXED_DISCOUNT": {
        const res = applyFixedDiscount(baseUnitPriceCents, params.fixedDiscountCents ?? 0);
        effectiveUnitPriceCents = res.effectiveUnitPriceCents;
        unitDiscountCents = res.unitDiscountCents;
        break;
      }
      case "CUSTOM_PRICE": {
        const res = applyCustomPrice(baseUnitPriceCents, params.customPriceCents ?? 0);
        effectiveUnitPriceCents = res.effectiveUnitPriceCents;
        unitDiscountCents = res.unitDiscountCents;
        break;
      }
    }
  }

  const baseLineTotalCents = baseUnitPriceCents * quantity;
  const finalLineTotalCents = effectiveUnitPriceCents * quantity;
  const discountLineTotalCents = Math.max(0, baseLineTotalCents - finalLineTotalCents);
  const snapshotTimestamp = params.snapshotTimestamp || new Date().toISOString();

  const conditionSnapshot: ConditionSnapshotData | null = hasCondition
    ? {
        conditionId: params.appliedConditionId ?? null,
        conditionType: params.conditionType ?? null,
        value: {
          customPriceCents: params.customPriceCents ?? null,
          percentageBps: params.percentageBps ?? null,
          fixedDiscountCents: params.fixedDiscountCents ?? null,
        },
        baseUnitPriceCents,
        effectiveUnitPriceCents,
        unitDiscountCents,
        quantity,
        baseLineTotalCents,
        discountLineTotalCents,
        finalLineTotalCents,
        catalogueItemId: params.catalogueItemId,
        petSize: params.petSize ?? null,
        snapshotTimestamp,
      }
    : null;

  return {
    pricingSourceType: hasCondition ? "TUTOR_CONDITION" : "CATALOG",
    appliedConditionId: hasCondition ? (params.appliedConditionId ?? null) : null,
    baseUnitPriceCents,
    effectiveUnitPriceCents,
    unitDiscountCents,
    baseUnitPrice: centsToDecimalString(baseUnitPriceCents),
    effectiveUnitPrice: centsToDecimalString(effectiveUnitPriceCents),
    unitDiscount: centsToDecimalString(unitDiscountCents),
    quantity,
    baseLineTotalCents,
    discountLineTotalCents,
    finalLineTotalCents,
    baseLineTotal: centsToDecimalString(baseLineTotalCents),
    discountLineTotal: centsToDecimalString(discountLineTotalCents),
    finalLineTotal: centsToDecimalString(finalLineTotalCents),
    conditionSnapshot,
  };
}

// ─── Temporal & Overlap Logic ─────────────────────────────────────────────────

/**
 * Checks if interval [startA, endA) overlaps with interval [startB, endB).
 * Intervals are half-open: adjacent intervals where endA === startB do NOT overlap.
 */
export function checkIntervalOverlap(
  startA: Date,
  endA: Date | null,
  startB: Date,
  endB: Date | null
): boolean {
  const aTime = startA.getTime();
  const aEnd = endA ? endA.getTime() : Infinity;
  const bTime = startB.getTime();
  const bEnd = endB ? endB.getTime() : Infinity;

  return aTime < bEnd && aEnd > bTime;
}

export function isConditionActive(cond: TutorCommercialCondition, atTime: Date = new Date()): boolean {
  if (cond.status !== "ACTIVE" && cond.status !== "SCHEDULED") return false;
  const now = atTime.getTime();
  const from = new Date(cond.validFrom).getTime();
  const until = cond.validUntil ? new Date(cond.validUntil).getTime() : Infinity;
  return from <= now && now < until;
}

// ─── Service Class ────────────────────────────────────────────────────────────

export class TutorCommercialPricingService {
  /**
   * Enforces role boundaries:
   * Only creche_admin or system can mutate tutor commercial conditions.
   * staff has read-only operational access; tutors have zero access.
   */
  static assertCanManage(actor: ActorContext): void {
    if (actor.role !== "creche_admin" && actor.role !== "admin" && actor.role !== "system") {
      throw new TutorCommercialForbiddenError(
        "Apenas administradores da creche podem gerenciar condições comerciais de tutores."
      );
    }
  }

  /**
   * Pure price preview simulation.
   */
  static async previewCondition(
    crecheId: number,
    tutorId: number,
    input: PreviewConditionInput,
    txClient: any = db
  ): Promise<ResolvedPriceSnapshot> {
    const [item] = await txClient
      .select()
      .from(catalogueItemsTable)
      .where(and(eq(catalogueItemsTable.id, input.catalogueItemId), eq(catalogueItemsTable.crecheId, crecheId)))
      .limit(1);

    if (!item) {
      throw new TutorCommercialNotFoundError("Item do catálogo não encontrado para esta creche.");
    }

    const baseUnitPriceCents = resolveBasePriceCents(item, input.petSize);
    return calculateResolvedSnapshot({
      baseUnitPriceCents,
      conditionType: input.conditionType,
      customPriceCents: input.customPriceCents,
      percentageBps: input.percentageBps,
      fixedDiscountCents: input.fixedDiscountCents,
      quantity: input.quantity ?? 1,
      catalogueItemId: input.catalogueItemId,
      appliedConditionId: 0, // preview indicator
      petSize: input.petSize,
    });
  }

  /**
   * Resolves authoritative price for a tutor + catalogue item at a specific point in time.
   * If an active condition exists, applies it; otherwise falls back cleanly to CATALOG.
   */
  static async resolveItemPriceForTutor(
    crecheId: number,
    tutorId: number | null | undefined,
    catalogueItemId: number,
    options: {
      petSize?: string | null;
      quantity?: number;
      tx?: any;
      atTime?: Date;
    } = {}
  ): Promise<ResolvedPriceSnapshot> {
    const txClient = options.tx ?? db;
    const atTime = options.atTime ?? new Date();

    const [item] = await txClient
      .select()
      .from(catalogueItemsTable)
      .where(and(eq(catalogueItemsTable.id, catalogueItemId), eq(catalogueItemsTable.crecheId, crecheId)))
      .limit(1);

    if (!item) {
      throw new TutorCommercialNotFoundError(`Item do catálogo #${catalogueItemId} não encontrado.`);
    }

    const baseUnitPriceCents = resolveBasePriceCents(item, options.petSize);

    // If no tutor (e.g. anonymous POS sale), always catalog pricing
    if (!tutorId) {
      return calculateResolvedSnapshot({
        baseUnitPriceCents,
        quantity: options.quantity ?? 1,
        catalogueItemId,
        petSize: options.petSize,
      });
    }

    // Query active conditions for this tutor + catalogue item
    const conditions = await txClient
      .select()
      .from(tutorCommercialConditionsTable)
      .where(
        and(
          eq(tutorCommercialConditionsTable.crecheId, crecheId),
          eq(tutorCommercialConditionsTable.tutorId, tutorId),
          eq(tutorCommercialConditionsTable.catalogueItemId, catalogueItemId),
          or(
            eq(tutorCommercialConditionsTable.status, "ACTIVE"),
            eq(tutorCommercialConditionsTable.status, "SCHEDULED")
          )
        )
      )
      .orderBy(desc(tutorCommercialConditionsTable.id));

    // Find the condition matching authoritative atTime
    const activeCondition = conditions.find((c: TutorCommercialCondition) => isConditionActive(c, atTime));

    if (!activeCondition) {
      return calculateResolvedSnapshot({
        baseUnitPriceCents,
        quantity: options.quantity ?? 1,
        catalogueItemId,
        petSize: options.petSize,
      });
    }

    return calculateResolvedSnapshot({
      baseUnitPriceCents,
      conditionType: activeCondition.conditionType as TutorConditionType,
      customPriceCents: activeCondition.customPriceCents,
      percentageBps: activeCondition.percentageBps,
      fixedDiscountCents: activeCondition.fixedDiscountCents,
      quantity: options.quantity ?? 1,
      catalogueItemId,
      appliedConditionId: activeCondition.id,
      petSize: options.petSize,
    });
  }

  /**
   * Creates a new individual commercial condition for a tutor.
   * Wrapped in BillingService.acquireTutorFinancialLock with full idempotency support.
   */
  static async createCondition(
    crecheId: number,
    tutorId: number,
    input: CreateConditionInput,
    actor: ActorContext
  ): Promise<TutorCommercialCondition> {
    this.assertCanManage(actor);

    // Validate reason
    if (!input.reason || !input.reason.trim()) {
      throw new TutorCommercialValidationError("Motivo da condição comercial é obrigatório.");
    }

    // Validate type and value mutual exclusivity
    this.validateConditionValues(input);

    const validFromDate = input.validFrom ? new Date(input.validFrom) : new Date();
    const validUntilDate = input.validUntil ? new Date(input.validUntil) : null;

    if (validUntilDate && validUntilDate.getTime() <= validFromDate.getTime()) {
      throw new TutorCommercialValidationError(
        "A data final (validUntil) deve ser posterior à data inicial (validFrom)."
      );
    }

    const payloadHash = this.computePayloadHash({
      crecheId,
      tutorId,
      catalogueItemId: input.catalogueItemId,
      conditionType: input.conditionType,
      customPriceCents: input.customPriceCents ?? null,
      percentageBps: input.percentageBps ?? null,
      fixedDiscountCents: input.fixedDiscountCents ?? null,
      validFrom: validFromDate.toISOString(),
      validUntil: validUntilDate ? validUntilDate.toISOString() : null,
      reason: input.reason.trim(),
    });

    return await db.transaction(async (tx) => {
      // 1. Check idempotency ledger
      if (input.idempotencyKey) {
        const existingOp = await this.findIdempotentOperation(crecheId, input.idempotencyKey, tx);
        if (existingOp) {
          if (existingOp.payloadHash !== payloadHash || existingOp.tutorId !== tutorId) {
            throw new TutorCommercialConflictError(
              "Chave de idempotência já utilizada com parâmetros diferentes."
            );
          }
          return existingOp.responseJson as TutorCommercialCondition;
        }
      }

      // 2. Advisory Lock for creche + tutor
      await BillingService.acquireTutorFinancialLock(crecheId, tutorId, tx);

      // 3. Verify tutor exists and belongs to creche
      const [tutor] = await tx
        .select({ id: usersTable.id, role: usersTable.role })
        .from(usersTable)
        .where(and(eq(usersTable.id, tutorId), eq(usersTable.crecheId, crecheId)))
        .limit(1);

      if (!tutor) {
        throw new TutorCommercialNotFoundError("Tutor não encontrado para esta creche.");
      }

      // 4. Verify catalogue item exists and belongs to creche
      const [item] = await tx
        .select({ id: catalogueItemsTable.id, isActive: catalogueItemsTable.isActive })
        .from(catalogueItemsTable)
        .where(
          and(
            eq(catalogueItemsTable.id, input.catalogueItemId),
            eq(catalogueItemsTable.crecheId, crecheId)
          )
        )
        .limit(1);

      if (!item) {
        throw new TutorCommercialNotFoundError("Item do catálogo não encontrado para esta creche.");
      }
      if (!item.isActive) {
        throw new TutorCommercialValidationError("Não é possível associar condição a um item inativo.");
      }

      // 5. Overlap verification against existing non-terminal conditions
      const existingConditions = await tx
        .select()
        .from(tutorCommercialConditionsTable)
        .where(
          and(
            eq(tutorCommercialConditionsTable.crecheId, crecheId),
            eq(tutorCommercialConditionsTable.tutorId, tutorId),
            eq(tutorCommercialConditionsTable.catalogueItemId, input.catalogueItemId),
            or(
              eq(tutorCommercialConditionsTable.status, "ACTIVE"),
              eq(tutorCommercialConditionsTable.status, "SCHEDULED")
            )
          )
        );

      for (const existing of existingConditions) {
        if (
          checkIntervalOverlap(
            validFromDate,
            validUntilDate,
            new Date(existing.validFrom),
            existing.validUntil ? new Date(existing.validUntil) : null
          )
        ) {
          throw new TutorCommercialConflictError(
            `Conflito temporal: já existe uma condição (#${existing.id}, status: ${existing.status}) ativa ou agendada para este item no período informado.`
          );
        }
      }

      // 6. Determine status
      const now = new Date();
      let initialStatus: TutorConditionStatus = "SCHEDULED";
      if (validFromDate.getTime() <= now.getTime()) {
        if (!validUntilDate || validUntilDate.getTime() > now.getTime()) {
          initialStatus = "ACTIVE";
        } else {
          initialStatus = "EXPIRED";
        }
      }

      // 7. Insert condition
      const [newCondition] = await tx
        .insert(tutorCommercialConditionsTable)
        .values({
          crecheId,
          tutorId,
          catalogueItemId: input.catalogueItemId,
          conditionType: input.conditionType,
          customPriceCents: input.customPriceCents ?? null,
          percentageBps: input.percentageBps ?? null,
          fixedDiscountCents: input.fixedDiscountCents ?? null,
          validFrom: validFromDate,
          validUntil: validUntilDate,
          status: initialStatus,
          reason: input.reason.trim(),
          createdByUserId: actor.userId,
          idempotencyKey: input.idempotencyKey ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      // 8. Record audit
      await tx.insert(tutorCommercialAuditsTable).values({
        crecheId,
        tutorId,
        conditionId: newCondition.id,
        catalogueItemId: input.catalogueItemId,
        action: "CREATE",
        actorUserId: actor.userId,
        actorRole: actor.role,
        reason: input.reason.trim(),
        beforeState: null,
        afterState: newCondition,
        requestId: actor.requestId ?? null,
        createdAt: now,
      });

      // 9. Record operation idempotency
      if (input.idempotencyKey) {
        await tx.insert(tutorCommercialOperationsTable).values({
          crecheId,
          tutorId,
          idempotencyKey: input.idempotencyKey,
          operationType: "CREATE_CONDITION",
          payloadHash,
          status: "COMMITTED",
          responseJson: newCondition,
          conditionId: newCondition.id,
          createdAt: now,
          updatedAt: now,
        });
      }

      return newCondition;
    });
  }

  /**
   * Supersedes an existing active or scheduled condition with a new condition.
   * Adjusts old condition interval/status so no overlap occurs.
   */
  static async supersedeCondition(
    crecheId: number,
    tutorId: number,
    conditionId: number,
    input: SupersedeConditionInput,
    actor: ActorContext
  ): Promise<TutorCommercialCondition> {
    this.assertCanManage(actor);

    if (!input.reason || !input.reason.trim()) {
      throw new TutorCommercialValidationError("Motivo da substituição é obrigatório.");
    }

    this.validateConditionValues(input);

    const validFromDate = input.validFrom ? new Date(input.validFrom) : new Date();
    const validUntilDate = input.validUntil ? new Date(input.validUntil) : null;

    if (validUntilDate && validUntilDate.getTime() <= validFromDate.getTime()) {
      throw new TutorCommercialValidationError(
        "A data final (validUntil) deve ser posterior à data inicial (validFrom)."
      );
    }

    const payloadHash = this.computePayloadHash({
      crecheId,
      tutorId,
      conditionId,
      conditionType: input.conditionType,
      customPriceCents: input.customPriceCents ?? null,
      percentageBps: input.percentageBps ?? null,
      fixedDiscountCents: input.fixedDiscountCents ?? null,
      validFrom: validFromDate.toISOString(),
      validUntil: validUntilDate ? validUntilDate.toISOString() : null,
      reason: input.reason.trim(),
    });

    return await db.transaction(async (tx) => {
      // 1. Idempotency check
      if (input.idempotencyKey) {
        const existingOp = await this.findIdempotentOperation(crecheId, input.idempotencyKey, tx);
        if (existingOp) {
          if (existingOp.payloadHash !== payloadHash || existingOp.tutorId !== tutorId) {
            throw new TutorCommercialConflictError(
              "Chave de idempotência já utilizada com parâmetros diferentes."
            );
          }
          return existingOp.responseJson as TutorCommercialCondition;
        }
      }

      // 2. Lock
      await BillingService.acquireTutorFinancialLock(crecheId, tutorId, tx);

      // 3. Find old condition
      const [oldCondition] = await tx
        .select()
        .from(tutorCommercialConditionsTable)
        .where(
          and(
            eq(tutorCommercialConditionsTable.id, conditionId),
            eq(tutorCommercialConditionsTable.crecheId, crecheId),
            eq(tutorCommercialConditionsTable.tutorId, tutorId)
          )
        )
        .limit(1);

      if (!oldCondition) {
        throw new TutorCommercialNotFoundError("Condição comercial anterior não encontrada.");
      }

      if (oldCondition.status !== "ACTIVE" && oldCondition.status !== "SCHEDULED") {
        throw new TutorCommercialValidationError(
          `Condição com status '${oldCondition.status}' não pode ser substituída.`
        );
      }

      const catalogueItemId = oldCondition.catalogueItemId;
      const now = new Date();

      // 4. Update old condition to SUPERSEDED and trim validUntil if needed
      const oldValidUntil = oldCondition.validUntil
        ? new Date(oldCondition.validUntil)
        : null;
      const newOldValidUntil =
        !oldValidUntil || oldValidUntil.getTime() > validFromDate.getTime()
          ? validFromDate
          : oldValidUntil;

      const [updatedOld] = await tx
        .update(tutorCommercialConditionsTable)
        .set({
          status: "SUPERSEDED",
          validUntil: newOldValidUntil,
          updatedAt: now,
        })
        .where(eq(tutorCommercialConditionsTable.id, conditionId))
        .returning();

      // 5. Determine new status
      let initialStatus: TutorConditionStatus = "SCHEDULED";
      if (validFromDate.getTime() <= now.getTime()) {
        if (!validUntilDate || validUntilDate.getTime() > now.getTime()) {
          initialStatus = "ACTIVE";
        } else {
          initialStatus = "EXPIRED";
        }
      }

      // 6. Insert successor condition
      const [newCondition] = await tx
        .insert(tutorCommercialConditionsTable)
        .values({
          crecheId,
          tutorId,
          catalogueItemId,
          conditionType: input.conditionType,
          customPriceCents: input.customPriceCents ?? null,
          percentageBps: input.percentageBps ?? null,
          fixedDiscountCents: input.fixedDiscountCents ?? null,
          validFrom: validFromDate,
          validUntil: validUntilDate,
          status: initialStatus,
          reason: input.reason.trim(),
          createdByUserId: actor.userId,
          supersedesConditionId: conditionId,
          idempotencyKey: input.idempotencyKey ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      // 7. Audit records
      await tx.insert(tutorCommercialAuditsTable).values({
        crecheId,
        tutorId,
        conditionId: oldCondition.id,
        catalogueItemId,
        action: "SUPERSEDE_OLD",
        actorUserId: actor.userId,
        actorRole: actor.role,
        reason: input.reason.trim(),
        beforeState: oldCondition,
        afterState: updatedOld,
        requestId: actor.requestId ?? null,
        createdAt: now,
      });

      await tx.insert(tutorCommercialAuditsTable).values({
        crecheId,
        tutorId,
        conditionId: newCondition.id,
        catalogueItemId,
        action: "SUPERSEDE_NEW",
        actorUserId: actor.userId,
        actorRole: actor.role,
        reason: input.reason.trim(),
        beforeState: null,
        afterState: newCondition,
        requestId: actor.requestId ?? null,
        createdAt: now,
      });

      // 8. Operation idempotency
      if (input.idempotencyKey) {
        await tx.insert(tutorCommercialOperationsTable).values({
          crecheId,
          tutorId,
          idempotencyKey: input.idempotencyKey,
          operationType: "SUPERSEDE_CONDITION",
          payloadHash,
          status: "COMMITTED",
          responseJson: newCondition,
          conditionId: newCondition.id,
          createdAt: now,
          updatedAt: now,
        });
      }

      return newCondition;
    });
  }

  /**
   * Revokes an active or scheduled condition.
   */
  static async revokeCondition(
    crecheId: number,
    tutorId: number,
    conditionId: number,
    reason: string,
    actor: ActorContext,
    idempotencyKey?: string
  ): Promise<TutorCommercialCondition> {
    this.assertCanManage(actor);

    if (!reason || !reason.trim()) {
      throw new TutorCommercialValidationError("Motivo da revogação é obrigatório.");
    }

    const payloadHash = this.computePayloadHash({
      crecheId,
      tutorId,
      conditionId,
      reason: reason.trim(),
    });

    return await db.transaction(async (tx) => {
      // 1. Idempotency check
      if (idempotencyKey) {
        const existingOp = await this.findIdempotentOperation(crecheId, idempotencyKey, tx);
        if (existingOp) {
          if (existingOp.payloadHash !== payloadHash || existingOp.tutorId !== tutorId) {
            throw new TutorCommercialConflictError(
              "Chave de idempotência já utilizada com parâmetros diferentes."
            );
          }
          return existingOp.responseJson as TutorCommercialCondition;
        }
      }

      // 2. Lock
      await BillingService.acquireTutorFinancialLock(crecheId, tutorId, tx);

      // 3. Find condition
      const [condition] = await tx
        .select()
        .from(tutorCommercialConditionsTable)
        .where(
          and(
            eq(tutorCommercialConditionsTable.id, conditionId),
            eq(tutorCommercialConditionsTable.crecheId, crecheId),
            eq(tutorCommercialConditionsTable.tutorId, tutorId)
          )
        )
        .limit(1);

      if (!condition) {
        throw new TutorCommercialNotFoundError("Condição comercial não encontrada.");
      }

      if (condition.status !== "ACTIVE" && condition.status !== "SCHEDULED") {
        throw new TutorCommercialValidationError(
          `Condição com status '${condition.status}' não pode ser revogada.`
        );
      }

      const now = new Date();

      // 4. Update status to REVOKED
      const [revokedCondition] = await tx
        .update(tutorCommercialConditionsTable)
        .set({
          status: "REVOKED",
          revokedByUserId: actor.userId,
          revokedAt: now,
          updatedAt: now,
        })
        .where(eq(tutorCommercialConditionsTable.id, conditionId))
        .returning();

      // 5. Audit
      await tx.insert(tutorCommercialAuditsTable).values({
        crecheId,
        tutorId,
        conditionId,
        catalogueItemId: condition.catalogueItemId,
        action: "REVOKE",
        actorUserId: actor.userId,
        actorRole: actor.role,
        reason: reason.trim(),
        beforeState: condition,
        afterState: revokedCondition,
        requestId: actor.requestId ?? null,
        createdAt: now,
      });

      // 6. Operation idempotency
      if (idempotencyKey) {
        await tx.insert(tutorCommercialOperationsTable).values({
          crecheId,
          tutorId,
          idempotencyKey,
          operationType: "REVOKE_CONDITION",
          payloadHash,
          status: "COMMITTED",
          responseJson: revokedCondition,
          conditionId: revokedCondition.id,
          createdAt: now,
          updatedAt: now,
        });
      }

      return revokedCondition;
    });
  }

  /**
   * Lists commercial conditions for a tutor with catalogue item joined.
   */
  static async listConditions(
    crecheId: number,
    tutorId: number,
    txClient: any = db
  ) {
    const rows = await txClient
      .select({
        id: tutorCommercialConditionsTable.id,
        crecheId: tutorCommercialConditionsTable.crecheId,
        tutorId: tutorCommercialConditionsTable.tutorId,
        catalogueItemId: tutorCommercialConditionsTable.catalogueItemId,
        conditionType: tutorCommercialConditionsTable.conditionType,
        customPriceCents: tutorCommercialConditionsTable.customPriceCents,
        percentageBps: tutorCommercialConditionsTable.percentageBps,
        fixedDiscountCents: tutorCommercialConditionsTable.fixedDiscountCents,
        validFrom: tutorCommercialConditionsTable.validFrom,
        validUntil: tutorCommercialConditionsTable.validUntil,
        status: tutorCommercialConditionsTable.status,
        reason: tutorCommercialConditionsTable.reason,
        createdByUserId: tutorCommercialConditionsTable.createdByUserId,
        supersedesConditionId: tutorCommercialConditionsTable.supersedesConditionId,
        revokedByUserId: tutorCommercialConditionsTable.revokedByUserId,
        revokedAt: tutorCommercialConditionsTable.revokedAt,
        createdAt: tutorCommercialConditionsTable.createdAt,
        updatedAt: tutorCommercialConditionsTable.updatedAt,
        itemName: catalogueItemsTable.name,
        itemType: catalogueItemsTable.type,
        itemBasePrice: catalogueItemsTable.basePrice,
      })
      .from(tutorCommercialConditionsTable)
      .leftJoin(
        catalogueItemsTable,
        eq(tutorCommercialConditionsTable.catalogueItemId, catalogueItemsTable.id)
      )
      .where(
        and(
          eq(tutorCommercialConditionsTable.crecheId, crecheId),
          eq(tutorCommercialConditionsTable.tutorId, tutorId)
        )
      )
      .orderBy(desc(tutorCommercialConditionsTable.id));

    return rows;
  }

  /**
   * Gets a specific condition by ID.
   */
  static async getConditionById(
    crecheId: number,
    tutorId: number,
    conditionId: number,
    txClient: any = db
  ): Promise<TutorCommercialCondition | null> {
    const [condition] = await txClient
      .select()
      .from(tutorCommercialConditionsTable)
      .where(
        and(
          eq(tutorCommercialConditionsTable.id, conditionId),
          eq(tutorCommercialConditionsTable.crecheId, crecheId),
          eq(tutorCommercialConditionsTable.tutorId, tutorId)
        )
      )
      .limit(1);

    return condition ?? null;
  }

  // ─── Internal Helpers ─────────────────────────────────────────────────────────

  private static validateConditionValues(input: {
    conditionType: TutorConditionType;
    customPriceCents?: number | null;
    percentageBps?: number | null;
    fixedDiscountCents?: number | null;
  }): void {
    const { conditionType, customPriceCents, percentageBps, fixedDiscountCents } = input;

    if (!conditionType) {
      throw new TutorCommercialValidationError("Tipo de condição comercial é obrigatório.");
    }

    switch (conditionType) {
      case "CUSTOM_PRICE":
        if (customPriceCents == null || !Number.isInteger(customPriceCents) || customPriceCents < 0) {
          throw new TutorCommercialValidationError(
            "Preço fixo customizado inválido. Deve ser um número inteiro em centavos maior ou igual a 0."
          );
        }
        if (percentageBps != null || fixedDiscountCents != null) {
          throw new TutorCommercialValidationError(
            "Condição do tipo CUSTOM_PRICE não pode ter percentageBps ou fixedDiscountCents preenchidos."
          );
        }
        break;

      case "PERCENTAGE_DISCOUNT":
        if (
          percentageBps == null ||
          !Number.isInteger(percentageBps) ||
          percentageBps < 0 ||
          percentageBps > 10000
        ) {
          throw new TutorCommercialValidationError(
            "Percentual de desconto inválido. Deve ser entre 0 e 10000 pontos-base (0% a 100%)."
          );
        }
        if (customPriceCents != null || fixedDiscountCents != null) {
          throw new TutorCommercialValidationError(
            "Condição do tipo PERCENTAGE_DISCOUNT não pode ter customPriceCents ou fixedDiscountCents preenchidos."
          );
        }
        break;

      case "FIXED_DISCOUNT":
        if (
          fixedDiscountCents == null ||
          !Number.isInteger(fixedDiscountCents) ||
          fixedDiscountCents < 0
        ) {
          throw new TutorCommercialValidationError(
            "Valor de desconto fixo inválido. Deve ser um número inteiro em centavos maior ou igual a 0."
          );
        }
        if (customPriceCents != null || percentageBps != null) {
          throw new TutorCommercialValidationError(
            "Condição do tipo FIXED_DISCOUNT não pode ter customPriceCents ou percentageBps preenchidos."
          );
        }
        break;

      default:
        throw new TutorCommercialValidationError(`Tipo de condição comercial inválido: ${conditionType}`);
    }
  }

  private static computePayloadHash(payload: Record<string, any>): string {
    const canonical = JSON.stringify(payload, Object.keys(payload).sort());
    return crypto.createHash("sha256").update(canonical).digest("hex");
  }

  private static async findIdempotentOperation(
    crecheId: number,
    idempotencyKey: string,
    txClient: any
  ) {
    const [op] = await txClient
      .select()
      .from(tutorCommercialOperationsTable)
      .where(
        and(
          eq(tutorCommercialOperationsTable.crecheId, crecheId),
          eq(tutorCommercialOperationsTable.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1);

    return op ?? null;
  }
}
