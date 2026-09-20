import { db as defaultDb, type BillingInterval, BILLING_INTERVALS } from "@workspace/db";
import {
  plansTable,
  planVersionsTable,
  planVersionPricesTable,
  type PlanVersion,
  type PlanVersionPrice,
  type PlanVersionStatus,
} from "@workspace/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { getUncachableStripeClient } from "../lib/stripeClient.js";

export class PlanVersionError extends Error {
  public code: string;
  public statusCode: number;

  constructor(code: string, message: string, statusCode: number = 400) {
    super(message);
    this.name = "PlanVersionError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface PlanVersionPriceInput {
  interval: BillingInterval;
  priceBrl: number; // centavos >= 0
  stripePriceId?: string | null;
}

export interface CreateDraftVersionInput {
  planId: number;
  versionNumber?: number;
  versionName?: string | null;
  petLimit: number;
  priceBrl?: number; // base reference price in centavos
  features?: any;
  prices?: PlanVersionPriceInput[];
  userId?: number;
  dbClient?: any;
}

export interface UpdateDraftVersionInput {
  planId: number;
  versionNumber: number;
  versionName?: string | null;
  petLimit?: number;
  priceBrl?: number;
  features?: any;
  prices?: PlanVersionPriceInput[];
  dbClient?: any;
}

export interface ActivateVersionInput {
  planId: number;
  versionNumber: number;
  userId: number;
  changeReason: string;
  stripeClient?: any;
  dbClient?: any;
}

export class PlanVersionService {
  /**
   * Retrieves all versions for a plan, ordered by versionNumber ASC.
   */
  static async getVersions(planId: number, dbClient: any = defaultDb) {
    const versions = await dbClient
      .select()
      .from(planVersionsTable)
      .where(eq(planVersionsTable.planId, planId))
      .orderBy(planVersionsTable.versionNumber);

    const versionIds = versions.map((v: PlanVersion) => v.id);
    let prices: PlanVersionPrice[] = [];
    if (versionIds.length > 0) {
      prices = await dbClient
        .select()
        .from(planVersionPricesTable)
        .where(
          sql`${planVersionPricesTable.planVersionId} IN (${sql.join(
            versionIds.map((id: number) => sql`${id}`),
            sql`, `,
          )})`,
        );
    }

    return versions.map((v: PlanVersion) => ({
      ...v,
      prices: prices.filter((p: PlanVersionPrice) => p.planVersionId === v.id),
    }));
  }

  /**
   * Retrieves a single version by planId and versionNumber.
   */
  static async getVersion(planId: number, versionNumber: number, dbClient: any = defaultDb) {
    const [version] = await dbClient
      .select()
      .from(planVersionsTable)
      .where(
        and(
          eq(planVersionsTable.planId, planId),
          eq(planVersionsTable.versionNumber, versionNumber),
        ),
      )
      .limit(1);

    if (!version) return null;

    const prices = await dbClient
      .select()
      .from(planVersionPricesTable)
      .where(eq(planVersionPricesTable.planVersionId, version.id));

    return { ...version, prices };
  }

  /**
   * Retrieves the currently ACTIVE version for a plan.
   */
  static async getActiveVersion(planId: number, dbClient: any = defaultDb) {
    const [version] = await dbClient
      .select()
      .from(planVersionsTable)
      .where(
        and(
          eq(planVersionsTable.planId, planId),
          eq(planVersionsTable.status, "ACTIVE"),
        ),
      )
      .limit(1);

    if (!version) return null;

    const prices = await dbClient
      .select()
      .from(planVersionPricesTable)
      .where(eq(planVersionPricesTable.planVersionId, version.id));

    return { ...version, prices };
  }

