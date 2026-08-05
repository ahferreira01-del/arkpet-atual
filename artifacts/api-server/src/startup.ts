import {
  db,
  usersTable,
  crechesTable,
  plansTable,
  planPricesTable,
  subscriptionsTable,
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

// Syncs Stripe products + prices for every paid plan interval.
// Always runs a full match-by-value sync (currency + amount + interval) so that
// stale or wrong price IDs in the DB are corrected automatically — even in
// production where the DB may have IDs from a different Stripe account/mode.
export async function seedStripePrices() {
  const stripe = await getUncachableStripeClient();
  const plans = await db.select().from(plansTable);
  const paidPlans = plans.filter((p) => p.priceBrl > 0);

  if (paidPlans.length === 0) return;

  let updated = 0;

  for (const plan of paidPlans) {
    // Find or create Stripe product for this plan.
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
      .where(eq(planPricesTable.planId, plan.id));

    // List all active prices for this product once (avoids N+1 calls).
    const activePrices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });

    for (const pp of planPrices) {
      const interval = pp.interval as BillingInterval;
      const recurring = stripeRecurringFor(interval);

      // Match by currency + amount + recurrence — ignores whatever ID is stored.
      let price = activePrices.data.find(
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

      // Update DB only when the stored ID differs (avoids unnecessary writes).
      if (pp.stripePriceId !== price.id) {
        await db
          .update(planPricesTable)
          .set({ stripePriceId: price.id })
          .where(and(eq(planPricesTable.planId, plan.id), eq(planPricesTable.interval, interval)));

        if (interval === "month") {
          await db.update(plansTable).set({ stripePriceId: price.id }).where(eq(plansTable.id, plan.id));
        }

        console.log(`[startup] Stripe: corrigido "${plan.name}" ${INTERVAL_LABELS[interval]} → ${price.id}`);
        updated++;
      }
    }
  }

  if (updated > 0) {
    console.log(`[startup] Stripe: ${updated} preço(s) sincronizado(s).`);
  } else {
    console.log("[startup] Stripe: todos os preços já sincronizados.");
  }
}

// Initializes Stripe: creates/updates the `stripe` schema, registers the managed
// webhook, and backfills existing Stripe data. Non-fatal: if Stripe is not
// connected the rest of the app must still boot.
export async function initStripe() {
  // Step 1: stripe-replit-sync (schema + webhook + backfill).
  // May fail in production bundles if migration files are not resolved — that is
  // acceptable; the app must still boot and payments must still work.
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

    stripeSync
      .syncBackfill()
      .then(() => console.log("[stripe] Dados sincronizados."))
      .catch((err) => console.error("[stripe] Falha ao sincronizar:", err));
  } catch (err) {
    console.warn(
      "[stripe] stripe-replit-sync não disponível (normal em produção bundled):",
      err instanceof Error ? err.message : err,
    );
  }

  // Step 2: seed Stripe products + prices for every plan interval.
  // Runs independently of Step 1 so a bundle-path failure never blocks checkout.
  try {
    await seedStripePrices();
  } catch (err) {
    console.warn(
      "[stripe] Falha ao sincronizar preços dos planos:",
      err instanceof Error ? err.message : err,
    );
  }
}

// ── Migração pontual: trial para Quintal Pet (creche_id=17) ─────────────────
// Criada via master_admin → sem subscription row → sem trial nem acesso a planos.
// Esta função insere o trial retroativo uma única vez. Idempotente.
async function migrateQuintalPetTrial() {
  const existing = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.crecheId, 17));

  if (existing.length > 0) {
    console.log("[startup] Quintal Pet: trial já existe, nada a fazer.");
    return;
  }

  // Busca o plano Trial (id=1)
  const [trialPlan] = await db
    .select({ id: plansTable.id })
    .from(plansTable)
    .where(eq(plansTable.name, "Trial"));

  if (!trialPlan) {
    console.warn("[startup] Quintal Pet: plano Trial não encontrado, migração pulada.");
    return;
  }

  // Trial de 10 dias a partir da data de criação da creche (2026-06-18)
  const crecheCreatedAt = new Date("2026-06-18T14:26:57.944Z");
  const trialEndsAt = new Date(crecheCreatedAt.getTime() + 10 * 24 * 60 * 60 * 1000);

  await db.insert(subscriptionsTable).values({
    crecheId: 17,
    planId: trialPlan.id,
    status: "trial",
    trialEndsAt,
  });

  console.log(`[startup] Quintal Pet: trial inserido — expira em ${trialEndsAt.toISOString()}`);
}

/**
 * Phase 15B: ensures the financial_outbox table and its enum exist.
 * Idempotent — safe to run on every startup in all environments.
 * Needed because drizzle-kit push only ran on the dev DB; production
 * (and CI) databases must get the schema via this startup path.
 */
/**
 * Idempotent DDL — propagates on failure so startup aborts rather than
 * silently booting without the outbox table (which would cause every
 * financial mutation to fail at the point of the outbox insert).
 */
