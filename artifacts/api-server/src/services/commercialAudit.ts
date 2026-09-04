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
  requiresReason?: boolean;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  executionRequirement?: string | null;
  executionStatus?: string | null;
  relatedAgreementId?: number | null;
  relatedConditionId?: number | null;
}

const VALID_ACTOR_TYPES: CommercialAuditActorType[] = ["user", "system", "gateway"];
const PRIVILEGED_ROLES = ["master_admin"];
const SELF_SERVICE_ACTIONS = [
  "proposal_acceptance",
  "proposal_decline",
  "opt_in_promotion",
  "customer_acceptance",
  "customer_decline",
];

/**
 * Determines whether a commercial action is a privileged administrative mutation
 * requiring a mandatory human justification reason.
 */
export function isPrivilegedCommercialMutation(entry: LogCommercialAuditParams): boolean {
  if (entry.requiresReason !== undefined) {
    return entry.requiresReason;
  }
  if (entry.actorType !== "user") {
    return false;
  }
  if (entry.actorRole && PRIVILEGED_ROLES.includes(entry.actorRole)) {
    return !SELF_SERVICE_ACTIONS.includes(entry.action);
  }
  return false;
}

/**
 * Appends a durable commercial audit entry.
 * Invariants:
 * - actorType must be 'user', 'system', or 'gateway'.
 * - Privileged administrative mutations (e.g. master_admin price/plan overrides)
 *   strictly require a justification reason.
 * - Customer self-service events (e.g. creche_admin proposal acceptance) and
 *   SYSTEM / GATEWAY events do NOT require a human reason.
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

  if (isPrivilegedCommercialMutation(entry)) {
    if (!entry.reason || entry.reason.trim().length === 0) {
      throw new CommercialAuditError(
        `Commercial audit error: privileged administrative mutation (${entry.action}) by ${entry.actorRole || "user"} strictly requires a justification reason.`,
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
