import { db as defaultDb } from "@workspace/db";
import {
  subscriptionsTable,
  plansTable,
  planVersionsTable,
  unresolvedSubscriptionVersionsTable,
  petsTable,
  usersTable,
  crecheInvitationsTable,
  tenantStorageLedgerTable,
  storageFilesTable,
  type TenantStorageLedger,
  type StorageFileStatus,
} from "@workspace/db/schema";
import { eq, and, inArray, count, sql } from "drizzle-orm";
import { resolveActiveCommercialCondition } from "./commercialConditions.js";

export type DbExecutor = any;

export class EntitlementsError extends Error {
  public code: string;
  public statusCode: number;

  constructor(code: string, message: string, statusCode: number = 400) {
    super(message);
    this.name = "EntitlementsError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type QuotaResource = "pets" | "staff" | "storage";
export const QUOTA_RESOURCES = ["pets", "staff", "storage"] as const;

export type CommercialBindingStatus = "bound" | "unresolved_legacy_contract";

export interface ResolvedEntitlements {
  crecheId: number;
  planId: number;
  planVersionId: number | null;
  commercialBindingStatus: CommercialBindingStatus;
  petLimit: number;
  staffLimit: number | null;
  staffUnlimited: boolean;
  storageBytesLimit: number | null;
  storageBypassed: boolean;
  staffBypassed: boolean;
  bypassedReason: string | null;
  activeConditionId: number | null;
  source: {
    pet: "commercial_override" | "plan_version" | "legacy_plan";
    staff: "commercial_override" | "plan_version" | "legacy_fail_open";
    storage: "commercial_override" | "plan_version" | "legacy_fail_open";
  };
}

export interface QuotaCheckOptions {
  crecheId: number;
  resource: QuotaResource;
  requestedDelta?: number;
  targetPlanVersionId?: number;
}

export interface QuotaCheckResult {
  resource: QuotaResource;
  allowed: boolean;
  used: number;
  limit: number | null;
  remaining: number | null;
  requestedDelta: number;
  percentUsed: number | null;
  warning80: boolean;
  unlimited: boolean;
  enforcementBypassed: boolean;
  enforcementReason: string | null;
  planVersionId: number | null;
  commercialBindingStatus: CommercialBindingStatus | string;
  // Storage-specific fields
  usedBytes?: number;
  reservedBytes?: number;
  effectiveUsedBytes?: number;
  limitBytes?: number | null;
  availableBytes?: number | null;
}

export type ScheduleClassification =
  | "PENDING"
  | "LEGACY_PENDING"
  | "NO_SCHEDULE"
  | "FAILED_OVER_QUOTA";

export interface CreationQuotaCheckResult extends QuotaCheckResult {
  currentLimit?: number | null;
  scheduledTargetLimit?: number | null;
  effectiveLimit?: number | null;
  scheduleClassification?: ScheduleClassification;
}

export type StorageEnforcementMode = "AUDIT" | "SHADOW" | "ENFORCE";

/**
 * Canonical resolver for STORAGE_ENFORCEMENT_MODE.
 * Normalizes mode string and enforces failure policies for missing or invalid values.
 */
export function resolveStorageEnforcementMode(env: NodeJS.ProcessEnv = process.env): StorageEnforcementMode {
  const rawMode = env.STORAGE_ENFORCEMENT_MODE;
  if (!rawMode || rawMode.trim() === "") {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "STORAGE_ENFORCEMENT_MODE_REQUIRED: STORAGE_ENFORCEMENT_MODE environment variable is required in production (AUDIT, SHADOW, or ENFORCE)."
      );
    }
    return "AUDIT";
  }

  const normalized = rawMode.trim().toUpperCase();
  if (normalized === "AUDIT" || normalized === "SHADOW" || normalized === "ENFORCE") {
    return normalized as StorageEnforcementMode;
  }

  throw new Error(
    `STORAGE_ENFORCEMENT_MODE_INVALID: Invalid STORAGE_ENFORCEMENT_MODE '${rawMode}'. Must be one of: AUDIT, SHADOW, ENFORCE.`
  );
}

export interface CreateStorageReservationInput {
  crecheId: number;
  fileKey: string;
  requestedBytes: number;
  contentType: string;
  reservationTtlMinutes?: number;
  enforceHardLimit?: boolean;
}

/**
 * Resolves authoritative entitlements for a tenant subscription.
 * Precedence:
 * 1. Commercial condition override (if active condition exists & field is non-null)
 * 2. Exact bound plan_version (planVersionId)
 *
 * If planVersionId is null:
 * - If recognized as "unresolved_legacy_contract": pets fall back to plansTable.petLimit, staff & storage fail-open.
 * - Otherwise: throws ERR_ENTITLEMENT_BINDING_MISSING.
 */