  /**
   * Creates a new DRAFT plan version with sequential version number.
   */
  static async createDraftVersion(input: CreateDraftVersionInput) {
    const dbClient = input.dbClient ?? defaultDb;

    // Verify parent plan exists
    const [plan] = await dbClient
      .select()
      .from(plansTable)
      .where(eq(plansTable.id, input.planId))
      .limit(1);

    if (!plan) {
      throw new PlanVersionError("ERR_PLAN_NOT_FOUND", `Plan with ID ${input.planId} not found.`, 404);
    }

    // Determine next sequential version number
    const [latest] = await dbClient
      .select({ maxVersion: sql<number>`COALESCE(MAX(${planVersionsTable.versionNumber}), 0)` })
      .from(planVersionsTable)
      .where(eq(planVersionsTable.planId, input.planId));

    const expectedNext = (latest?.maxVersion ?? 0) + 1;

    if (input.versionNumber !== undefined && input.versionNumber !== expectedNext) {
      throw new PlanVersionError(
        "ERR_SEQUENTIAL_VERSIONS_REQUIRED",
        `Version number must be sequential. Expected ${expectedNext}, received ${input.versionNumber}.`,
        400,
      );
    }

    const versionNum = expectedNext;
    const versionName = input.versionName ?? `v${versionNum}`;

    // Validate pet limit
    if (typeof input.petLimit !== "number" || input.petLimit <= 0) {
      throw new PlanVersionError("ERR_INVALID_PET_LIMIT", "Pet limit must be a positive integer.", 400);
    }

    const priceBrl = input.priceBrl ?? 0;
    if (typeof priceBrl !== "number" || priceBrl < 0) {
      throw new PlanVersionError("ERR_INVALID_PRICE", "Base price in centavos must be non-negative.", 400);
    }

    const [createdVersion] = await dbClient
      .insert(planVersionsTable)
      .values({
        planId: input.planId,
        versionNumber: versionNum,
        versionName,
        status: "DRAFT",
        petLimit: input.petLimit,
        priceBrl,
        features: input.features ?? plan.features ?? null,
        effectiveFrom: null,
        effectiveUntil: null,
      })
      .returning();

    // Insert prices if supplied
    const prices: PlanVersionPrice[] = [];
    if (input.prices && input.prices.length > 0) {
      for (const p of input.prices) {
        if (!BILLING_INTERVALS.includes(p.interval)) {
          throw new PlanVersionError("ERR_INVALID_INTERVAL", `Invalid interval: ${p.interval}.`, 400);
        }
        if (typeof p.priceBrl !== "number" || p.priceBrl < 0) {
          throw new PlanVersionError("ERR_INVALID_PRICE", `Price for ${p.interval} must be non-negative integer.`, 400);
        }

        const [createdPrice] = await dbClient
          .insert(planVersionPricesTable)
          .values({
            planVersionId: createdVersion.id,
            interval: p.interval,
            priceBrl: p.priceBrl,
            stripePriceId: p.stripePriceId ?? null,
          })
          .returning();
        prices.push(createdPrice);
      }
    }

    return { ...createdVersion, prices };
  }

