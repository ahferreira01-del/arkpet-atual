import {
  db,
  usersTable,
  crechesTable,
  plansTable,
  planPricesTable,
  BILLING_INTERVALS,
  INTERVAL_DISCOUNT_PCT,
  INTERVAL_LABELS,
  computeIntervalPrice,
  stripeRecurringFor,
  type BillingInterval,
} from "@workspace/db";
import { eq, and, count, isNull } from "drizzle-orm";
import { hashPassword } from "./lib/auth.js";
import { getStripeSync, getUncachableStripeClient } from "./lib/stripeClient.js";

const DEFAULT_PLANS = [
  { name: "Trial", petLimit: 10, priceBrl: 0, description: "Teste grátis por 10 dias" },
  { name: "Starter", petLimit: 15, priceBrl: 7900, description: "Para creches começando" },
  { name: "Básico", petLimit: 35, priceBrl: 14900, description: "Para creches em crescimento" },
  { name: "Profissional", petLimit: 75, priceBrl: 26900, description: "Para creches consolidadas" },
  { name: "Premium", petLimit: 150, priceBrl: 42900, description: "Para grandes creches" },
  { name: "Enterprise", petLimit: 999999, priceBrl: 64900, description: "Capacidade ilimitada" },
];

export async function seedPlans() {
  const [{ total }] = await db.select({ total: count() }).from(plansTable);
  if (Number(total) === 0) {
    await db.insert(plansTable).values(DEFAULT_PLANS);
    console.log(`[startup] ${DEFAULT_PLANS.length} planos criados.`);
  }
  await seedPlanPrices();
}

// Ensures every paid plan has a plan_prices row per interval (idempotent). The
// stripePriceId is filled later by the seed-stripe script. priceBrl is derived
// from the plan's monthly base via the shared discount preset.
async function seedPlanPrices() {
  const plans = await db.select().from(plansTable);
  const paidPlans = plans.filter((p) => p.priceBrl > 0);
  let created = 0;

  for (const plan of paidPlans) {
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
      created += rows.length;
    }
  }

  if (created > 0) console.log(`[startup] ${created} preços de plano (intervalos) criados.`);
}

// Syncs Stripe products + prices for every paid plan interval, backfilling
// plan_prices.stripePriceId. Runs only when there are rows without a price ID
// (new deploy or new intervals added). Idempotent and non-fatal.
export async function seedStripePrices() {
  const pending = await db
    .select()
    .from(planPricesTable)
    .where(isNull(planPricesTable.stripePriceId));

  if (pending.length === 0) {
    console.log("[startup] Stripe: todos os preços já sincronizados.");
    return;
  }

  console.log(`[startup] Stripe: ${pending.length} preço(s) sem ID — iniciando sincronização...`);

  const stripe = await getUncachableStripeClient();
  const plans = await db.select().from(plansTable);
  const paidPlans = plans.filter((p) => p.priceBrl > 0);

  for (const plan of paidPlans) {
    // Find or create Stripe product
    const search = await stripe.products.search({
      query: `metadata['planId']:'${plan.id}' AND active:'true'`,
    });
    let product = search.data[0] ?? null;
    if (!product) {
      product = await stripe.products.create({
        name: `ArkPet — ${plan.name}`,
        description: plan.description ?? undefined,
        metadata: { planId: String(plan.id), app: "arkpet" },
      });
    }

    const planPrices = await db
      .select()
      .from(planPricesTable)
      .where(and(eq(planPricesTable.planId, plan.id), isNull(planPricesTable.stripePriceId)));

    for (const pp of planPrices) {
      const interval = pp.interval as BillingInterval;
      const recurring = stripeRecurringFor(interval);

      // Reuse existing matching active price
      const existing = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
      let price = existing.data.find(
        (p) =>
          p.currency === "brl" &&
          p.unit_amount === pp.priceBrl &&
          p.recurring?.interval === recurring.interval &&
          (p.recurring?.interval_count ?? 1) === recurring.interval_count,
      ) ?? null;

      if (!price) {
        price = await stripe.prices.create({
          product: product.id,
          currency: "brl",
          unit_amount: pp.priceBrl,
          recurring,
          metadata: { planId: String(plan.id), interval },
        });
      }

      await db
        .update(planPricesTable)
        .set({ stripePriceId: price.id })
        .where(and(eq(planPricesTable.planId, plan.id), eq(planPricesTable.interval, interval)));

      if (interval === "month") {
        await db.update(plansTable).set({ stripePriceId: price.id }).where(eq(plansTable.id, plan.id));
      }

      console.log(`[startup] Stripe: "${plan.name}" ${INTERVAL_LABELS[interval]} → ${price.id}`);
    }
  }

  console.log("[startup] Stripe: sincronização de preços concluída.");
}

// Initializes Stripe: creates/updates the `stripe` schema, registers the managed
// webhook, and backfills existing Stripe data. Non-fatal: if Stripe is not
// connected the rest of the app must still boot.
export async function initStripe() {
  try {
    const { runMigrations } = await import("stripe-replit-sync");
    console.log("[stripe] Inicializando schema...");
    await runMigrations({ databaseUrl: process.env.DATABASE_URL! });

    const stripeSync = await getStripeSync();

    const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
    if (domain) {
      const webhookResult = await stripeSync.findOrCreateManagedWebhook(
        `https://${domain}/api/stripe/webhook`,
      );
      console.log("[stripe] Webhook:", webhookResult?.url ?? "configurado");
    } else {
      console.warn("[stripe] REPLIT_DOMAINS ausente — webhook não configurado.");
    }

    await seedStripePrices();

    stripeSync
      .syncBackfill()
      .then(() => console.log("[stripe] Dados sincronizados."))
      .catch((err) => console.error("[stripe] Falha ao sincronizar:", err));
  } catch (err) {
    console.warn(
      "[stripe] Stripe não inicializado (integração pode não estar conectada):",
      err instanceof Error ? err.message : err,
    );
  }
}

export async function initializeDatabase() {
  await seedPlans();

  if (process.env.NODE_ENV !== "production") return;

  console.log("[startup] Verificando banco de dados de produção...");

  const [{ total }] = await db.select({ total: count() }).from(usersTable);

  if (Number(total) > 0) {
    console.log(`[startup] Banco inicializado. ${total} usuário(s) encontrado(s).`);
    return;
  }

  console.log("[startup] Banco vazio — criando usuário master_admin inicial...");

  const masterEmail = process.env.MASTER_ADMIN_EMAIL ?? "master@arkpet.com.br";
  const masterPassword = process.env.MASTER_ADMIN_PASSWORD ?? "ArkPet@2024!";
  const masterName = process.env.MASTER_ADMIN_NAME ?? "Master Admin";

  await db.insert(usersTable).values({
    name: masterName,
    email: masterEmail,
    passwordHash: hashPassword(masterPassword),
    role: "master_admin",
    mustChangePassword: true,
    isActive: true,
  });

  console.log(`[startup] Master admin criado: ${masterEmail}`);
  console.log(`[startup] ATENÇÃO: troque a senha no primeiro acesso.`);
}