export async function resolveEntitlements(
  tx: DbExecutor = defaultDb,
  crecheId: number,
): Promise<ResolvedEntitlements> {
  const [sub] = await tx
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.crecheId, crecheId))
    .limit(1);

  if (!sub) {
    throw new EntitlementsError(
      "ERR_SUBSCRIPTION_NOT_FOUND",
      `Subscription for creche #${crecheId} not found.`,
      404,
    );
  }

  // Handle unbound subscription (planVersionId == null)
  if (sub.planVersionId == null) {
    // Authoritative legacy classification requires POSITIVE unresolved evidence from R38.B.
    // NULL contracted price alone is NOT sufficient evidence to grant fail-open entitlement.
    const [unresolvedRow] = await tx
      .select()
      .from(unresolvedSubscriptionVersionsTable)
      .where(
        and(
          eq(unresolvedSubscriptionVersionsTable.subscriptionId, sub.id),
          sql`${unresolvedSubscriptionVersionsTable.resolvedAt} IS NULL`,
        ),
      )
      .limit(1);

    if (!unresolvedRow) {
      throw new EntitlementsError(
        "ERR_ENTITLEMENT_BINDING_MISSING",
        `Subscription #${sub.id} for creche #${crecheId} has no planVersionId and no positive unresolved legacy contract evidence in unresolved_subscription_versions.`,
        400,
      );
    }

    // Unresolved legacy contract:
    // PETS: resolve from mutable plans.petLimit (or commercial override)
    // STAFF: fail-open
    // STORAGE: fail-open
    const [plan] = await tx
      .select()
      .from(plansTable)
      .where(eq(plansTable.id, sub.planId))
      .limit(1);

    if (!plan) {
      throw new EntitlementsError(
        "ERR_PLAN_NOT_FOUND",
        `Plan #${sub.planId} for subscription #${sub.id} not found.`,
        404,
      );
    }

    let petLimit = plan.petLimit;
    let petSource: "commercial_override" | "legacy_plan" = "legacy_plan";

    if (sub.activeConditionId) {
      const condition = await resolveActiveCommercialCondition(crecheId, sub.activeConditionId, tx);
      if (condition?.entitlementPetLimit && condition.entitlementPetLimit > 0) {
        petLimit = condition.entitlementPetLimit;
        petSource = "commercial_override";
      }
    }

    return {
      crecheId,
      planId: sub.planId,
      planVersionId: null,
      commercialBindingStatus: "unresolved_legacy_contract",
      petLimit,
      staffLimit: null,
      staffUnlimited: false,
      storageBytesLimit: null,
      storageBypassed: true,
      staffBypassed: true,
      bypassedReason: "UNRESOLVED_LEGACY_CONTRACT",
      activeConditionId: sub.activeConditionId,
      source: {
        pet: petSource,
        staff: "legacy_fail_open",
        storage: "legacy_fail_open",
      },
    };
  }

  // Bound plan version: resolve exact bound plan_version
  const [planVersion] = await tx
    .select()
    .from(planVersionsTable)
    .where(eq(planVersionsTable.id, sub.planVersionId))
    .limit(1);

  if (!planVersion) {
    throw new EntitlementsError(
      "ERR_PLAN_VERSION_NOT_FOUND",
      `Bound plan version #${sub.planVersionId} for subscription #${sub.id} not found.`,
      404,
    );
  }

  let petLimit = planVersion.petLimit;
  let petSource: "commercial_override" | "plan_version" = "plan_version";

  let staffLimit = planVersion.staffLimit;
  let staffUnlimited = planVersion.staffLimit === null;
  let staffSource: "commercial_override" | "plan_version" = "plan_version";

  let storageBytesLimit: number = Number(planVersion.storageBytesLimit);
  let storageSource: "commercial_override" | "plan_version" = "plan_version";

  // Level 1: Commercial Condition Override (if active)
  if (sub.activeConditionId) {
    const condition = await resolveActiveCommercialCondition(crecheId, sub.activeConditionId, tx);
    if (condition) {
      // Pet override
      if (
        condition.entitlementPetLimit !== null &&
        condition.entitlementPetLimit !== undefined &&
        condition.entitlementPetLimit > 0
      ) {
        petLimit = condition.entitlementPetLimit;
        petSource = "commercial_override";
      }
      // Staff override: finite non-negative integer only (null means NO override, never unlimited)
      if (
        condition.entitlementStaffLimit !== null &&
        condition.entitlementStaffLimit !== undefined &&
        condition.entitlementStaffLimit >= 0
      ) {
        staffLimit = condition.entitlementStaffLimit;
        staffUnlimited = false;
        staffSource = "commercial_override";
      }
      // Storage override: finite positive bytes only (null means NO override)
      if (
        condition.entitlementStorageBytesLimit !== null &&
        condition.entitlementStorageBytesLimit !== undefined &&
        Number(condition.entitlementStorageBytesLimit) > 0
      ) {
        storageBytesLimit = Number(condition.entitlementStorageBytesLimit);
        storageSource = "commercial_override";
      }
    }
  }

  return {
    crecheId,
    planId: sub.planId,
    planVersionId: sub.planVersionId,
    commercialBindingStatus: "bound",
    petLimit,
    staffLimit,
    staffUnlimited,
    storageBytesLimit,
    storageBypassed: false,
    staffBypassed: false,
    bypassedReason: null,
    activeConditionId: sub.activeConditionId,
    source: {
      pet: petSource,
      staff: staffSource,
      storage: storageSource,
    },
  };
}

/**
 * Calculates current active pet count for creche.
 * COUNT pets WHERE creche_id = :crecheId AND status = 'active'.
 */