  /**
   * Updates commercial fields of an existing DRAFT version.
   * If an interval price changes and already has a stripePriceId, clears it to prevent mismatch.
   */
  static async updateDraftVersion(input: UpdateDraftVersionInput) {
    const dbClient = input.dbClient ?? defaultDb;

    const [existing] = await dbClient
      .select()
      .from(planVersionsTable)
      .where(
        and(
          eq(planVersionsTable.planId, input.planId),
          eq(planVersionsTable.versionNumber, input.versionNumber),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new PlanVersionError("ERR_VERSION_NOT_FOUND", "Plan version not found.", 404);
    }

    if (existing.status !== "DRAFT") {
      throw new PlanVersionError(
        "ERR_COMMERCIAL_FIELDS_IMMUTABLE",
        `Only DRAFT versions can be modified. Version ${input.versionNumber} is in status '${existing.status}'.`,
        400,
      );
    }

    const updates: Partial<PlanVersion> = {};
    if (input.versionName !== undefined) updates.versionName = input.versionName;
    if (input.petLimit !== undefined) {
      if (typeof input.petLimit !== "number" || input.petLimit <= 0) {
        throw new PlanVersionError("ERR_INVALID_PET_LIMIT", "Pet limit must be a positive integer.", 400);
      }
      updates.petLimit = input.petLimit;
    }
    if (input.priceBrl !== undefined) {
      if (typeof input.priceBrl !== "number" || input.priceBrl < 0) {
        throw new PlanVersionError("ERR_INVALID_PRICE", "Base price must be a non-negative integer.", 400);
      }
      updates.priceBrl = input.priceBrl;
    }
    if (input.features !== undefined) updates.features = input.features;

    let updatedVersion = existing;
    if (Object.keys(updates).length > 0) {
      const [res] = await dbClient
        .update(planVersionsTable)
        .set(updates)
        .where(eq(planVersionsTable.id, existing.id))
        .returning();
      updatedVersion = res;
    }

    // Handle prices update
    if (input.prices && input.prices.length > 0) {
      const existingPrices = await dbClient
        .select()
        .from(planVersionPricesTable)
        .where(eq(planVersionPricesTable.planVersionId, existing.id));

      for (const p of input.prices) {
        const matching = existingPrices.find((ep: PlanVersionPrice) => ep.interval === p.interval);
        if (matching) {
          // If price amount changed, clear stripePriceId
          const priceChanged = matching.priceBrl !== p.priceBrl;
          await dbClient
            .update(planVersionPricesTable)
            .set({
              priceBrl: p.priceBrl,
              stripePriceId: priceChanged ? null : (p.stripePriceId ?? matching.stripePriceId),
            })
            .where(eq(planVersionPricesTable.id, matching.id));
        } else {
          await dbClient.insert(planVersionPricesTable).values({
            planVersionId: existing.id,
            interval: p.interval,
            priceBrl: p.priceBrl,
            stripePriceId: p.stripePriceId ?? null,
          });
        }
      }
    }

    const finalPrices = await dbClient
      .select()
      .from(planVersionPricesTable)
      .where(eq(planVersionPricesTable.planVersionId, existing.id));

    return { ...updatedVersion, prices: finalPrices };
  }

  /**
   * Activates a DRAFT version:
   * 1. Validates mandatory changeReason.
   * 2. Provisions Stripe prices using deterministic idempotency key `arkpet_v_{planId}_{versionNumber}_{interval}_{priceCents}`.
   * 3. Atomically transitions current ACTIVE to SUPERSEDED, and DRAFT to ACTIVE.
   * 4. Updates plansTable projection.
   */
  static async activateVersion(input: ActivateVersionInput) {
    const dbClient = input.dbClient ?? defaultDb;

    if (!input.changeReason || typeof input.changeReason !== "string" || input.changeReason.trim().length === 0) {
      throw new PlanVersionError(
        "ERR_CHANGE_REASON_REQUIRED",
        "Mandatory changeReason is required to activate a plan version.",
        400,
      );
    }

    // 1. Fetch version and plan
    const [version] = await dbClient
      .select()
      .from(planVersionsTable)
      .where(
        and(
          eq(planVersionsTable.planId, input.planId),
          eq(planVersionsTable.versionNumber, input.versionNumber),
        ),
      )
      .limit(1);

    if (!version) {
      throw new PlanVersionError("ERR_VERSION_NOT_FOUND", "Plan version not found.", 404);
    }

    if (version.status === "SUPERSEDED") {
      throw new PlanVersionError(
        "ERR_CANNOT_REACTIVATE_SUPERSEDED_VERSION",
        "Cannot reactivate a superseded version. Clone as a new draft instead.",
        400,
      );
    }

    if (version.status === "ARCHIVED") {
      throw new PlanVersionError(
        "ERR_CANNOT_ACTIVATE_ARCHIVED_VERSION",
        "Cannot activate an archived version.",
        400,
      );
    }

    if (version.status === "ACTIVE") {
      return { ...version, alreadyActive: true };
    }

    if (version.status !== "DRAFT") {
      throw new PlanVersionError(
        "ERR_INVALID_LIFECYCLE_TRANSITION",
        `Cannot activate version in status '${version.status}'. Must be 'DRAFT'.`,
        400,
      );
    }

    // 2. Fetch interval price rows
    const prices = await dbClient
      .select()
      .from(planVersionPricesTable)
      .where(eq(planVersionPricesTable.planVersionId, version.id));

    // 3. Provision Stripe prices if Stripe client is available or configured
    let stripe = input.stripeClient;
    if (!stripe) {
      try {
        stripe = await getUncachableStripeClient();
      } catch {
        // Stripe unavailable in mock/unit mode
        stripe = null;
      }
    }

    if (stripe && stripe.prices && prices.length > 0) {
      const [planRow] = await dbClient
        .select()
        .from(plansTable)
        .where(eq(plansTable.id, input.planId))
        .limit(1);

      for (const p of prices) {
        if (!p.stripePriceId && p.priceBrl > 0) {
          const idempotencyKey = `arkpet_v_${input.planId}_${input.versionNumber}_${p.interval}_${p.priceBrl}`;
          try {
            // Map interval to Stripe recurring interval
            const stripeInterval = p.interval === "year" ? "year" : "month";
            const intervalCount = p.interval === "quarter" ? 3 : p.interval === "semester" ? 6 : 1;

            const stripePrice = await stripe.prices.create(
              {
                unit_amount: p.priceBrl,
                currency: "brl",
                recurring: {
                  interval: stripeInterval,
                  interval_count: intervalCount,
                },
                product_data: {
                  name: `ArkPet ${planRow?.name ?? "Plan"} - ${input.versionNumber} (${p.interval})`,
                },
                metadata: {
                  planId: String(input.planId),
                  versionNumber: String(input.versionNumber),
                  interval: p.interval,
                  planVersionId: String(version.id),
                  planVersionPriceId: String(p.id),
                },
              },
              { idempotencyKey },
            );

            if (stripePrice && stripePrice.id) {
              await dbClient
                .update(planVersionPricesTable)
                .set({ stripePriceId: stripePrice.id })
                .where(eq(planVersionPricesTable.id, p.id));
              p.stripePriceId = stripePrice.id;
            }
          } catch (stripeErr: any) {
            // TC-STP-08: Partial failure leaves local version in DRAFT
            throw new PlanVersionError(
              "ERR_STRIPE_PRICE_PROVISIONING_FAILED",
              `Stripe price provisioning failed for interval '${p.interval}': ${stripeErr?.message ?? stripeErr}`,
              502,
            );
          }
        }
      }
    }

    // 4. Atomic activation transaction
    const now = new Date();
    return await dbClient.transaction(async (tx: any) => {
      // Check concurrent activation race (TC-CNC-01)
      const currentActive = await tx
        .select()
        .from(planVersionsTable)
        .where(
          and(
            eq(planVersionsTable.planId, input.planId),
            eq(planVersionsTable.status, "ACTIVE"),
          ),
        );

      // Supersede currently active versions
      for (const active of currentActive) {
        if (active.id !== version.id) {
          await tx
            .update(planVersionsTable)
            .set({
              status: "SUPERSEDED",
              effectiveUntil: now,
            })
            .where(eq(planVersionsTable.id, active.id));
        }
      }

      // Activate target draft version
      const [activated] = await tx
        .update(planVersionsTable)
        .set({
          status: "ACTIVE",
          effectiveFrom: now,
          effectiveUntil: null,
          changeReason: input.changeReason.trim(),
          activatedByUserId: input.userId,
        })
        .where(eq(planVersionsTable.id, version.id))
        .returning();

      // Dual-write projection onto plansTable
      const monthlyPrice = prices.find((p: PlanVersionPrice) => p.interval === "month")?.priceBrl ?? activated.priceBrl;
      await tx
        .update(plansTable)
        .set({
          petLimit: activated.petLimit,
          priceBrl: monthlyPrice,
          features: activated.features,
          updatedAt: now,
        })
        .where(eq(plansTable.id, input.planId));

      return { ...activated, prices };
    });
  }

  /**
   * Archives a SUPERSEDED version.
   * DRAFT versions cannot be archived (must be deleted).
   */
  static async archiveVersion(planId: number, versionNumber: number, dbClient: any = defaultDb) {
    const [version] = await dbClient
      .select()
      .from(planVersionsTable)
      .where(
        and(
          eq(planVersionsTable.planId, planId),
          eq(planVersionsTable.versionNumber, versionNumber),
        ),
      )
      .limit(1);

    if (!version) {
      throw new PlanVersionError("ERR_VERSION_NOT_FOUND", "Plan version not found.", 404);
    }

    if (version.status === "DRAFT") {
      throw new PlanVersionError(
        "ERR_INVALID_LIFECYCLE_TRANSITION",
        "Draft versions must be deleted, not archived.",
        400,
      );
    }

    if (version.status === "ACTIVE") {
      throw new PlanVersionError(
        "ERR_CANNOT_ARCHIVE_ACTIVE_VERSION",
        "Active versions cannot be archived. Supersede first.",
        400,
      );
    }

    if (version.status === "ARCHIVED") {
      return version;
    }

    const [archived] = await dbClient
      .update(planVersionsTable)
      .set({ status: "ARCHIVED" })
      .where(eq(planVersionsTable.id, version.id))
      .returning();

    return archived;
  }

  /**
   * Deletes a DRAFT version and its draft price rows.
   */
  static async deleteDraftVersion(planId: number, versionNumber: number, dbClient: any = defaultDb) {
    const [version] = await dbClient
      .select()
      .from(planVersionsTable)
      .where(
        and(
          eq(planVersionsTable.planId, planId),
          eq(planVersionsTable.versionNumber, versionNumber),
        ),
      )
      .limit(1);

    if (!version) {
      throw new PlanVersionError("ERR_VERSION_NOT_FOUND", "Plan version not found.", 404);
    }

    if (version.status !== "DRAFT") {
      throw new PlanVersionError(
        "ERR_CANNOT_DELETE_ACTIVE_VERSION",
        `Cannot delete version in status '${version.status}'. Only DRAFT versions can be deleted.`,
        400,
      );
    }

    await dbClient
      .delete(planVersionPricesTable)
      .where(eq(planVersionPricesTable.planVersionId, version.id));

    await dbClient
      .delete(planVersionsTable)
      .where(eq(planVersionsTable.id, version.id));

    return { success: true, deletedVersionNumber: versionNumber };
  }
}
