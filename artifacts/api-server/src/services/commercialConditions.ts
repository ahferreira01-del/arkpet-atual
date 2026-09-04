import { db } from "@workspace/db";
import {
  customerCommercialConditionsTable,
  subscriptionsTable,
  type CustomerCommercialCondition,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";

export class CrossTenantConditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrossTenantConditionError";
  }
}

export class InvalidConditionSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConditionSnapshotError";
  }
}

/**
 * Cross-tenant pointer guard.
 * Strictly guarantees that a subscription from Creche A can NEVER point to
 * a commercial condition belonging to Creche B.
 */
export function assertConditionTenantMatch(
  subscriptionCrecheId: number,
  conditionCrecheId: number,
): void {
  if (subscriptionCrecheId !== conditionCrecheId) {
    throw new CrossTenantConditionError(
      `Cross-tenant commercial condition violation: subscription creche (${subscriptionCrecheId}) does not match condition creche (${conditionCrecheId}).`,
    );
  }
}

/**
 * Validates that a commercial condition is a complete, self-contained snapshot
 * rather than a sparse patch.
 */
export function assertConditionFullSnapshot(
  condition: Partial<CustomerCommercialCondition>,
): void {
  if (!condition.crecheId) {
    throw new InvalidConditionSnapshotError("Condition snapshot missing required crecheId.");
  }
  if (!condition.status) {
    throw new InvalidConditionSnapshotError("Condition snapshot missing required status.");
  }
  if (!condition.validFrom) {
    throw new InvalidConditionSnapshotError("Condition snapshot missing required validFrom timestamp.");
  }
  // Pricing override type must be explicitly specified (e.g. 'none' if no override)
  if (condition.pricingOverrideType === undefined || condition.pricingOverrideType === null) {
    throw new InvalidConditionSnapshotError(
      "Condition snapshot missing pricingOverrideType. Full snapshot must declare override type (use 'none' for baseline).",
    );
  }
  // petLimit is the only approved entitlement override in ArkPet
  if (
    condition.entitlementPetLimit !== undefined &&
    condition.entitlementPetLimit !== null &&
    condition.entitlementPetLimit <= 0
  ) {
    throw new InvalidConditionSnapshotError("entitlementPetLimit must be a positive integer when specified.");
  }
}

/**
 * Atomically activates a new commercial condition for a creche, superseding any
 * currently active condition first so the partial unique index
 * `customer_commercial_conditions_single_active_idx` is never violated.
 *
 * Sequence inside a single database transaction:
 * 1. Validate tenant match between subscription and target condition.
 * 2. Validate condition snapshot integrity.
 * 3. Update existing active condition for creche -> 'superseded'.
 * 4. Update new condition -> 'active'.
 * 5. Update subscription's activeConditionId pointer.
 */
export async function transitionActiveCondition(
  crecheId: number,
  newConditionId: number,
  dbOrTx: any = db,
): Promise<{ previousConditionId: number | null; activeConditionId: number }> {
  return await dbOrTx.transaction(async (tx: any) => {
    // 1. Fetch subscription and new condition
    const [sub] = await tx
      .select({ id: subscriptionsTable.id, crecheId: subscriptionsTable.crecheId })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.crecheId, crecheId))
      .limit(1);

    const [newCond] = await tx
      .select()
      .from(customerCommercialConditionsTable)
      .where(
        and(
          eq(customerCommercialConditionsTable.id, newConditionId),
          eq(customerCommercialConditionsTable.crecheId, crecheId),
        ),
      )
      .limit(1);

    if (!newCond) {
      throw new Error(`Target commercial condition ${newConditionId} for creche ${crecheId} not found.`);
    }

    if (sub) {
      assertConditionTenantMatch(sub.crecheId, newCond.crecheId);
    }
    assertConditionFullSnapshot(newCond);

    // 2. Find any currently active condition
    const [currentActive] = await tx
      .select({ id: customerCommercialConditionsTable.id })
      .from(customerCommercialConditionsTable)
      .where(
        and(
          eq(customerCommercialConditionsTable.crecheId, crecheId),
          eq(customerCommercialConditionsTable.status, "active"),
        ),
      )
      .limit(1);

    const now = new Date();

    // 3. Step A: Supersede previous active condition FIRST to vacate unique partial index slot
    if (currentActive && currentActive.id !== newConditionId) {
      await tx
        .update(customerCommercialConditionsTable)
        .set({ status: "superseded", updatedAt: now })
        .where(eq(customerCommercialConditionsTable.id, currentActive.id));
    }

    // 4. Step B: Activate new condition
    await tx
      .update(customerCommercialConditionsTable)
      .set({
        status: "active",
        updatedAt: now,
        predecessorId: currentActive?.id ?? newCond.predecessorId ?? null,
      })
      .where(eq(customerCommercialConditionsTable.id, newConditionId));

    // 5. Step C: Update subscription pointer if subscription exists
    if (sub) {
      await tx
        .update(subscriptionsTable)
        .set({ activeConditionId: newConditionId })
        .where(eq(subscriptionsTable.id, sub.id));
    }

    return {
      previousConditionId: currentActive?.id ?? null,
      activeConditionId: newConditionId,
    };
  });
}