export async function getPetUsage(
  tx: DbExecutor = defaultDb,
  crecheId: number,
): Promise<number> {
  const [res] = await tx
    .select({ total: count() })
    .from(petsTable)
    .where(and(eq(petsTable.crecheId, crecheId), eq(petsTable.status, "active")));

  return Number(res?.total ?? 0);
}

/**
 * Calculates current active staff usage:
 * Active users with role in ('creche_admin', 'staff') AND is_active = true
 * PLUS valid pending invitations with role in ('creche_admin', 'staff') AND expires_at > NOW().
 */
export async function getStaffUsage(
  tx: DbExecutor = defaultDb,
  crecheId: number,
): Promise<number> {
  const [userStaff] = await tx
    .select({ total: count() })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.crecheId, crecheId),
        inArray(usersTable.role, ["creche_admin", "staff"]),
        eq(usersTable.isActive, true),
      ),
    );

  const [invStaff] = await tx
    .select({ total: count() })
    .from(crecheInvitationsTable)
    .where(
      and(
        eq(crecheInvitationsTable.crecheId, crecheId),
        inArray(crecheInvitationsTable.role, ["creche_admin", "staff"]),
        eq(crecheInvitationsTable.status, "pending"),
        sql`${crecheInvitationsTable.expiresAt} > NOW()`,
      ),
    );

  return Number(userStaff?.total ?? 0) + Number(invStaff?.total ?? 0);
}

/**
 * Reads storage accounting from tenant_storage_ledger.
 */
export async function getStorageUsage(
  tx: DbExecutor = defaultDb,
  crecheId: number,
): Promise<{
  usedBytes: number;
  reservedBytes: number;
  effectiveUsedBytes: number;
  fileCount: number;
}> {
  const [ledger] = await tx
    .select()
    .from(tenantStorageLedgerTable)
    .where(eq(tenantStorageLedgerTable.crecheId, crecheId))
    .limit(1);

  const usedBytes = Number(ledger?.usedBytes ?? 0);
  const reservedBytes = Number(ledger?.reservedBytes ?? 0);
  const fileCount = Number(ledger?.fileCount ?? 0);

  return {
    usedBytes,
    reservedBytes,
    effectiveUsedBytes: usedBytes + reservedBytes,
    fileCount,
  };
}

/**
 * Evaluates quota admission for a given resource and delta.
 */
