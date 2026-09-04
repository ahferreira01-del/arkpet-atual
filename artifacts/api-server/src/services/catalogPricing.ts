/**
 * Canonical Catalog Price Resolver (R36.D2)
 *
 * Provides a single authoritative helper to resolve catalog prices across:
 * - Customer checkout & plan selection
 * - Commercial support console read model (GET /commercial/support)
 * - Pure price preview simulation (POST /commercial/preview-price)
 * - Commercial condition snapshotting (pet-limit-override & draft-condition)
 *
 * Invariants:
 * 1. Authoritative interval-specific resolution via planPricesTable.
 * 2. Strict supported intervals: 'month' | 'quarter' | 'semester' | 'year'.
 * 3. Exact agreement with production checkout fallback to computeIntervalPrice.
 * 4. Missing price != zero price: Missing catalog prices throw CatalogPriceResolutionError
 *    and NEVER silently fall back to 0 or a free plan.
 * 5. Explicit zero price (e.g. Trial or custom free tier) is preserved.
 */

import { db as defaultDb, BILLING_INTERVALS, computeIntervalPrice, type BillingInterval } from "@workspace/db";
import { plansTable, planPricesTable, type Plan, type PlanPrice } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";

export class CatalogPriceResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogPriceResolutionError";
  }
}

export interface ResolvedCatalogPlanPrice {
  planId: number;
  planName: string;
  interval: BillingInterval;
  catalogPriceCents: number;
  petLimit: number;
  source: "plan_prices" | "derived";
  stripePriceId?: string | null;
}

/**
 * Normalizes legacy or user input billing intervals to canonical BillingInterval.
 * Supported mappings:
 * - 'month', 'monthly' -> 'month'
 * - 'quarter', 'quarterly' -> 'quarter'
 * - 'semester', 'semiannual', 'semestral' -> 'semester'
 * - 'year', 'yearly', 'annual' -> 'year'
 */
export function normalizeBillingInterval(raw: unknown): BillingInterval | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  switch (trimmed) {
    case "month":
    case "monthly":
      return "month";
    case "quarter":
    case "quarterly":
      return "quarter";
    case "semester":
    case "semiannual":
    case "semestral":
      return "semester";
    case "year":
    case "yearly":
    case "annual":
      return "year";
    default:
      return null;
  }
}

/**
 * Resolves authoritative catalog price in centavos for a plan and billing interval.
 */
export async function resolveCatalogPlanPrice(
  planOrPlanId: Plan | number,
  interval: BillingInterval | string,
  dbClient: any = defaultDb,
): Promise<ResolvedCatalogPlanPrice> {
  // 1. Validate and normalize billing interval against authoritative enum
  const validInterval = normalizeBillingInterval(interval);
  if (!validInterval) {
    throw new CatalogPriceResolutionError(
      `Invalid billing interval '${interval}'. Supported intervals: ${BILLING_INTERVALS.join(", ")}.`,
    );
  }

  // 2. Fetch or accept plan record
  let plan: Plan;
  if (typeof planOrPlanId === "number") {
    if (!Number.isInteger(planOrPlanId) || planOrPlanId <= 0) {
      throw new CatalogPriceResolutionError(`Invalid planId: ${planOrPlanId}.`);
    }

    const [fetched] = await dbClient
      .select()
      .from(plansTable)
      .where(eq(plansTable.id, planOrPlanId))
      .limit(1);

    if (!fetched) {
      throw new CatalogPriceResolutionError(`Plan with ID ${planOrPlanId} not found in catalog.`);
    }
    plan = fetched;
  } else if (planOrPlanId && typeof planOrPlanId === "object" && "id" in planOrPlanId) {
    plan = planOrPlanId;
  } else {
    throw new CatalogPriceResolutionError("Invalid plan identifier provided to price resolver.");
  }

  // 3. Query interval-specific price in planPricesTable
  let planPrice: PlanPrice | undefined;
  try {
    const rows = await dbClient
      .select()
      .from(planPricesTable)
      .where(and(eq(planPricesTable.planId, plan.id), eq(planPricesTable.interval, validInterval)))
      .limit(1);

    if (Array.isArray(rows) && rows.length > 0) {
      planPrice = rows[0];
    }
  } catch (err: any) {
    // If table query fails, let it bubble unless caught by caller
    throw err;
  }

  // 4. Resolve price according to authoritative production hierarchy
  // Priority A: Stored row in planPricesTable with valid safe integer priceBrl >= 0
  if (
    planPrice &&
    typeof planPrice.priceBrl === "number" &&
    Number.isSafeInteger(planPrice.priceBrl) &&
    planPrice.priceBrl >= 0
  ) {
    return {
      planId: plan.id,
      planName: plan.name,
      interval: validInterval,
      catalogPriceCents: planPrice.priceBrl,
      petLimit: plan.petLimit,
      source: "plan_prices",
      stripePriceId: planPrice.stripePriceId ?? (validInterval === "month" ? plan.stripePriceId : null),
    };
  }

  // Priority B: Derive from plansTable.priceBrl via computeIntervalPrice
  // Only valid if plansTable.priceBrl is a valid safe integer >= 0
  if (
    typeof plan.priceBrl === "number" &&
    Number.isSafeInteger(plan.priceBrl) &&
    plan.priceBrl >= 0
  ) {
    const derivedPrice = computeIntervalPrice(plan.priceBrl, validInterval);
    return {
      planId: plan.id,
      planName: plan.name,
      interval: validInterval,
      catalogPriceCents: derivedPrice,
      petLimit: plan.petLimit,
      source: "derived",
      stripePriceId: validInterval === "month" ? plan.stripePriceId : null,
    };
  }

  // Priority C: Missing price configuration -> Fail Closed
  throw new CatalogPriceResolutionError(
    `Authoritative catalog price for plan '${plan.name}' (ID: ${plan.id}) and interval '${validInterval}' could not be resolved.`,
  );
}
