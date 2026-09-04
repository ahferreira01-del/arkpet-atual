import { db } from "@workspace/db";
import { commercialAuditLedgerTable, type CommercialAuditActorType, type CommercialAuditLedger } from "@workspace/db/schema";

export class CommercialAuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommercialAuditError";
  }
}

export interface LogCommercialAuditParams {
  targetCrecheId: number;
  actorType: CommercialAuditActorType;
  actorId?: number | null;
  actorRole?: string | null;
  actorEmail?: string | null;
  action: string;
  reason?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  executionRequirement?: string | null;
  executionStatus?: string | null;
  relatedAgreementId?: number | null;
  relatedConditionId?: number | null;
}

const VALID_ACTOR_TYPES: CommercialAuditActorType[] = ["user", "system", "gateway"];

/**
 * Appends a durable commercial audit entry.
 * Invariants:
 * - actorType must be 'user', 'system', or 'gateway'.
 * - When actorType === 'user', reason is strictly required and non-empty.
 * - SYSTEM and GATEWAY actors do not require a human reason.
 * - Supports executing inside an optional transaction (caller handles tx boundary).
 * - Never swallows database errors.
 */
export async function logCommercialAudit(
  entry: LogCommercialAuditParams,
  dbOrTx: any = db,
): Promise<CommercialAuditLedger> {
  if (!VALID_ACTOR_TYPES.includes(entry.actorType)) {
    throw new CommercialAuditError(
      `Invalid actorType "${entry.actorType}". Must be one of: ${VALID_ACTOR_TYPES.join(", ")}`,
    );
  }

  if (entry.actorType === "user") {
    if (!entry.reason || entry.reason.trim().length === 0) {
      throw new CommercialAuditError(
        "Commercial audit error: privileged USER mutations strictly require a justification reason.",
      );
    }
  }

  const [inserted] = await dbOrTx
    .insert(commercialAuditLedgerTable)
    .values({
      targetCrecheId: entry.targetCrecheId,
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      actorRole: entry.actorRole ?? null,
      actorEmail: entry.actorEmail ?? null,
      action: entry.action,
      reason: entry.reason ? entry.reason.trim() : null,
      beforeState: entry.beforeState ?? null,
      afterState: entry.afterState ?? null,
      executionRequirement: entry.executionRequirement ?? null,
      executionStatus: entry.executionStatus ?? null,
      relatedAgreementId: entry.relatedAgreementId ?? null,
      relatedConditionId: entry.relatedConditionId ?? null,
    })
    .returning();

  return inserted;
}