export async function checkQuota(
  tx: DbExecutor = defaultDb,
  options: QuotaCheckOptions,
): Promise<QuotaCheckResult> {
  const requestedDelta = options.requestedDelta ?? 0;
  if (typeof requestedDelta !== "number" || !Number.isInteger(requestedDelta) || requestedDelta < 0) {
    throw new EntitlementsError(
      "ERR_INVALID_REQUESTED_DELTA",
      "Requested delta must be a non-negative integer.",
      400,
    );
  }

  if (!QUOTA_RESOURCES.includes(options.resource)) {
    throw new EntitlementsError(
      "ERR_INVALID_RESOURCE",
      `Resource must be one of: ${QUOTA_RESOURCES.join(", ")}`,
      400,
    );
  }

  let entitlements: ResolvedEntitlements;

  if (options.targetPlanVersionId) {
    // Target plan version resolution (used for downgrade checks)
    const [targetVersion] = await tx
      .select()
      .from(planVersionsTable)
      .where(eq(planVersionsTable.id, options.targetPlanVersionId))
      .limit(1);

    if (!targetVersion) {
      throw new EntitlementsError(
        "ERR_TARGET_PLAN_VERSION_NOT_FOUND",
        `Target plan version #${options.targetPlanVersionId} not found.`,
        404,
      );
    }

    entitlements = {
      crecheId: options.crecheId,
      planId: targetVersion.planId,
      planVersionId: targetVersion.id,
      commercialBindingStatus: "bound",
      petLimit: targetVersion.petLimit,
      staffLimit: targetVersion.staffLimit,
      staffUnlimited: targetVersion.staffLimit === null,
      storageBytesLimit: Number(targetVersion.storageBytesLimit),
      storageBypassed: false,
      staffBypassed: false,
      bypassedReason: null,
      activeConditionId: null,
      source: {
        pet: "plan_version",
        staff: "plan_version",
        storage: "plan_version",
      },
    };
  } else {
    entitlements = await resolveEntitlements(tx, options.crecheId);
  }

  if (options.resource === "pets") {
    const used = await getPetUsage(tx, options.crecheId);
    const limit = entitlements.petLimit;
    const projected = used + requestedDelta;
    const allowed = projected <= limit;
    const remaining = Math.max(0, limit - projected);
    const percentUsed = limit > 0 ? Math.floor((used * 100) / limit) : 0;
    const warning80 = limit > 0 ? used >= Math.floor((limit * 80) / 100) : false;

    return {
      resource: "pets",
      allowed,
      used,
      limit,
      remaining,
      requestedDelta,
      percentUsed,
      warning80,
      unlimited: false,
      enforcementBypassed: false,
      enforcementReason: null,
      planVersionId: entitlements.planVersionId,
      commercialBindingStatus: entitlements.commercialBindingStatus,
    };
  }

  if (options.resource === "staff") {
    const used = await getStaffUsage(tx, options.crecheId);

    if (entitlements.staffBypassed) {
      return {
        resource: "staff",
        allowed: true,
        used,
        limit: null,
        remaining: null,
        requestedDelta,
        percentUsed: null,
        warning80: false,
        unlimited: false,
        enforcementBypassed: true,
        enforcementReason: "UNRESOLVED_LEGACY_CONTRACT",
        planVersionId: entitlements.planVersionId,
        commercialBindingStatus: entitlements.commercialBindingStatus,
      };
    }

    if (entitlements.staffUnlimited) {
      return {
        resource: "staff",
        allowed: true,
        used,
        limit: null,
        remaining: null,
        requestedDelta,
        percentUsed: null,
        warning80: false,
        unlimited: true,
        enforcementBypassed: false,
        enforcementReason: null,
        planVersionId: entitlements.planVersionId,
        commercialBindingStatus: entitlements.commercialBindingStatus,
      };
    }

    const limit = entitlements.staffLimit!;
    const projected = used + requestedDelta;
    const allowed = projected <= limit;
    const remaining = Math.max(0, limit - projected);
    const percentUsed = limit > 0 ? Math.floor((used * 100) / limit) : 0;
    const warning80 = limit > 0 ? used >= Math.floor((limit * 80) / 100) : false;

    return {
      resource: "staff",
      allowed,
      used,
      limit,
      remaining,
      requestedDelta,
      percentUsed,
      warning80,
      unlimited: false,
      enforcementBypassed: false,
      enforcementReason: null,
      planVersionId: entitlements.planVersionId,
      commercialBindingStatus: entitlements.commercialBindingStatus,
    };
  }

  // Storage
  const storageUsage = await getStorageUsage(tx, options.crecheId);

  if (entitlements.storageBypassed) {
    return {
      resource: "storage",
      allowed: true,
      used: storageUsage.effectiveUsedBytes,
      limit: null,
      remaining: null,
      requestedDelta,
      percentUsed: null,
      warning80: false,
      unlimited: false,
      enforcementBypassed: true,
      enforcementReason: "UNRESOLVED_LEGACY_CONTRACT",
      planVersionId: entitlements.planVersionId,
      commercialBindingStatus: entitlements.commercialBindingStatus,
      usedBytes: storageUsage.usedBytes,
      reservedBytes: storageUsage.reservedBytes,
      effectiveUsedBytes: storageUsage.effectiveUsedBytes,
      limitBytes: null,
      availableBytes: null,
    };
  }

  const limitBytes = entitlements.storageBytesLimit!;
  const effectiveUsedBytes = storageUsage.effectiveUsedBytes;
  const projectedBytes = effectiveUsedBytes + requestedDelta;
  const allowed = projectedBytes <= limitBytes;
  const remaining = Math.max(0, limitBytes - projectedBytes);
  const availableBytes = Math.max(0, limitBytes - effectiveUsedBytes);
  const percentUsed = limitBytes > 0 ? Math.floor((effectiveUsedBytes * 100) / limitBytes) : 0;
  const warning80 = limitBytes > 0 ? effectiveUsedBytes >= Math.floor((limitBytes * 80) / 100) : false;

  return {
    resource: "storage",
    allowed,
    used: effectiveUsedBytes,
    limit: limitBytes,
    remaining,
    requestedDelta,
    percentUsed,
    warning80,
    unlimited: false,
    enforcementBypassed: false,
    enforcementReason: null,
    planVersionId: entitlements.planVersionId,
    commercialBindingStatus: entitlements.commercialBindingStatus,
    usedBytes: storageUsage.usedBytes,
    reservedBytes: storageUsage.reservedBytes,
    effectiveUsedBytes,
    limitBytes,
    availableBytes,
  };
}

/**
 * Dedicated quota admission gate exclusively for quota-increasing runtime mutations (OPEN-C-01).
 * Resolves current entitlement (respecting commercial overrides and legacy fallback),
 * inspects subscriptions table for scheduled plan version snapshots, classifies schedule (4-way),
 * and enforces effectiveCreationLimit = min(currentLimit, scheduledTargetLimit) when schedule is PENDING or LEGACY_PENDING.
 */
