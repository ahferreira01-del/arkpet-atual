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


// Canonical plan definitions. Explicit IDs match the sequential serial assigned
// on first boot. On subsequent boots each row is updated by id (idempotent).
const PLAN_DEFINITIONS = [
  { id: 1, name: "Trial",      petLimit: 10,     priceBrl: 0,     description: "Teste grátis por 10 dias" },
  { id: 2, name: "Starter",    petLimit: 15,     priceBrl: 9990,  description: "Para creches começando" },
  { id: 3, name: "Essencial",  petLimit: 35,     priceBrl: 17990, description: "Para creches em crescimento" },
  { id: 4, name: "Pro",        petLimit: 75,     priceBrl: 31990, description: "Para creches consolidadas" },
  { id: 5, name: "Premium",    petLimit: 150,    priceBrl: 49990, description: "Para grandes creches" },
  { id: 6, name: "Enterprise", petLimit: 999999, priceBrl: 0,     description: "Capacidade ilimitada — sob consulta" },
] as const;

export async function seedPlans() {
  const [{ total }] = await db.select({ total: count() }).from(plansTable);

  if (Number(total) === 0) {
    // First boot: insert all plans (id assigned by serial).
    const insertValues = PLAN_DEFINITIONS.map(({ name, petLimit, priceBrl, description }) => ({
      name, petLimit, priceBrl, description,
    }));
    await db.insert(plansTable).values(insertValues);
    console.log(`[startup] ${PLAN_DEFINITIONS.length} planos criados.`);
  } else {
    // Subsequent boots: apply corrections by id (renames, repricing). Idempotent.
    let changed = 0;
    for (const def of PLAN_DEFINITIONS) {
      const result = await db
        .update(plansTable)
        .set({ name: def.name, petLimit: def.petLimit, priceBrl: def.priceBrl, description: def.description })
        .where(eq(plansTable.id, def.id));
      if ((result as any).rowCount > 0) changed++;
    }
    console.log(`[startup] Planos verificados — ${changed} plano(s) sincronizados.`);
  }

  await seedPlanPrices();
}