async function ensureOutboxSchema(): Promise<void> {
  await (db as any).execute(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'outbox_status') THEN
        CREATE TYPE outbox_status AS ENUM ('pending', 'processed', 'failed');
      END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS financial_outbox (
      id           SERIAL PRIMARY KEY,
      event_type   VARCHAR(100) NOT NULL,
      payload      JSONB NOT NULL,
      status       outbox_status NOT NULL DEFAULT 'pending',
      retry_count  INTEGER NOT NULL DEFAULT 0,
      processed_at TIMESTAMP,
      created_at   TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  console.log("[startup] financial_outbox: schema verificado (idempotente).");
}

/**
 * Task #103 — Add-on services (booking_services): ensures the table, enum,
 * and supporting columns exist in all environments.
 * Idempotent — safe to run on every startup.
 * Needed because drizzle-kit push only ran on the dev DB; production and CI
 * databases get the schema through this startup path.
 */
export async function ensureBookingServicesSchema(): Promise<void> {
  await (db as any).execute(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_service_status') THEN
        CREATE TYPE booking_service_status AS ENUM ('pending', 'confirmed', 'cancelled');
      END IF;
    END $$;

    CREATE TABLE IF NOT EXISTS booking_services (
      id                        SERIAL PRIMARY KEY,
      booking_id                INTEGER NOT NULL,
      catalogue_item_id         INTEGER NOT NULL,
      quantity                  INTEGER NOT NULL DEFAULT 1,
      status                    booking_service_status NOT NULL DEFAULT 'pending',
      consumed_credit           BOOLEAN NOT NULL DEFAULT FALSE,
      tutor_service_credit_id   INTEGER,
      charged                   BOOLEAN NOT NULL DEFAULT FALSE,
      invoice_item_id           INTEGER,
      captured_price            NUMERIC(10, 2),
      created_at                TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at                TIMESTAMP NOT NULL DEFAULT NOW()
    );

    -- Fully additive column provisioning: an earlier/partial deployment may
    -- have created the table with a subset of columns. Every column the code
    -- reads or writes is added here individually (NOT NULL columns carry a
    -- DEFAULT so the ALTER succeeds on non-empty tables).
    ALTER TABLE booking_services
      ADD COLUMN IF NOT EXISTS booking_id INTEGER;
    ALTER TABLE booking_services
      ADD COLUMN IF NOT EXISTS catalogue_item_id INTEGER;
    ALTER TABLE booking_services
      ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE booking_services
      ADD COLUMN IF NOT EXISTS status booking_service_status NOT NULL DEFAULT 'pending';
    ALTER TABLE booking_services
      ADD COLUMN IF NOT EXISTS consumed_credit BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE booking_services
      ADD COLUMN IF NOT EXISTS tutor_service_credit_id INTEGER;
    ALTER TABLE booking_services
      ADD COLUMN IF NOT EXISTS charged BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE booking_services
      ADD COLUMN IF NOT EXISTS invoice_item_id INTEGER;
    ALTER TABLE booking_services
      ADD COLUMN IF NOT EXISTS captured_price NUMERIC(10, 2);
    ALTER TABLE booking_services
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
    ALTER TABLE booking_services
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

    -- Indexes only after all columns are guaranteed to exist
    CREATE INDEX IF NOT EXISTS booking_services_booking_idx
      ON booking_services (booking_id);
    CREATE INDEX IF NOT EXISTS booking_services_catalogue_idx
      ON booking_services (catalogue_item_id);
    -- Uniqueness: one row per (booking, catalogue item) to prevent duplicate charges
    CREATE UNIQUE INDEX IF NOT EXISTS booking_services_booking_catalogue_uq
      ON booking_services (booking_id, catalogue_item_id)
      WHERE status != 'cancelled';

    -- Add primary_catalogue_item_id to bookings if it doesn't exist yet
    ALTER TABLE bookings
      ADD COLUMN IF NOT EXISTS primary_catalogue_item_id INTEGER;
  `);
  console.log("[startup] booking_services: schema verificado (idempotente).");
}

export async function initializeDatabase() {
  // Phase 15B: idempotent outbox schema creation (runs in all environments)
  await ensureOutboxSchema();
  // Task #103: add-on services schema (runs in all environments)
  await ensureBookingServicesSchema();

  await seedPlans();

  if (process.env.NODE_ENV !== "production") return;

  console.log("[startup] Verificando banco de dados de produção...");

  // Migrações pontuais
  await migrateQuintalPetTrial();

  const [{ total }] = await db.select({ total: count() }).from(usersTable);

  if (Number(total) > 0) {
    console.log(`[startup] Banco inicializado. ${total} usuário(s) encontrado(s).`);
    return;
  }

  console.log("[startup] Banco vazio — criando usuário master_admin inicial...");

  const masterEmail = process.env.MASTER_ADMIN_EMAIL ?? "master@arkpet.com.br";
  const masterPassword = process.env.MASTER_ADMIN_PASSWORD ?? "ArkPet@2024!";
  const masterName = process.env.MASTER_ADMIN_NAME ?? "Master Admin";

  const usingCustomPassword = !!process.env.MASTER_ADMIN_PASSWORD;
  await db.insert(usersTable).values({
    name: masterName,
    email: masterEmail,
    passwordHash: hashPassword(masterPassword),
    role: "master_admin",
    mustChangePassword: !usingCustomPassword,
    isActive: true,
  });

  console.log(`[startup] Master admin criado: ${masterEmail}`);
  console.log(`[startup] ATENÇÃO: troque a senha no primeiro acesso.`);
}