export async function checkCreationQuota(
  tx: DbExecutor = defaultDb,
  options: QuotaCheckOptions,
): Promise<CreationQuotaCheckResult> {
  const requestedDelta = options.requestedDelta ?? 0;
  if (typeof requestedDelta !== "number" || !Number.isInteger(requestedDelta) || requestedDelta < 0) {
    throw new EntitlementsError(
      "ERR_INVALID_REQUESTED_DELTA",
      "Requested delta must be a non-negative integer.",
      400,
    );
  }

  if (!QUOTA_RESOURCES.includes(options.resource)) {
    throw new EntitlementsError(
      "ERR_INVALID_RESOURCE",
      `Resource must be one of: ${QUOTA_RESOURCES.join(", ")}`,
      400,
    );
  }

  // 1. Resolve current active entitlement (precedence: active commercial override > bound version > unresolved legacy)
  const currentEntitlements = await resolveEntitlements(tx, options.crecheId);

  // 2. Query subscription scheduled downgrade state
  const [sub] = await tx
    .select({
      id: subscriptionsTable.id,
      scheduledStatus: subscriptionsTable.scheduledStatus,
      scheduledPlanVersionId: subscriptionsTable.scheduledPlanVersionId,
      scheduledPlanId: subscriptionsTable.scheduledPlanId,
    })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.crecheId, options.crecheId))
    .limit(1);

  // 3. 4-Way Schedule Classification
  let scheduleClassification: ScheduleClassification = "NO_SCHEDULE";
  if (
    sub?.scheduledStatus === "PENDING" &&
    sub.scheduledPlanVersionId != null &&
    sub.scheduledPlanId != null
  ) {
    scheduleClassification = "PENDING";
  } else if (
    sub?.scheduledStatus == null &&
    sub?.scheduledPlanVersionId != null &&
    sub?.scheduledPlanId != null
  ) {
    scheduleClassification = "LEGACY_PENDING";
  } else if (sub?.scheduledStatus === "FAILED_OVER_QUOTA") {
    scheduleClassification = "FAILED_OVER_QUOTA";
  } else {
    scheduleClassification = "NO_SCHEDULE";
  }

  const isClamped =
    scheduleClassification === "PENDING" || scheduleClassification === "LEGACY_PENDING";

  // If not clamped: evaluate strictly against current active entitlements
  if (!isClamped) {
    const rawResult = await checkQuota(tx, {
      crecheId: options.crecheId,
      resource: options.resource,
      requestedDelta,
    });

    return {
      ...rawResult,
      currentLimit: rawResult.limit,
      scheduledTargetLimit: null,
      effectiveLimit: rawResult.limit,
      scheduleClassification,
    };
  }

  // Clamped (PENDING or LEGACY_PENDING): resolve target version immutable quotas
  const [targetVersion] = await tx
    .select()
    .from(planVersionsTable)
    .where(eq(planVersionsTable.id, sub!.scheduledPlanVersionId!))
    .limit(1);

  if (!targetVersion) {
    throw new EntitlementsError(
      "ERR_TARGET_PLAN_VERSION_NOT_FOUND",
      `Scheduled plan version #${sub!.scheduledPlanVersionId} not found.`,
      404,
    );
  }

  if (options.resource === "pets") {
    const used = await getPetUsage(tx, options.crecheId);
    const currentLimit = currentEntitlements.petLimit;
    const targetLimit = targetVersion.petLimit;
    const effectiveLimit = Math.min(currentLimit, targetLimit);
    const projected = used + requestedDelta;
    const allowed = projected <= effectiveLimit;
    const remaining = Math.max(0, effectiveLimit - projected);
    const percentUsed = effectiveLimit > 0 ? Math.floor((used * 100) / effectiveLimit) : 0;
    const warning80 = effectiveLimit > 0 ? used >= Math.floor((effectiveLimit * 80) / 100) : false;

    return {
      resource: "pets",
      allowed,
      used,
      limit: effectiveLimit,
      remaining,
      requestedDelta,
      percentUsed,
      warning80,
      unlimited: false,
      enforcementBypassed: false,
      enforcementReason: null,
      planVersionId: currentEntitlements.planVersionId,
      commercialBindingStatus: currentEntitlements.commercialBindingStatus,
      currentLimit,
      scheduledTargetLimit: targetLimit,
      effectiveLimit,
      scheduleClassification,
    };
  }

  if (options.resource === "staff") {
    const used = await getStaffUsage(tx, options.crecheId);
    const currentLimit = currentEntitlements.staffBypassed ? null : currentEntitlements.staffLimit;
    const currentUnlimited = currentEntitlements.staffUnlimited;
    const targetLimit = targetVersion.staffLimit;
    const targetUnlimited = targetVersion.staffLimit === null;

    let effectiveLimit: number | null = null;
    let isUnlimited = false;

    if (!currentUnlimited && targetUnlimited) {
      effectiveLimit = currentLimit;
      isUnlimited = false;
    } else if (currentUnlimited && !targetUnlimited) {
      effectiveLimit = targetLimit;
      isUnlimited = false;
    } else if (currentUnlimited && targetUnlimited) {
      effectiveLimit = null;
      isUnlimited = true;
    } else {
      effectiveLimit = Math.min(currentLimit!, targetLimit!);
      isUnlimited = false;
    }

    let allowed = true;
    let remaining: number | null = null;
    let percentUsed: number | null = null;
    let warning80 = false;

    if (!isUnlimited && effectiveLimit !== null) {
      const projected = used + requestedDelta;
      allowed = projected <= effectiveLimit;
      remaining = Math.max(0, effectiveLimit - projected);
      percentUsed = effectiveLimit > 0 ? Math.floor((used * 100) / effectiveLimit) : 0;
      warning80 = effectiveLimit > 0 ? used >= Math.floor((effectiveLimit * 80) / 100) : false;
    }

    return {
      resource: "staff",
      allowed,
      used,
      limit: effectiveLimit,
      remaining,
      requestedDelta,
      percentUsed,
      warning80,
      unlimited: isUnlimited,
      enforcementBypassed: false,
      enforcementReason: null,
      planVersionId: currentEntitlements.planVersionId,
      commercialBindingStatus: currentEntitlements.commercialBindingStatus,
      currentLimit: currentUnlimited ? null : currentLimit,
      scheduledTargetLimit: targetUnlimited ? null : targetLimit,
      effectiveLimit,
      scheduleClassification,
    };
  }

  // Storage
  const storageUsage = await getStorageUsage(tx, options.crecheId);
  const effectiveUsedBytes = storageUsage.effectiveUsedBytes;
  const currentLimit = currentEntitlements.storageBypassed ? null : currentEntitlements.storageBytesLimit;
  const targetLimit = Number(targetVersion.storageBytesLimit);
  const effectiveLimit = currentLimit !== null ? Math.min(currentLimit, targetLimit) : targetLimit;

  const projectedBytes = effectiveUsedBytes + requestedDelta;
  const allowed = projectedBytes <= effectiveLimit;
  const remaining = Math.max(0, effectiveLimit - projectedBytes);
  const availableBytes = Math.max(0, effectiveLimit - effectiveUsedBytes);
  const percentUsed = effectiveLimit > 0 ? Math.floor((effectiveUsedBytes * 100) / effectiveLimit) : 0;
  const warning80 = effectiveLimit > 0 ? effectiveUsedBytes >= Math.floor((effectiveLimit * 80) / 100) : false;

  return {
    resource: "storage",
    allowed,
    used: effectiveUsedBytes,
    limit: effectiveLimit,
    remaining,
    requestedDelta,
    percentUsed,
    warning80,
    unlimited: false,
    enforcementBypassed: false,
    enforcementReason: null,
    planVersionId: currentEntitlements.planVersionId,
    commercialBindingStatus: currentEntitlements.commercialBindingStatus,
    usedBytes: storageUsage.usedBytes,
    reservedBytes: storageUsage.reservedBytes,
    effectiveUsedBytes,
    limitBytes: effectiveLimit,
    availableBytes,
    currentLimit,
    scheduledTargetLimit: targetLimit,
    effectiveLimit,
    scheduleClassification,
  };
}

