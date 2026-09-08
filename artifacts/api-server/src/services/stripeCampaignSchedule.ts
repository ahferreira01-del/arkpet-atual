import type Stripe from "stripe";
import { db, type BillingInterval } from "@workspace/db";
import {
  assignedCommercialBenefitsTable,
  plansTable,
  crechesTable,
  subscriptionsTable,
  customerCommercialConditionsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { getUncachableStripeClient } from "../lib/stripeClient.js";
import { resolveCatalogPlanPrice } from "./catalogPricing.js";

export class ExistingStripeScheduleUnsupportedError extends Error {
  readonly code = "EXISTING_STRIPE_SCHEDULE_UNSUPPORTED";
  readonly statusCode = 422;
  constructor(
    message = "A assinatura Stripe já possui um cronograma (Subscription Schedule) externo não gerenciado pelo ArkPet. A composição automática não é suportada.",
  ) {
    super(message);
    this.name = "ExistingStripeScheduleUnsupportedError";
  }
}

export class StripeCampaignScheduleError extends Error {
  readonly code: string;
  readonly statusCode: number;
  constructor(message: string, code = "STRIPE_CAMPAIGN_SCHEDULE_ERROR", statusCode = 500) {
    super(message);
    this.name = "StripeCampaignScheduleError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface CalculateCadenceDurationResult {
  interval: "month" | "year";
  intervalCount: number;
  totalDurationMonths: number;
}

/**
 * Calculates exact temporal duration for N contractual billing cycles based on cadence.
 *
 * Golden mappings:
 * - 3 monthly cycles = 3 months
 * - 3 quarterly cycles = 9 months (3 * 3)
 * - 3 semester cycles = 18 months (6 * 3)
 * - 3 yearly cycles = 3 years
 */
export function calculateCadenceDuration(
  billingInterval: BillingInterval,
  billingCycles: number,
): CalculateCadenceDurationResult {
  switch (billingInterval) {
    case "month":
      return { interval: "month", intervalCount: billingCycles, totalDurationMonths: billingCycles };
    case "quarter":
      return { interval: "month", intervalCount: 3 * billingCycles, totalDurationMonths: 3 * billingCycles };
    case "semester":
      return { interval: "month", intervalCount: 6 * billingCycles, totalDurationMonths: 6 * billingCycles };
    case "year":
      return { interval: "year", intervalCount: billingCycles, totalDurationMonths: 12 * billingCycles };
    default:
      return { interval: "month", intervalCount: billingCycles, totalDurationMonths: billingCycles };
  }
}

/**
 * Resolves or creates a recurring Stripe Price for campaign promotional or restoration phases.
 */
export async function resolveOrCreateCampaignStripePrice(params: {
  amountCents: number;
  interval: BillingInterval;
  stripeProductId: string;
  scope: "promotional" | "restoration";
  campaignId: number;
  assignedBenefitId: number;
  crecheId: number;
  stripeClient: Stripe;
  idempotencyKey: string;
}): Promise<string> {
  const stripe = params.stripeClient;
  const stripeInterval: "month" | "year" = params.interval === "year" ? "year" : "month";
  const intervalCount =
    params.interval === "quarter" ? 3 : params.interval === "semester" ? 6 : 1;

  const price = await stripe.prices.create(
    {
      product: params.stripeProductId,
      unit_amount: params.amountCents,
      currency: "brl",
      recurring: {
        interval: stripeInterval,
        interval_count: intervalCount,
      },
      metadata: {
        scope: "arkpet_commercial_campaign",
        campaignRole: params.scope,
        campaignId: String(params.campaignId),
        assignedBenefitId: String(params.assignedBenefitId),
        crecheId: String(params.crecheId),
        environment: process.env.NODE_ENV || "development",
      },
    },
    { idempotencyKey: params.idempotencyKey },
  );

  return price.id;
}

/**
 * Executes safe Stripe Subscription Schedule creation and phase configuration.
 *
 * Sequence:
 * 1. Inspect existing schedule on subscription (fail-closed if unknown/unrelated).
 * 2. Create promotional Stripe price.
 * 3. Create restoration Stripe price.
 * 4. Step 1 (create): subscriptionSchedules.create({ from_subscription }) with deterministic idempotency.
 * 5. Persist stripeScheduleId immediately in assigned_commercial_benefits (crash recovery checkpoint).
 * 6. Step 2 (update): subscriptionSchedules.update(scheduleId, { phases }) with preserved current phase.
 */
export async function executeStripeCampaignSchedule(params: {
  assignedBenefitId: number;
  campaignId: number;
  crecheId: number;
  stripeSubscriptionId: string;
  billingInterval: BillingInterval;
  billingCycles: number;
  promotionalPriceCents: number;
  restorationPriceCents: number;
  existingStripeScheduleId?: string | null;
  stripeClient?: Stripe;
  dbClient?: any;
}): Promise<{
  stripeScheduleId: string;
  promotionalStripePriceId: string;
  restorationStripePriceId: string;
  scheduledStartPeriod: Date;
}> {
  const stripe = params.stripeClient ?? (await getUncachableStripeClient());
  const dbClient = params.dbClient ?? db;

  // Retrieve current subscription from Stripe
  const stripeSub = await stripe.subscriptions.retrieve(params.stripeSubscriptionId);
  if (!stripeSub || stripeSub.status === "canceled") {
    throw new StripeCampaignScheduleError(
      "A assinatura Stripe da creche não está ativa para aplicação da campanha temporal.",
      "SUBSCRIPTION_NOT_ACTIVE",
      422,
    );
  }

  // Find target plan and productId
  const [subRow] = await dbClient
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.crecheId, params.crecheId))
    .limit(1);

  if (!subRow || !subRow.planId) {
    throw new StripeCampaignScheduleError("Assinatura local da creche não encontrada.", "LOCAL_SUB_NOT_FOUND", 404);
  }

  const [plan] = await dbClient
    .select()
    .from(plansTable)
    .where(eq(plansTable.id, subRow.planId))
    .limit(1);

  if (!plan || !plan.stripeProductId) {
    throw new StripeCampaignScheduleError("Plano ou produto Stripe correspondente não encontrado.", "PLAN_NOT_FOUND", 404);
  }

  // 1. Inspect existing schedule on subscription or assigned benefit (Section 27 & Crash Recovery Section 5)
  const subScheduleId =
    typeof (stripeSub as any).schedule === "string"
      ? (stripeSub as any).schedule
      : (stripeSub as any).schedule?.id ?? null;

  const existingScheduleId = subScheduleId ?? params.existingStripeScheduleId ?? null;

  let scheduleIdToUse: string | null = null;

  if (existingScheduleId) {
    const existingSched = await stripe.subscriptionSchedules.retrieve(existingScheduleId);
    const isOurSchedule =
      (existingSched.metadata?.scope === "arkpet_commercial_campaign" &&
        existingSched.metadata?.assignedBenefitId === String(params.assignedBenefitId)) ||
      existingScheduleId === params.existingStripeScheduleId;

    if (!isOurSchedule) {
      throw new ExistingStripeScheduleUnsupportedError(
        `A assinatura já possui o Subscription Schedule '${existingScheduleId}' que não pertence a esta atribuição de campanha.`,
      );
    }
    scheduleIdToUse = existingScheduleId;
  }

  // 2. Resolve / create promotional and restoration prices
  const promoPriceKey = `campaign:${params.assignedBenefitId}:create-promo-price`;
  const promotionalStripePriceId = await resolveOrCreateCampaignStripePrice({
    amountCents: params.promotionalPriceCents,
    interval: params.billingInterval,
    stripeProductId: plan.stripeProductId,
    scope: "promotional",
    campaignId: params.campaignId,
    assignedBenefitId: params.assignedBenefitId,
    crecheId: params.crecheId,
    stripeClient: stripe,
    idempotencyKey: promoPriceKey,
  });

  const restorePriceKey = `campaign:${params.assignedBenefitId}:create-restore-price`;
  const restorationStripePriceId = await resolveOrCreateCampaignStripePrice({
    amountCents: params.restorationPriceCents,
    interval: params.billingInterval,
    stripeProductId: plan.stripeProductId,
    scope: "restoration",
    campaignId: params.campaignId,
    assignedBenefitId: params.assignedBenefitId,
    crecheId: params.crecheId,
    stripeClient: stripe,
    idempotencyKey: restorePriceKey,
  });

  // 3. Step 1: Create schedule from subscription if not already created (Crash recovery)
  let schedule: Stripe.SubscriptionSchedule;
  if (!scheduleIdToUse) {
    const scheduleCreateKey = `campaign:${params.assignedBenefitId}:create-schedule`;
    schedule = await stripe.subscriptionSchedules.create(
      {
        from_subscription: params.stripeSubscriptionId,
        metadata: {
          scope: "arkpet_commercial_campaign",
          campaignId: String(params.campaignId),
          assignedBenefitId: String(params.assignedBenefitId),
          crecheId: String(params.crecheId),
        },
      },
      { idempotencyKey: scheduleCreateKey },
    );

    scheduleIdToUse = schedule.id;

    // Persist immediately in assigned_commercial_benefits BEFORE update (Crash Recovery Section 5)
    await dbClient
      .update(assignedCommercialBenefitsTable)
      .set({
        stripeScheduleId: schedule.id,
        promotionalStripePriceId,
        restorationStripePriceId,
        updatedAt: new Date(),
      })
      .where(eq(assignedCommercialBenefitsTable.id, params.assignedBenefitId));
  } else {
    schedule = await stripe.subscriptionSchedules.retrieve(scheduleIdToUse);
  }

  // 4. Step 2: Configure phases (Section 3, 4, 6)
  // Phase 0: Preserve current phase from retrieved schedule
  const phase0 = schedule.phases[0];
  if (!phase0) {
    throw new StripeCampaignScheduleError(
      "O Subscription Schedule criado pelo Stripe não contém fase inicial.",
      "SCHEDULE_PHASE_MISSING",
      500,
    );
  }

  const scheduledStartPeriod = new Date(phase0.end_date * 1000);
  const cadenceDuration = calculateCadenceDuration(params.billingInterval, params.billingCycles);

  // Build preserved Phase 0 fields (Section 3)
  const currentPhaseItems = phase0.items.map((item) => ({
    price: typeof item.price === "string" ? item.price : item.price.id,
    quantity: item.quantity ?? 1,
  }));

  const scheduleUpdateKey = `campaign:${params.assignedBenefitId}:configure-schedule`;

  // Build Phase 1 (Promotional) and Phase 2 (Restoration)
  const phasesPayload: any[] = [
    {
      items: currentPhaseItems,
      start_date: phase0.start_date,
      end_date: phase0.end_date,
      proration_behavior: "none",
    },
    {
      items: [{ price: promotionalStripePriceId, quantity: 1 }],
      duration: {
        interval: cadenceDuration.interval,
        interval_count: cadenceDuration.intervalCount,
      },
      proration_behavior: "none",
      metadata: {
        scope: "arkpet_commercial_campaign",
        phase: "promotional",
        campaignId: String(params.campaignId),
        assignedBenefitId: String(params.assignedBenefitId),
      },
    },
    {
      items: [{ price: restorationStripePriceId, quantity: 1 }],
      proration_behavior: "none",
      metadata: {
        scope: "arkpet_commercial_campaign",
        phase: "restoration",
        campaignId: String(params.campaignId),
        assignedBenefitId: String(params.assignedBenefitId),
      },
    },
  ];

  await stripe.subscriptionSchedules.update(
    scheduleIdToUse,
    {
      end_behavior: "release",
      proration_behavior: "none",
      metadata: {
        scope: "arkpet_commercial_campaign",
        campaignId: String(params.campaignId),
        assignedBenefitId: String(params.assignedBenefitId),
        crecheId: String(params.crecheId),
        environment: process.env.NODE_ENV || "development",
      },
      phases: phasesPayload,
    },
    { idempotencyKey: scheduleUpdateKey },
  );

  // Update DB snapshot
  await dbClient
    .update(assignedCommercialBenefitsTable)
    .set({
      stripeScheduleId: scheduleIdToUse,
      promotionalStripePriceId,
      restorationStripePriceId,
      scheduledStartPeriod,
      status: "scheduled",
      updatedAt: new Date(),
    })
    .where(eq(assignedCommercialBenefitsTable.id, params.assignedBenefitId));

  return {
    stripeScheduleId: scheduleIdToUse,
    promotionalStripePriceId,
    restorationStripePriceId,
    scheduledStartPeriod,
  };
}

/**
 * Releases the Subscription Schedule idempotently when the campaign completes (Section 7).
 * Ensures old campaign schedules do not permanently block future campaigns.
 */
export async function releaseCampaignSchedule(
  stripeScheduleId: string,
  stripeClient?: Stripe,
): Promise<boolean> {
  const stripe = stripeClient ?? (await getUncachableStripeClient());
  try {
    const sched = await stripe.subscriptionSchedules.retrieve(stripeScheduleId);
    if (sched.status === "released" || sched.status === "canceled") {
      return true;
    }
    await stripe.subscriptionSchedules.release(stripeScheduleId);
    return true;
  } catch (err: any) {
    if (err?.code === "resource_missing" || err?.statusCode === 404) {
      return true;
    }
    throw err;
  }
}
