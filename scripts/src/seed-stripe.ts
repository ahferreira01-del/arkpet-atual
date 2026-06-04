// Seeds Stripe products + BRL prices for every paid plan and billing interval,
// storing each resulting price id in plan_prices.stripePriceId (and the monthly
// price in plans.stripePriceId for backward compatibility). Idempotent: products
// are matched by metadata.planId; prices are reused when an active matching price
// already exists.
import { eq, and } from "drizzle-orm";
import {
  db,
  plansTable,
  planPricesTable,
  stripeRecurringFor,
  computeIntervalPrice,
  BILLING_INTERVALS,
  INTERVAL_DISCOUNT_PCT,
  INTERVAL_LABELS,
  type BillingInterval,
} from "@workspace/db";
import { getUncachableStripeClient } from "./stripeClient.js";

// Self-healing: ensure a plan_prices row exists for every interval of a paid
// plan before syncing Stripe, so the script works even if startup seeding has
// not run yet. Idempotent.
async function ensurePlanPriceRows(plan: { id: number; priceBrl: number }) {
  const existing = await db
    .select({ interval: planPricesTable.interval })
    .from(planPricesTable)
    .where(eq(planPricesTable.planId, plan.id));
  const present = new Set(existing.map((r) => r.interval));

  const rows = BILLING_INTERVALS.filter((interval) => !present.has(interval)).map((interval) => ({
    planId: plan.id,
    interval,
    priceBrl: computeIntervalPrice(plan.priceBrl, interval),
    discountPct: INTERVAL_DISCOUNT_PCT[interval],
  }));

  if (rows.length > 0) {
    await db.insert(planPricesTable).values(rows);
  }
}

type StripeClient = Awaited<ReturnType<typeof getUncachableStripeClient>>;

async function findProductByPlanId(stripe: StripeClient, planId: number) {
  const result = await stripe.products.search({
    query: `metadata['planId']:'${planId}' AND active:'true'`,
  });
  return result.data[0] ?? null;
}

async function findMatchingPrice(
  stripe: StripeClient,
  productId: string,
  amount: number,
  interval: BillingInterval,
) {
  const recurring = stripeRecurringFor(interval);
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  return (
    prices.data.find(
      (p) =>
        p.currency === "brl" &&
        p.unit_amount === amount &&
        p.recurring?.interval === recurring.interval &&
        (p.recurring?.interval_count ?? 1) === recurring.interval_count,
    ) ?? null
  );
}

async function main() {
  const stripe = await getUncachableStripeClient();
  const plans = await db.select().from(plansTable);
  const paidPlans = plans.filter((p) => p.priceBrl > 0);

  console.log(`[seed-stripe] ${paidPlans.length} planos pagos a sincronizar.`);

  for (const plan of paidPlans) {
    let product = await findProductByPlanId(stripe, plan.id);
    if (product) {
      console.log(`[seed-stripe] Produto existente para "${plan.name}": ${product.id}`);
    } else {
      product = await stripe.products.create({
        name: `ArkPet — ${plan.name}`,
        description: plan.description ?? undefined,
        metadata: { planId: String(plan.id), app: "arkpet" },
      });
      console.log(`[seed-stripe] Produto criado para "${plan.name}": ${product.id}`);
    }

    await ensurePlanPriceRows(plan);

    const planPrices = await db
      .select()
      .from(planPricesTable)
      .where(eq(planPricesTable.planId, plan.id));

    for (const pp of planPrices) {
      const interval = pp.interval as BillingInterval;
      let price = await findMatchingPrice(stripe, product.id, pp.priceBrl, interval);
      if (price) {
        console.log(`[seed-stripe]   ${INTERVAL_LABELS[interval]}: preço existente ${price.id}`);
      } else {
        price = await stripe.prices.create({
          product: product.id,
          currency: "brl",
          unit_amount: pp.priceBrl,
          recurring: stripeRecurringFor(interval),
          metadata: { planId: String(plan.id), interval },
        });
        console.log(`[seed-stripe]   ${INTERVAL_LABELS[interval]}: preço criado ${price.id}`);
      }

      await db
        .update(planPricesTable)
        .set({ stripePriceId: price.id })
        .where(and(eq(planPricesTable.planId, plan.id), eq(planPricesTable.interval, interval)));

      // Keep plans.stripePriceId pointing at the monthly price for backward compat.
      if (interval === "month") {
        await db.update(plansTable).set({ stripePriceId: price.id }).where(eq(plansTable.id, plan.id));
      }
    }

    console.log(`[seed-stripe] "${plan.name}" sincronizado.`);
  }

  console.log("[seed-stripe] Concluído.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-stripe] Erro:", err);
  process.exit(1);
});