/**
 * Idempotently ensures that a tenant ledger row exists in tenant_storage_ledger.
 */
export async function ensureTenantStorageLedger(
  tx: DbExecutor,
  crecheId: number,
): Promise<TenantStorageLedger> {
  await tx.execute(sql`
    INSERT INTO tenant_storage_ledger (creche_id, used_bytes, reserved_bytes, file_count, updated_at)
    VALUES (${crecheId}, 0, 0, 0, NOW())
    ON CONFLICT (creche_id) DO NOTHING
  `);

  const [ledger] = await tx
    .select()
    .from(tenantStorageLedgerTable)
    .where(eq(tenantStorageLedgerTable.crecheId, crecheId))
    .limit(1);

  return ledger;
}

/**
 * Creates an upload reservation in storage_files and increments reserved_bytes in tenant_storage_ledger.
 * Executed atomically in the caller-supplied transaction.
 */
export async function createStorageReservation(
  tx: DbExecutor,
  input: CreateStorageReservationInput,
): Promise<{
  file: typeof storageFilesTable.$inferSelect;
  quota: QuotaCheckResult;
}> {
  const { crecheId, fileKey, requestedBytes, contentType } = input;
  if (!crecheId || !fileKey || !contentType) {
    throw new EntitlementsError(
      "ERR_INVALID_RESERVATION_INPUT",
      "crecheId, fileKey, and contentType are required.",
      400,
    );
  }

  if (
    typeof requestedBytes !== "number" ||
    !Number.isInteger(requestedBytes) ||
    requestedBytes <= 0
  ) {
    throw new EntitlementsError(
      "ERR_INVALID_STORAGE_BYTES",
      "requestedBytes must be a positive integer.",
      400,
    );
  }

  await ensureTenantStorageLedger(tx, crecheId);

  // Lock tenant ledger row for update to serialize reservations
  await tx.execute(sql`
    SELECT * FROM tenant_storage_ledger
    WHERE creche_id = ${crecheId}
    FOR UPDATE
  `);

  // Check quota with requestedBytes using checkCreationQuota (OPEN-C-01)
  const quota = await checkCreationQuota(tx, {
    crecheId,
    resource: "storage",
    requestedDelta: requestedBytes,
  });

  const shouldEnforce = input.enforceHardLimit !== false;
  if (shouldEnforce && !quota.allowed && !quota.enforcementBypassed) {
    throw new EntitlementsError(
      "ERR_STORAGE_QUOTA_EXCEEDED",
      `Storage quota exceeded. Requested: ${requestedBytes} bytes, Available: ${quota.availableBytes ?? 0} bytes.`,
      400,
    );
  }

  const ttlMinutes = input.reservationTtlMinutes ?? 15;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  // Insert storage_files row: status = 'reserved'
  const [file] = await tx
    .insert(storageFilesTable)
    .values({
      crecheId,
      fileKey,
      sizeBytes: requestedBytes,
      contentType,
      status: "reserved",
      reservationExpiresAt: expiresAt,
      updatedAt: new Date(),
    })
    .returning();

  // Increment reserved_bytes on ledger
  await tx
    .update(tenantStorageLedgerTable)
    .set({
      reservedBytes: sql`${tenantStorageLedgerTable.reservedBytes} + ${requestedBytes}`,
      updatedAt: new Date(),
    })
    .where(eq(tenantStorageLedgerTable.crecheId, crecheId));

  return { file, quota };
}

/**
 * Reconciles upload confirmation.
 * CAS transition from 'reserved' -> 'confirmed' or 'rejected_overflow_deleting'.
 */