// Ensures every paid plan has a plan_prices row per interval and that the stored
// price_brl / discount_pct match the current billing constants. Idempotent:
// inserts missing rows, updates stale ones, deactivates Enterprise prices.
async function seedPlanPrices() {
  const plans = await db.select().from(plansTable);
  let created = 0;
  let updated = 0;

  for (const plan of plans) {
    if (plan.priceBrl === 0) {
      // Free/sob-consulta plans (Trial, Enterprise): deactivate all interval prices.
      await db
        .update(planPricesTable)
        .set({ isActive: false })
        .where(eq(planPricesTable.planId, plan.id));
      continue;
    }

    for (const interval of BILLING_INTERVALS) {
      const expectedPrice   = computeIntervalPrice(plan.priceBrl, interval);
      const expectedDiscount = INTERVAL_DISCOUNT_PCT[interval];

      const [existing] = await db
        .select()
        .from(planPricesTable)
        .where(and(eq(planPricesTable.planId, plan.id), eq(planPricesTable.interval, interval)));

      if (!existing) {
        await db.insert(planPricesTable).values({
          planId: plan.id, interval,
          priceBrl: expectedPrice,
          discountPct: expectedDiscount,
          isActive: true,
        });
        created++;
      } else if (
        Number(existing.priceBrl) !== expectedPrice ||
        existing.discountPct      !== expectedDiscount ||
        !existing.isActive
      ) {
        // Price or discount changed: clear the stale Stripe price ID so
        // seedStripePrices() creates a fresh one for the new amount.
        await db
          .update(planPricesTable)
          .set({ priceBrl: expectedPrice, discountPct: expectedDiscount, isActive: true, stripePriceId: null })
          .where(and(eq(planPricesTable.planId, plan.id), eq(planPricesTable.interval, interval)));
        updated++;
      }
    }
  }

  if (created > 0) console.log(`[startup] ${created} preço(s) de plano criados.`);
  if (updated > 0) console.log(`[startup] ${updated} preço(s) de plano atualizados.`);
  if (created === 0 && updated === 0) console.log(`[startup] Preços de plano verificados — sem alterações.`);
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

/**
 * Ensures `invoices` and `invoice_items` have every column the ORM reads/writes.
 * Idempotent — safe to run on every startup.
 * Production databases were created before several columns were added; this
 * migration brings them up to the current Drizzle schema shape.
 */
async function ensureInvoicesSchema(): Promise<void> {
  await (db as any).execute(`
    -- Enums (guard: only created when absent)
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_status') THEN
        CREATE TYPE invoice_status AS ENUM (
          'pending','awaiting_confirmation','paid','overdue','voided','refunded'
        );
      END IF;
    END $$;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method') THEN
        CREATE TYPE payment_method AS ENUM (
          'stripe','pix','cash','credit_card','bank_slip','credits'
        );
      END IF;
    END $$;

    -- invoices: additive column provisioning
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount        NUMERIC(10,2) DEFAULT 0.00;
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS credits_released BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_method  payment_method;
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR(255);
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receipt_photo_path TEXT;
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cycle_start     DATE;
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cycle_end       DATE;
    ALTER TABLE invoices ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMP NOT NULL DEFAULT NOW();

    -- SET DEFAULT for columns that may already exist without one.
    -- If the column existed before these migrations, ADD COLUMN IF NOT EXISTS
    -- is a no-op and the column keeps no DEFAULT — which makes Drizzle's
    -- "insert … values (…, default, …)" fail. Running SET DEFAULT is safe
    -- and idempotent: it replaces any existing default or creates one fresh.
    ALTER TABLE invoices ALTER COLUMN discount         SET DEFAULT 0.00;
    ALTER TABLE invoices ALTER COLUMN credits_released SET DEFAULT FALSE;
    ALTER TABLE invoices ALTER COLUMN created_at       SET DEFAULT NOW();
    ALTER TABLE invoices ALTER COLUMN updated_at       SET DEFAULT NOW();

    -- tutor × cycle unique index (nullable cols → only one non-null row per tutor+cycle)
    -- NOTE: avulso orders leave cycle_start/cycle_end NULL so they never conflict.
    CREATE UNIQUE INDEX IF NOT EXISTS tutor_cycle_unique_idx
      ON invoices (tutor_id, cycle_start, cycle_end)
      WHERE tutor_id IS NOT NULL AND cycle_start IS NOT NULL AND cycle_end IS NOT NULL;

    -- invoice_items: additive column provisioning
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS item_date             TIMESTAMP;
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS pet_id                INTEGER;
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS booking_id            INTEGER;
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS order_id              INTEGER;
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS item_type             VARCHAR(50);
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS catalogue_item_id     INTEGER;
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS snapshot_name         VARCHAR(255);
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS snapshot_price        NUMERIC(10,2);
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS credits_amount        INTEGER;
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS snapshot_max_pets     INTEGER;
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS snapshot_expiration_days INTEGER;
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS refunded_quantity      INTEGER NOT NULL DEFAULT 0;

    -- pos_sale_operations: technical idempotency table for POS sales (Phase R20F)
    CREATE TABLE IF NOT EXISTS pos_sale_operations (
      id SERIAL PRIMARY KEY,
      creche_id INTEGER NOT NULL,
      operation_id VARCHAR(64) NOT NULL,
      payload_hash VARCHAR(64) NOT NULL,
      invoice_id INTEGER NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS pos_sale_operations_creche_op_idx
      ON pos_sale_operations (creche_id, operation_id);

    -- store_order_operations: idempotency table for tutor store checkout (R24F)
    CREATE TABLE IF NOT EXISTS store_order_operations (
      id           SERIAL PRIMARY KEY,
      creche_id    INTEGER NOT NULL,
      operation_id VARCHAR(64) NOT NULL,
      payload_hash VARCHAR(64) NOT NULL,
      order_id     INTEGER NOT NULL,
      invoice_id   INTEGER NOT NULL,
      created_at   TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS store_order_operations_creche_op_idx
      ON store_order_operations (creche_id, operation_id);
  `);
  console.log("[startup] invoices/invoice_items/pos_sale_operations/store_order_operations: schema verificado (idempotente).");
}

/**
 * Ensures creches has pix columns, and that tutor_service_credits,
 * booking_service_credits, booking_credits, and catalogue_stock_transactions
 * exist with all columns the ORM expects.
 * Idempotent — safe to run on every startup.
 */
async function ensureCrechesAndCreditsSchema(): Promise<void> {
  await (db as any).execute(`
    -- creches: pix configuration columns
    ALTER TABLE creches ADD COLUMN IF NOT EXISTS pix_key  TEXT;
    ALTER TABLE creches ADD COLUMN IF NOT EXISTS pix_name TEXT;

    -- catalogue_stock_transactions: ensure table and columns exist
    CREATE TABLE IF NOT EXISTS catalogue_stock_transactions (
      id          SERIAL PRIMARY KEY,
      creche_id   INTEGER NOT NULL,
      item_id     INTEGER NOT NULL,
      quantity    INTEGER NOT NULL,
      type        VARCHAR(10) NOT NULL,
      reason      VARCHAR(255),
      user_id     INTEGER,
      created_at  TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE catalogue_stock_transactions ADD COLUMN IF NOT EXISTS creche_id  INTEGER;
    ALTER TABLE catalogue_stock_transactions ADD COLUMN IF NOT EXISTS item_id    INTEGER;
    ALTER TABLE catalogue_stock_transactions ADD COLUMN IF NOT EXISTS quantity   INTEGER;
    ALTER TABLE catalogue_stock_transactions ADD COLUMN IF NOT EXISTS type       VARCHAR(10);
    ALTER TABLE catalogue_stock_transactions ADD COLUMN IF NOT EXISTS reason     VARCHAR(255);
    ALTER TABLE catalogue_stock_transactions ADD COLUMN IF NOT EXISTS user_id    INTEGER;
    ALTER TABLE catalogue_stock_transactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

    -- tutor_service_credits: ensure catalogue_item_id column exists
    CREATE TABLE IF NOT EXISTS tutor_service_credits (
      id                SERIAL PRIMARY KEY,
      creche_id         INTEGER NOT NULL,
      tutor_id          INTEGER NOT NULL,
      catalogue_item_id INTEGER NOT NULL DEFAULT 0,
      total_credits     INTEGER NOT NULL,
      used_credits      INTEGER NOT NULL DEFAULT 0,
      created_at        TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE tutor_service_credits
      ADD COLUMN IF NOT EXISTS catalogue_item_id INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE tutor_service_credits
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

    -- booking_service_credits: link table (used to restore credits on cancel)
    CREATE TABLE IF NOT EXISTS booking_service_credits (
      id                      SERIAL PRIMARY KEY,
      booking_id              INTEGER NOT NULL,
      tutor_service_credit_id INTEGER NOT NULL,
      credits_consumed        INTEGER NOT NULL,
      restored_at             TIMESTAMP,
      created_at              TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE booking_service_credits ADD COLUMN IF NOT EXISTS restored_at TIMESTAMP;
    ALTER TABLE booking_service_credits ADD COLUMN IF NOT EXISTS created_at  TIMESTAMP NOT NULL DEFAULT NOW();

    -- booking_credits: ensure consumed_date and restored_at columns exist
    CREATE TABLE IF NOT EXISTS booking_credits (
      id               SERIAL PRIMARY KEY,
      booking_id       INTEGER NOT NULL,
      tutor_credit_id  INTEGER NOT NULL,
      credits_consumed INTEGER NOT NULL,
      consumed_date    DATE,
      restored_at      TIMESTAMP,
      created_at       TIMESTAMP NOT NULL DEFAULT NOW()
    );
    ALTER TABLE booking_credits ADD COLUMN IF NOT EXISTS consumed_date DATE;
    ALTER TABLE booking_credits ADD COLUMN IF NOT EXISTS restored_at  TIMESTAMP;
    ALTER TABLE booking_credits ADD COLUMN IF NOT EXISTS created_at   TIMESTAMP NOT NULL DEFAULT NOW();
  `);
  console.log("[startup] creches/credits/stock-transactions: schema verificado (idempotente).");
}

async function ensureTasksSchema(): Promise<void> {
  await (db as any).execute(`
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP;
  `);
  console.log("[startup] tasks: schema verificado (idempotente).");
}

export async function initializeDatabase() {
  // Phase 15B: idempotent outbox schema creation (runs in all environments)
  await ensureOutboxSchema();
  // Task #103: add-on services schema (runs in all environments)
  await ensureBookingServicesSchema();
  // Invoices/invoice_items column drift (runs in all environments)
  await ensureInvoicesSchema();
  // creches pix columns + service-credits tables (runs in all environments)
  await ensureCrechesAndCreditsSchema();
  // Phase R30B: idempotent tasks reminder_sent_at schema creation (runs in all environments)
  await ensureTasksSchema();

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
