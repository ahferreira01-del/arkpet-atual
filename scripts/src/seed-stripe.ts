// Seeds Stripe products + BRL monthly prices for paid plans and stores the
// resulting price id in plans.stripePriceId. Idempotent: products are matched by
// metadata.planId; prices are reused when an active matching price already exists.
import { eq } from "drizzle-orm";
import { db, plansTable } from "@workspace/db";
import { getUncachableStripeClient } from "./stripeClient.js";

async function findProductByPlanId(stripe: Awaited<ReturnType<typeof getUncachableStripeClient>>, planId: number) {
  const result = await stripe.products.search({
    query: `metadata['planId']:'${planId}' AND active:'true'`,
  });
  return result.data[0] ?? null;
}

async function findMatchingPrice(
  stripe: Awaited<ReturnType<typeof getUncachableStripeClient>>,
  productId: string,
  amount: number,
) {
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  return (
    prices.data.find(
      (p) =>
        p.currency === "brl" &&
        p.unit_amount === amount &&
        p.recurring?.interval === "month",
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

    let price = await findMatchingPrice(stripe, product.id, plan.priceBrl);
    if (price) {
      console.log(`[seed-stripe] Preço existente para "${plan.name}": ${price.id}`);
    } else {
      price = await stripe.prices.create({
        product: product.id,
        currency: "brl",
        unit_amount: plan.priceBrl,
        recurring: { interval: "month" },
        metadata: { planId: String(plan.id) },
      });
      console.log(`[seed-stripe] Preço criado para "${plan.name}": ${price.id}`);
    }

    await db.update(plansTable).set({ stripePriceId: price.id }).where(eq(plansTable.id, plan.id));
    console.log(`[seed-stripe] plans.stripePriceId atualizado para "${plan.name}".`);
  }

  console.log("[seed-stripe] Concluído.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-stripe] Erro:", err);
  process.exit(1);
});