export async function confirmStorageReservation(
  tx: DbExecutor,
  fileId: string,
  actualBytes: number,
): Promise<{
  status: "confirmed" | "rejected_overflow_deleting";
  file: typeof storageFilesTable.$inferSelect;
}> {
  if (
    typeof actualBytes !== "number" ||
    !Number.isInteger(actualBytes) ||
    actualBytes < 0
  ) {
    throw new EntitlementsError(
      "ERR_INVALID_STORAGE_BYTES",
      "actualBytes must be a non-negative integer.",
      400,
    );
  }

  const [file] = await tx
    .select()
    .from(storageFilesTable)
    .where(and(eq(storageFilesTable.id, fileId), eq(storageFilesTable.status, "reserved")))
    .limit(1);

  if (!file) {
    throw new EntitlementsError(
      "ERR_STORAGE_FILE_NOT_CLAIMABLE",
      `Storage file #${fileId} is not in reserved status or does not exist.`,
      409,
    );
  }

  // Lock ledger row
  await tx.execute(sql`
    SELECT * FROM tenant_storage_ledger
    WHERE creche_id = ${file.crecheId}
    FOR UPDATE
  `);

  const reservedSize = Number(file.sizeBytes);

  if (actualBytes <= reservedSize) {
    // Case 1 & 2: actualBytes <= reservedSize
    const [confirmedFile] = await tx
      .update(storageFilesTable)
      .set({
        status: "confirmed",
        sizeBytes: actualBytes,
        confirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(storageFilesTable.id, fileId), eq(storageFilesTable.status, "reserved")))
      .returning();

    if (!confirmedFile) {
      throw new EntitlementsError(
        "ERR_STORAGE_FILE_NOT_CLAIMABLE",
        `CAS update failed: Storage file #${fileId} was already claimed.`,
        409,
      );
    }

    // Release reservedBytes, add actualBytes to usedBytes, increment fileCount
    await tx
      .update(tenantStorageLedgerTable)
      .set({
        reservedBytes: sql`${tenantStorageLedgerTable.reservedBytes} - ${reservedSize}`,
        usedBytes: sql`${tenantStorageLedgerTable.usedBytes} + ${actualBytes}`,
        fileCount: sql`${tenantStorageLedgerTable.fileCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(tenantStorageLedgerTable.crecheId, file.crecheId));

    return { status: "confirmed", file: confirmedFile };
  } else {
    // Case 3: actualBytes > reservedSize
    const delta = actualBytes - reservedSize;
    const quota = await checkQuota(tx, {
      crecheId: file.crecheId,
      resource: "storage",
      requestedDelta: delta,
    });

    if (quota.allowed) {
      // Sub-case 3A: Quota allows additional delta
      const [confirmedFile] = await tx
        .update(storageFilesTable)
        .set({
          status: "confirmed",
          sizeBytes: actualBytes,
          confirmedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(storageFilesTable.id, fileId), eq(storageFilesTable.status, "reserved")))
        .returning();

      if (!confirmedFile) {
        throw new EntitlementsError(
          "ERR_STORAGE_FILE_NOT_CLAIMABLE",
          `CAS update failed: Storage file #${fileId} was already claimed.`,
          409,
        );
      }

      await tx
        .update(tenantStorageLedgerTable)
        .set({
          reservedBytes: sql`${tenantStorageLedgerTable.reservedBytes} - ${reservedSize}`,
          usedBytes: sql`${tenantStorageLedgerTable.usedBytes} + ${actualBytes}`,
          fileCount: sql`${tenantStorageLedgerTable.fileCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(tenantStorageLedgerTable.crecheId, file.crecheId));

      return { status: "confirmed", file: confirmedFile };
    } else {
      // Sub-case 3B: Overflow! Transition to rejected_overflow_deleting
      const [overflowFile] = await tx
        .update(storageFilesTable)
        .set({
          status: "rejected_overflow_deleting",
          sizeBytes: actualBytes,
          updatedAt: new Date(),
        })
        .where(and(eq(storageFilesTable.id, fileId), eq(storageFilesTable.status, "reserved")))
        .returning();

      if (!overflowFile) {
        throw new EntitlementsError(
          "ERR_STORAGE_FILE_NOT_CLAIMABLE",
          `CAS update failed: Storage file #${fileId} was already claimed.`,
          409,
        );
      }

      // Retain physical-byte-equivalent accounting in reserved_bytes
      await tx
        .update(tenantStorageLedgerTable)
        .set({
          reservedBytes: sql`${tenantStorageLedgerTable.reservedBytes} + ${delta}`,
          updatedAt: new Date(),
        })
        .where(eq(tenantStorageLedgerTable.crecheId, file.crecheId));

      return { status: "rejected_overflow_deleting", file: overflowFile };
    }
  }
}

/**
 * Claims a confirmed file for deletion:
 * CAS transition from 'confirmed' -> 'deleting'.
 */
export async function claimStorageFileForDeletion(
  tx: DbExecutor,
  fileId: string,
): Promise<typeof storageFilesTable.$inferSelect> {
  const [file] = await tx
    .update(storageFilesTable)
    .set({
      status: "deleting",
      updatedAt: new Date(),
    })
    .where(and(eq(storageFilesTable.id, fileId), eq(storageFilesTable.status, "confirmed")))
    .returning();

  if (!file) {
    throw new EntitlementsError(
      "ERR_STORAGE_FILE_NOT_CLAIMABLE",
      `Storage file #${fileId} is not in confirmed status or does not exist.`,
      409,
    );
  }

  return file;
}

/**
 * Finalizes file deletion after physical GCS deletion/404:
 * CAS transition from 'deleting' -> 'deleted' AND
 * used_bytes -= size_bytes, file_count -= 1.
 */
export async function finalizeStorageFileDeletion(
  tx: DbExecutor,
  fileId: string,
): Promise<typeof storageFilesTable.$inferSelect> {
  const [file] = await tx
    .update(storageFilesTable)
    .set({
      status: "deleted",
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(storageFilesTable.id, fileId), eq(storageFilesTable.status, "deleting")))
    .returning();

  if (!file) {
    throw new EntitlementsError(
      "ERR_STORAGE_FILE_NOT_CLAIMABLE",
      `Storage file #${fileId} is not in deleting status or does not exist.`,
      409,
    );
  }

  await tx
    .update(tenantStorageLedgerTable)
    .set({
      usedBytes: sql`${tenantStorageLedgerTable.usedBytes} - ${file.sizeBytes}`,
      fileCount: sql`${tenantStorageLedgerTable.fileCount} - 1`,
      updatedAt: new Date(),
    })
    .where(eq(tenantStorageLedgerTable.crecheId, file.crecheId));

  return file;
}

/**
 * Claims an expired reservation for cleanup:
 * CAS transition from 'reserved' -> 'expired_cleanup_deleting'
 * only if reservation_expires_at < NOW().
 */
export async function claimExpiredStorageReservation(
  tx: DbExecutor,
  fileId: string,
): Promise<typeof storageFilesTable.$inferSelect> {
  const [file] = await tx
    .update(storageFilesTable)
    .set({
      status: "expired_cleanup_deleting",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(storageFilesTable.id, fileId),
        eq(storageFilesTable.status, "reserved"),
        sql`${storageFilesTable.reservationExpiresAt} < NOW()`,
      ),
    )
    .returning();

  if (!file) {
    throw new EntitlementsError(
      "ERR_STORAGE_FILE_NOT_CLAIMABLE",
      `Storage file #${fileId} is not an expired reservation or does not exist.`,
      409,
    );
  }

  return file;
}

/**
 * Finalizes expired reservation cleanup after physical cleanup:
 * CAS transition from 'expired_cleanup_deleting' -> 'abandoned' AND
 * reserved_bytes -= size_bytes.
 */
export async function finalizeExpiredStorageReservation(
  tx: DbExecutor,
  fileId: string,
): Promise<typeof storageFilesTable.$inferSelect> {
  const [file] = await tx
    .update(storageFilesTable)
    .set({
      status: "abandoned",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(storageFilesTable.id, fileId),
        eq(storageFilesTable.status, "expired_cleanup_deleting"),
      ),
    )
    .returning();

  if (!file) {
    throw new EntitlementsError(
      "ERR_STORAGE_FILE_NOT_CLAIMABLE",
      `Storage file #${fileId} is not in expired_cleanup_deleting status or does not exist.`,
      409,
    );
  }

  await tx
    .update(tenantStorageLedgerTable)
    .set({
      reservedBytes: sql`${tenantStorageLedgerTable.reservedBytes} - ${file.sizeBytes}`,
      updatedAt: new Date(),
    })
    .where(eq(tenantStorageLedgerTable.crecheId, file.crecheId));

  return file;
}

/**
 * Finalizes rejected overflow cleanup:
 * CAS transition from 'rejected_overflow_deleting' -> 'rejected_overflow_deleted' AND
 * reserved_bytes -= accounted physical bytes.
 */
export async function finalizeRejectedOverflowFile(
  tx: DbExecutor,
  fileId: string,
): Promise<typeof storageFilesTable.$inferSelect> {
  const [file] = await tx
    .update(storageFilesTable)
    .set({
      status: "rejected_overflow_deleted",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(storageFilesTable.id, fileId),
        eq(storageFilesTable.status, "rejected_overflow_deleting"),
      ),
    )
    .returning();

  if (!file) {
    throw new EntitlementsError(
      "ERR_STORAGE_FILE_NOT_CLAIMABLE",
      `Storage file #${fileId} is not in rejected_overflow_deleting status or does not exist.`,
      409,
    );
  }

  await tx
    .update(tenantStorageLedgerTable)
    .set({
      reservedBytes: sql`${tenantStorageLedgerTable.reservedBytes} - ${file.sizeBytes}`,
      updatedAt: new Date(),
    })
    .where(eq(tenantStorageLedgerTable.crecheId, file.crecheId));

  return file;
}

export const EntitlementsService = {
  resolveEntitlements,
  getPetUsage,
  getStaffUsage,
  getStorageUsage,
  checkQuota,
  checkCreationQuota,
  ensureTenantStorageLedger,
  createStorageReservation,
  confirmStorageReservation,
  claimStorageFileForDeletion,
  finalizeStorageFileDeletion,
  claimExpiredStorageReservation,
  finalizeExpiredStorageReservation,
  finalizeRejectedOverflowFile,
};
