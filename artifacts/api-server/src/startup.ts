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
export async function ensureInvoicesSchema(): Promise<void> {
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
    -- R37.B: additive commercial condition snapshot columns
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS base_unit_price        NUMERIC(10,2);
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS discount_amount        NUMERIC(10,2);
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS final_price            NUMERIC(10,2);
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS pricing_source_type    VARCHAR(50);
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS applied_condition_id   INTEGER;
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS condition_snapshot     JSONB;
    -- R37.C2B: additive campaign snapshot columns and partial unique index
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS applied_campaign_id                 INTEGER;
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS applied_campaign_redemption_id      INTEGER;
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS applied_campaign_redemption_item_id INTEGER;
    ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS campaign_snapshot                   JSONB;

    CREATE UNIQUE INDEX IF NOT EXISTS invoice_items_campaign_redemption_item_unique_idx
      ON invoice_items (applied_campaign_redemption_item_id)
      WHERE applied_campaign_redemption_item_id IS NOT NULL;

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

/**
 * Phase R36.C Slice 1: ensures commercial platform foundation tables, columns,
 * and partial unique indexes exist in all environments.
 * Idempotent — safe to run on every startup.
 */
export async function ensureCommercialFoundationSchema(): Promise<void> {
  await (db as any).execute(`
    -- 1. customer_commercial_conditions (full-snapshot model)
    CREATE TABLE IF NOT EXISTS customer_commercial_conditions (
      id SERIAL PRIMARY KEY,
      creche_id INTEGER NOT NULL,
      plan_id INTEGER,
      pricing_override_type VARCHAR(50) DEFAULT 'none',
      pricing_override_value INTEGER,
      entitlement_pet_limit INTEGER,
      valid_from TIMESTAMP NOT NULL DEFAULT NOW(),
      valid_until TIMESTAMP,
      status VARCHAR(30) NOT NULL DEFAULT 'draft',
      predecessor_id INTEGER,
      agreement_id INTEGER,
      reason TEXT,
      execution_requirement VARCHAR(50) DEFAULT 'none',
      sync_status VARCHAR(50) NOT NULL DEFAULT 'synced',
      stripe_price_id TEXT,
      last_sync_error TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS creche_id INTEGER;
    ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS plan_id INTEGER;
    ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS pricing_override_type VARCHAR(50) DEFAULT 'none';
    ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS pricing_override_value INTEGER;
    ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS entitlement_pet_limit INTEGER;
    ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS valid_from TIMESTAMP NOT NULL DEFAULT NOW();
    ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS valid_until TIMESTAMP;
    ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'draft';
    ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS predecessor_id INTEGER;
    ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS agreement_id INTEGER;
    ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS reason TEXT;
    ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS execution_requirement VARCHAR(50) DEFAULT 'none';
    ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS sync_status VARCHAR(50) NOT NULL DEFAULT 'synced';
    ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;
    ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(100);
    ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS idempotency_operation VARCHAR(50);
    ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;
    ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS snapshot_billing_interval VARCHAR(20);
    ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS snapshot_base_price_cents INTEGER;
    ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS last_synchronized_amount_cents INTEGER;
    ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS last_sync_error TEXT;
    ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
    ALTER TABLE customer_commercial_conditions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

    -- Enforces at most ONE ACTIVE condition per creche
    CREATE UNIQUE INDEX IF NOT EXISTS customer_commercial_conditions_single_active_idx
      ON customer_commercial_conditions (creche_id)
      WHERE status = 'active';

    CREATE UNIQUE INDEX IF NOT EXISTS customer_commercial_conditions_idempotency_idx
      ON customer_commercial_conditions (creche_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;

    CREATE INDEX IF NOT EXISTS customer_commercial_conditions_creche_status_idx
      ON customer_commercial_conditions (creche_id, status);

    -- 2. commercial_agreements
    CREATE TABLE IF NOT EXISTS commercial_agreements (
      id SERIAL PRIMARY KEY,
      creche_id INTEGER NOT NULL,
      type VARCHAR(50) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'draft',
      snapshot_json JSONB,
      terms_snapshot JSONB,
      sent_at TIMESTAMP,
      accepted_at TIMESTAMP,
      accepted_by_user_id INTEGER,
      valid_until TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    ALTER TABLE commercial_agreements ADD COLUMN IF NOT EXISTS creche_id INTEGER;
    ALTER TABLE commercial_agreements ADD COLUMN IF NOT EXISTS type VARCHAR(50);
    ALTER TABLE commercial_agreements ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'draft';
    ALTER TABLE commercial_agreements ADD COLUMN IF NOT EXISTS title VARCHAR(255);
    ALTER TABLE commercial_agreements ADD COLUMN IF NOT EXISTS notes TEXT;
    ALTER TABLE commercial_agreements ADD COLUMN IF NOT EXISTS activation_status VARCHAR(30) NOT NULL DEFAULT 'not_started';
    ALTER TABLE commercial_agreements ADD COLUMN IF NOT EXISTS activation_error TEXT;
    ALTER TABLE commercial_agreements ADD COLUMN IF NOT EXISTS predecessor_condition_id INTEGER;
    ALTER TABLE commercial_agreements ADD COLUMN IF NOT EXISTS activated_condition_id INTEGER;
    ALTER TABLE commercial_agreements ADD COLUMN IF NOT EXISTS superseded_by_agreement_id INTEGER;
    ALTER TABLE commercial_agreements ADD COLUMN IF NOT EXISTS snapshot_json JSONB;
    ALTER TABLE commercial_agreements ADD COLUMN IF NOT EXISTS terms_snapshot JSONB;
    ALTER TABLE commercial_agreements ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP;
    ALTER TABLE commercial_agreements ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP;
    ALTER TABLE commercial_agreements ADD COLUMN IF NOT EXISTS accepted_by_user_id INTEGER;
    ALTER TABLE commercial_agreements ADD COLUMN IF NOT EXISTS declined_at TIMESTAMP;
    ALTER TABLE commercial_agreements ADD COLUMN IF NOT EXISTS declined_by_user_id INTEGER;
    ALTER TABLE commercial_agreements ADD COLUMN IF NOT EXISTS decline_reason TEXT;
    ALTER TABLE commercial_agreements ADD COLUMN IF NOT EXISTS valid_until TIMESTAMP;
    ALTER TABLE commercial_agreements ADD COLUMN IF NOT EXISTS created_by VARCHAR(100);
    ALTER TABLE commercial_agreements ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
    ALTER TABLE commercial_agreements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

    CREATE INDEX IF NOT EXISTS commercial_agreements_creche_type_idx
      ON commercial_agreements (creche_id, type);

    CREATE INDEX IF NOT EXISTS commercial_agreements_creche_status_idx
      ON commercial_agreements (creche_id, status);

    -- 3. commercial_audit_ledger
    CREATE TABLE IF NOT EXISTS commercial_audit_ledger (
      id SERIAL PRIMARY KEY,
      target_creche_id INTEGER NOT NULL,
      actor_type VARCHAR(20) NOT NULL,
      actor_id INTEGER,
      actor_role VARCHAR(50),
      actor_email TEXT,
      action VARCHAR(100) NOT NULL,
      reason TEXT,
      before_state JSONB,
      after_state JSONB,
      execution_requirement VARCHAR(50),
      execution_status VARCHAR(50),
      related_agreement_id INTEGER,
      related_condition_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    ALTER TABLE commercial_audit_ledger ADD COLUMN IF NOT EXISTS target_creche_id INTEGER;
    ALTER TABLE commercial_audit_ledger ADD COLUMN IF NOT EXISTS actor_type VARCHAR(20);
    ALTER TABLE commercial_audit_ledger ADD COLUMN IF NOT EXISTS actor_id INTEGER;
    ALTER TABLE commercial_audit_ledger ADD COLUMN IF NOT EXISTS actor_role VARCHAR(50);
    ALTER TABLE commercial_audit_ledger ADD COLUMN IF NOT EXISTS actor_email TEXT;
    ALTER TABLE commercial_audit_ledger ADD COLUMN IF NOT EXISTS action VARCHAR(100);
    ALTER TABLE commercial_audit_ledger ADD COLUMN IF NOT EXISTS reason TEXT;
    ALTER TABLE commercial_audit_ledger ADD COLUMN IF NOT EXISTS before_state JSONB;
    ALTER TABLE commercial_audit_ledger ADD COLUMN IF NOT EXISTS after_state JSONB;
    ALTER TABLE commercial_audit_ledger ADD COLUMN IF NOT EXISTS execution_requirement VARCHAR(50);
    ALTER TABLE commercial_audit_ledger ADD COLUMN IF NOT EXISTS execution_status VARCHAR(50);
    ALTER TABLE commercial_audit_ledger ADD COLUMN IF NOT EXISTS related_agreement_id INTEGER;
    ALTER TABLE commercial_audit_ledger ADD COLUMN IF NOT EXISTS related_condition_id INTEGER;
    ALTER TABLE commercial_audit_ledger ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();

    CREATE INDEX IF NOT EXISTS commercial_audit_ledger_creche_created_idx
      ON commercial_audit_ledger (target_creche_id, created_at);

    CREATE INDEX IF NOT EXISTS commercial_audit_ledger_actor_type_idx
      ON commercial_audit_ledger (actor_type);

    -- 4. gateway_events
    CREATE TABLE IF NOT EXISTS gateway_events (
      id SERIAL PRIMARY KEY,
      gateway VARCHAR(30) NOT NULL DEFAULT 'stripe',
      event_id VARCHAR(255) NOT NULL UNIQUE,
      event_type VARCHAR(100) NOT NULL,
      event_created TIMESTAMP,
      status VARCHAR(30) NOT NULL DEFAULT 'received',
      retry_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      received_at TIMESTAMP NOT NULL DEFAULT NOW(),
      processing_started_at TIMESTAMP,
      lease_expires_at TIMESTAMP,
      processed_at TIMESTAMP,
      payload JSONB
    );

    ALTER TABLE gateway_events ADD COLUMN IF NOT EXISTS gateway VARCHAR(30) NOT NULL DEFAULT 'stripe';
    ALTER TABLE gateway_events ADD COLUMN IF NOT EXISTS event_id VARCHAR(255);
    ALTER TABLE gateway_events ADD COLUMN IF NOT EXISTS event_type VARCHAR(100);
    ALTER TABLE gateway_events ADD COLUMN IF NOT EXISTS event_created TIMESTAMP;
    ALTER TABLE gateway_events ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'received';
    ALTER TABLE gateway_events ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE gateway_events ADD COLUMN IF NOT EXISTS error_message TEXT;
    ALTER TABLE gateway_events ADD COLUMN IF NOT EXISTS received_at TIMESTAMP NOT NULL DEFAULT NOW();
    ALTER TABLE gateway_events ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMP;
    ALTER TABLE gateway_events ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMP;
    ALTER TABLE gateway_events ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP;
    ALTER TABLE gateway_events ADD COLUMN IF NOT EXISTS payload JSONB;

    CREATE UNIQUE INDEX IF NOT EXISTS gateway_events_gateway_event_id_unique
      ON gateway_events (gateway, event_id);

    CREATE INDEX IF NOT EXISTS gateway_events_status_lease_idx
      ON gateway_events (status, lease_expires_at);

    -- 5. commercial_operation_requests (Phase R36.E1.1 durable idempotency ledger)
    CREATE TABLE IF NOT EXISTS commercial_operation_requests (
      id SERIAL PRIMARY KEY,
      creche_id INTEGER,
      operation VARCHAR(64) NOT NULL,
      idempotency_key VARCHAR(255) NOT NULL,
      request_fingerprint VARCHAR(64) NOT NULL,
      resource_type VARCHAR(64),
      resource_id INTEGER,
      status VARCHAR(32) NOT NULL DEFAULT 'PROCESSING',
      attempt_count INTEGER NOT NULL DEFAULT 1,
      status_code INTEGER,
      response_payload JSONB,
      error_code VARCHAR(64),
      error_message TEXT,
      processing_started_at TIMESTAMP NOT NULL DEFAULT NOW(),
      lease_expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMP
    );

    ALTER TABLE commercial_operation_requests ADD COLUMN IF NOT EXISTS creche_id INTEGER;
    ALTER TABLE commercial_operation_requests ALTER COLUMN creche_id DROP NOT NULL;
    ALTER TABLE commercial_operation_requests ADD COLUMN IF NOT EXISTS operation VARCHAR(64);
    ALTER TABLE commercial_operation_requests ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);
    ALTER TABLE commercial_operation_requests ADD COLUMN IF NOT EXISTS request_fingerprint VARCHAR(64);
    ALTER TABLE commercial_operation_requests ADD COLUMN IF NOT EXISTS resource_type VARCHAR(64);
    ALTER TABLE commercial_operation_requests ADD COLUMN IF NOT EXISTS resource_id INTEGER;
    ALTER TABLE commercial_operation_requests ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'PROCESSING';
    ALTER TABLE commercial_operation_requests ADD COLUMN IF NOT EXISTS attempt_count INTEGER DEFAULT 1;
    ALTER TABLE commercial_operation_requests ADD COLUMN IF NOT EXISTS status_code INTEGER;
    ALTER TABLE commercial_operation_requests ADD COLUMN IF NOT EXISTS response_payload JSONB;
    ALTER TABLE commercial_operation_requests ADD COLUMN IF NOT EXISTS error_code VARCHAR(64);
    ALTER TABLE commercial_operation_requests ADD COLUMN IF NOT EXISTS error_message TEXT;
    ALTER TABLE commercial_operation_requests ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMP DEFAULT NOW();
    ALTER TABLE commercial_operation_requests ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMP;
    ALTER TABLE commercial_operation_requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
    ALTER TABLE commercial_operation_requests ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;

    -- Replace legacy unpredicated idempotency index with tenant-scoped and global-scoped indexes (R36.F1 Section 4)
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'commercial_operation_requests_creche_idempotency_unique'
          AND indexdef NOT LIKE '%WHERE%'
      ) THEN
        DROP INDEX commercial_operation_requests_creche_idempotency_unique;
      END IF;
    END $$;

    CREATE UNIQUE INDEX IF NOT EXISTS commercial_operation_requests_creche_idempotency_unique
      ON commercial_operation_requests (creche_id, idempotency_key)
      WHERE creche_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS commercial_operation_requests_global_idempotency_unique
      ON commercial_operation_requests (idempotency_key)
      WHERE creche_id IS NULL;

    CREATE INDEX IF NOT EXISTS commercial_operation_requests_creche_operation_idx
      ON commercial_operation_requests (creche_id, operation);

    CREATE INDEX IF NOT EXISTS commercial_operation_requests_status_lease_idx
      ON commercial_operation_requests (status, lease_expires_at);

    -- 6. Additive columns on existing tables
    ALTER TABLE plans ADD COLUMN IF NOT EXISTS stripe_product_id TEXT;
    ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS active_condition_id INTEGER;

    -- 7. Commercial Campaigns & Temporal Benefits (Phase R36.F / R36.F1)
    CREATE TABLE IF NOT EXISTS commercial_campaigns (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      status VARCHAR(32) NOT NULL DEFAULT 'draft',
      eligible_from TIMESTAMP,
      eligible_until TIMESTAMP,
      priority INTEGER NOT NULL DEFAULT 0,
      assignment_mode VARCHAR(64) NOT NULL DEFAULT 'MASTER_ADMIN_SAFE_ASSIGNMENT',
      created_by TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    ALTER TABLE commercial_campaigns ADD COLUMN IF NOT EXISTS name VARCHAR(255);
    ALTER TABLE commercial_campaigns ADD COLUMN IF NOT EXISTS description TEXT;
    ALTER TABLE commercial_campaigns ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'draft';
    ALTER TABLE commercial_campaigns ADD COLUMN IF NOT EXISTS eligible_from TIMESTAMP;
    ALTER TABLE commercial_campaigns ADD COLUMN IF NOT EXISTS eligible_until TIMESTAMP;
    ALTER TABLE commercial_campaigns ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;
    ALTER TABLE commercial_campaigns ADD COLUMN IF NOT EXISTS assignment_mode VARCHAR(64) DEFAULT 'MASTER_ADMIN_SAFE_ASSIGNMENT';
    ALTER TABLE commercial_campaigns ADD COLUMN IF NOT EXISTS created_by TEXT;
    ALTER TABLE commercial_campaigns ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
    ALTER TABLE commercial_campaigns ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

    CREATE INDEX IF NOT EXISTS commercial_campaigns_status_idx ON commercial_campaigns (status);
    CREATE INDEX IF NOT EXISTS commercial_campaigns_priority_idx ON commercial_campaigns (priority);

    CREATE TABLE IF NOT EXISTS commercial_campaign_benefits (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES commercial_campaigns(id),
      benefit_type VARCHAR(64) NOT NULL,
      benefit_value INTEGER NOT NULL,
      billing_cycles INTEGER NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    ALTER TABLE commercial_campaign_benefits ADD COLUMN IF NOT EXISTS campaign_id INTEGER;
    ALTER TABLE commercial_campaign_benefits ADD COLUMN IF NOT EXISTS benefit_type VARCHAR(64);
    ALTER TABLE commercial_campaign_benefits ADD COLUMN IF NOT EXISTS benefit_value INTEGER;
    ALTER TABLE commercial_campaign_benefits ADD COLUMN IF NOT EXISTS billing_cycles INTEGER;
    ALTER TABLE commercial_campaign_benefits ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

    CREATE UNIQUE INDEX IF NOT EXISTS commercial_campaign_benefits_campaign_unique
      ON commercial_campaign_benefits (campaign_id);

    CREATE TABLE IF NOT EXISTS assigned_commercial_benefits (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES commercial_campaigns(id),
      campaign_benefit_id INTEGER NOT NULL REFERENCES commercial_campaign_benefits(id),
      creche_id INTEGER NOT NULL REFERENCES creches(id),
      status VARCHAR(32) NOT NULL DEFAULT 'scheduled',
      campaign_name TEXT NOT NULL,
      benefit_type VARCHAR(64) NOT NULL,
      benefit_value INTEGER NOT NULL,
      billing_cycles INTEGER NOT NULL,
      target_plan_id INTEGER NOT NULL,
      target_billing_interval VARCHAR(32) NOT NULL,
      catalog_price_cents INTEGER NOT NULL,
      predecessor_condition_id INTEGER REFERENCES customer_commercial_conditions(id),
      predecessor_effective_price_cents INTEGER NOT NULL,
      promotional_price_cents INTEGER NOT NULL,
      restoration_price_cents INTEGER NOT NULL,
      entitlement_pet_limit INTEGER,
      commercial_condition_id INTEGER REFERENCES customer_commercial_conditions(id),
      restoration_condition_id INTEGER REFERENCES customer_commercial_conditions(id),
      stripe_subscription_id TEXT NOT NULL,
      stripe_schedule_id TEXT,
      promotional_stripe_price_id TEXT,
      restoration_stripe_price_id TEXT,
      scheduled_start_period TIMESTAMP,
      first_consumed_period_start TIMESTAMP,
      last_consumed_period_end TIMESTAMP,
      assigned_by TEXT,
      assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMP,
      failure_reason TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS campaign_id INTEGER;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS campaign_benefit_id INTEGER;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS creche_id INTEGER;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'scheduled';
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS campaign_name TEXT;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS benefit_type VARCHAR(64);
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS benefit_value INTEGER;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS billing_cycles INTEGER;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS target_plan_id INTEGER;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS target_billing_interval VARCHAR(32);
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS catalog_price_cents INTEGER;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS predecessor_condition_id INTEGER;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS predecessor_effective_price_cents INTEGER;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS promotional_price_cents INTEGER;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS restoration_price_cents INTEGER;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS entitlement_pet_limit INTEGER;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS commercial_condition_id INTEGER;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS restoration_condition_id INTEGER;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS stripe_schedule_id TEXT;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS promotional_stripe_price_id TEXT;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS restoration_stripe_price_id TEXT;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS scheduled_start_period TIMESTAMP;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS first_consumed_period_start TIMESTAMP;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS last_consumed_period_end TIMESTAMP;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS assigned_by TEXT;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMP DEFAULT NOW();
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS failure_reason TEXT;
    ALTER TABLE assigned_commercial_benefits ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

    CREATE INDEX IF NOT EXISTS assigned_commercial_benefits_creche_status_idx
      ON assigned_commercial_benefits (creche_id, status);

    CREATE INDEX IF NOT EXISTS assigned_commercial_benefits_campaign_creche_idx
      ON assigned_commercial_benefits (campaign_id, creche_id);

    -- Replace obsolete singleActiveCampaignIdx predicate if it misses restoration_review or pending_activation (R36.F1 Section 5)
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'assigned_commercial_benefits_single_active_idx'
          AND (indexdef NOT LIKE '%restoration_review%' OR indexdef NOT LIKE '%pending_activation%')
      ) THEN
        DROP INDEX assigned_commercial_benefits_single_active_idx;
      END IF;
    END $$;

    CREATE UNIQUE INDEX IF NOT EXISTS assigned_commercial_benefits_single_active_idx
      ON assigned_commercial_benefits (creche_id)
      WHERE status IN ('pending', 'pending_activation', 'scheduled', 'active', 'restoration_review');

    CREATE TABLE IF NOT EXISTS benefit_cycle_consumptions (
      id SERIAL PRIMARY KEY,
      assigned_benefit_id INTEGER NOT NULL REFERENCES assigned_commercial_benefits(id),
      cycle_key TEXT NOT NULL,
      contractual_period_start TIMESTAMP NOT NULL,
      contractual_period_end TIMESTAMP NOT NULL,
      cycle_number INTEGER NOT NULL,
      source VARCHAR(64) NOT NULL DEFAULT 'stripe_subscription_cycle',
      source_reference_id TEXT,
      consumed_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    ALTER TABLE benefit_cycle_consumptions ADD COLUMN IF NOT EXISTS assigned_benefit_id INTEGER;
    ALTER TABLE benefit_cycle_consumptions ADD COLUMN IF NOT EXISTS cycle_key TEXT;
    ALTER TABLE benefit_cycle_consumptions ADD COLUMN IF NOT EXISTS contractual_period_start TIMESTAMP;
    ALTER TABLE benefit_cycle_consumptions ADD COLUMN IF NOT EXISTS contractual_period_end TIMESTAMP;
    ALTER TABLE benefit_cycle_consumptions ADD COLUMN IF NOT EXISTS cycle_number INTEGER;
    ALTER TABLE benefit_cycle_consumptions ADD COLUMN IF NOT EXISTS source VARCHAR(64) DEFAULT 'stripe_subscription_cycle';
    ALTER TABLE benefit_cycle_consumptions ADD COLUMN IF NOT EXISTS source_reference_id TEXT;
    ALTER TABLE benefit_cycle_consumptions ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMP DEFAULT NOW();

    CREATE UNIQUE INDEX IF NOT EXISTS benefit_cycle_consumptions_assigned_cycle_key_unique
      ON benefit_cycle_consumptions (assigned_benefit_id, cycle_key);

    CREATE INDEX IF NOT EXISTS benefit_cycle_consumptions_assigned_benefit_idx
      ON benefit_cycle_consumptions (assigned_benefit_id);

    -- 8. Platform Service Requests (Phase R36.G: Assisted Implementation)
    CREATE TABLE IF NOT EXISTS platform_service_requests (
      id SERIAL PRIMARY KEY,
      creche_id INTEGER NOT NULL REFERENCES creches(id),
      service_type VARCHAR(50) NOT NULL DEFAULT 'ASSISTED_IMPLEMENTATION',
      status VARCHAR(30) NOT NULL DEFAULT 'requested',
      requested_by_user_id INTEGER NOT NULL,
      customer_notes TEXT,
      quoted_price_cents INTEGER,
      quote_snapshot_json JSONB,
      scope_notes TEXT,
      admin_notes TEXT,
      quoted_by VARCHAR(100),
      quoted_at TIMESTAMP,
      accepted_at TIMESTAMP,
      accepted_by_user_id INTEGER,
      stripe_checkout_session_id VARCHAR(255),
      stripe_payment_intent_id VARCHAR(255),
      amount_paid_cents INTEGER,
      paid_at TIMESTAMP,
      scheduled_for TIMESTAMP,
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      completed_by VARCHAR(100),
      completion_notes TEXT,
      cancelled_at TIMESTAMP,
      cancelled_by VARCHAR(100),
      cancellation_reason TEXT,
      refund_status VARCHAR(40),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS creche_id INTEGER;
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS service_type VARCHAR(50) DEFAULT 'ASSISTED_IMPLEMENTATION';
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'requested';
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS requested_by_user_id INTEGER;
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS customer_notes TEXT;
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS quoted_price_cents INTEGER;
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS quote_snapshot_json JSONB;
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS scope_notes TEXT;
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS admin_notes TEXT;
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS quoted_by VARCHAR(100);
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS quoted_at TIMESTAMP;
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP;
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS accepted_by_user_id INTEGER;
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS stripe_checkout_session_id VARCHAR(255);
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR(255);
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS amount_paid_cents INTEGER;
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP;
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMP;
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS started_at TIMESTAMP;
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS completed_by VARCHAR(100);
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS completion_notes TEXT;
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS cancelled_by VARCHAR(100);
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS refund_status VARCHAR(40);
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
    ALTER TABLE platform_service_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

    CREATE INDEX IF NOT EXISTS platform_service_requests_creche_status_idx
      ON platform_service_requests (creche_id, status);

    CREATE INDEX IF NOT EXISTS platform_service_requests_checkout_session_idx
      ON platform_service_requests (stripe_checkout_session_id);

    CREATE UNIQUE INDEX IF NOT EXISTS platform_services_active_creche_idx
      ON platform_service_requests (creche_id, service_type)
      WHERE status NOT IN ('completed', 'declined', 'cancelled');

    -- 9. Commercial Communication Outbox (Phase R36.H)
    CREATE TABLE IF NOT EXISTS commercial_communication_outbox (
      id SERIAL PRIMARY KEY,
      event_type VARCHAR(64) NOT NULL,
      event_occurrence_key VARCHAR(255) NOT NULL,
      aggregate_type VARCHAR(64) NOT NULL,
      aggregate_id INTEGER NOT NULL,
      creche_id INTEGER REFERENCES creches(id),
      audience_role VARCHAR(32) NOT NULL,
      recipient_user_id INTEGER NOT NULL REFERENCES users(id),
      channel VARCHAR(32) NOT NULL,
      dedup_key VARCHAR(255) NOT NULL,
      category VARCHAR(32) NOT NULL,
      facts_snapshot_json JSONB NOT NULL,
      template_key VARCHAR(64) NOT NULL,
      template_version VARCHAR(16) NOT NULL DEFAULT '1.0',
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      available_at TIMESTAMP NOT NULL DEFAULT NOW(),
      processing_started_at TIMESTAMP,
      lease_expires_at TIMESTAMP,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      delivered_at TIMESTAMP,
      last_error_code VARCHAR(64),
      last_error_message TEXT,
      provider_message_id TEXT,
      provider_first_attempt_at TIMESTAMP,
      provider_payload_json JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS event_type VARCHAR(64);
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS event_occurrence_key VARCHAR(255);
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS aggregate_type VARCHAR(64);
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS aggregate_id INTEGER;
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS creche_id INTEGER;
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS audience_role VARCHAR(32);
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS recipient_user_id INTEGER;
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS channel VARCHAR(32);
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS dedup_key VARCHAR(255);
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS category VARCHAR(32);
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS facts_snapshot_json JSONB;
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS template_key VARCHAR(64);
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS template_version VARCHAR(16) DEFAULT '1.0';
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'pending';
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS available_at TIMESTAMP DEFAULT NOW();
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMP;
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMP;
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS attempt_count INTEGER DEFAULT 0;
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP;
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS last_error_code VARCHAR(64);
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS last_error_message TEXT;
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS provider_message_id TEXT;
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS provider_first_attempt_at TIMESTAMP;
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS provider_payload_json JSONB;
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
    ALTER TABLE commercial_communication_outbox ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

    CREATE UNIQUE INDEX IF NOT EXISTS commercial_communication_outbox_dedup_key_idx
      ON commercial_communication_outbox (dedup_key);

    CREATE INDEX IF NOT EXISTS commercial_communication_outbox_status_lease_idx
      ON commercial_communication_outbox (status, available_at, lease_expires_at);

    CREATE INDEX IF NOT EXISTS commercial_communication_outbox_creche_recipient_status_idx
      ON commercial_communication_outbox (creche_id, recipient_user_id, status);

    CREATE INDEX IF NOT EXISTS commercial_communication_outbox_aggregate_idx
      ON commercial_communication_outbox (aggregate_type, aggregate_id);

    -- 10. Commercial Notifications (In-App Projection) (Phase R36.H)
    CREATE TABLE IF NOT EXISTS commercial_notifications (
      id SERIAL PRIMARY KEY,
      outbox_id INTEGER REFERENCES commercial_communication_outbox(id),
      creche_id INTEGER REFERENCES creches(id),
      recipient_role VARCHAR(32) NOT NULL,
      recipient_user_id INTEGER NOT NULL REFERENCES users(id),
      category VARCHAR(32) NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      deep_link TEXT,
      metadata_json JSONB,
      read_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    ALTER TABLE commercial_notifications ADD COLUMN IF NOT EXISTS outbox_id INTEGER;
    ALTER TABLE commercial_notifications ADD COLUMN IF NOT EXISTS creche_id INTEGER;
    ALTER TABLE commercial_notifications ADD COLUMN IF NOT EXISTS recipient_role VARCHAR(32);
    ALTER TABLE commercial_notifications ADD COLUMN IF NOT EXISTS recipient_user_id INTEGER;
    ALTER TABLE commercial_notifications ADD COLUMN IF NOT EXISTS category VARCHAR(32);
    ALTER TABLE commercial_notifications ADD COLUMN IF NOT EXISTS title TEXT;
    ALTER TABLE commercial_notifications ADD COLUMN IF NOT EXISTS body TEXT;
    ALTER TABLE commercial_notifications ADD COLUMN IF NOT EXISTS deep_link TEXT;
    ALTER TABLE commercial_notifications ADD COLUMN IF NOT EXISTS metadata_json JSONB;
    ALTER TABLE commercial_notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMP;
    ALTER TABLE commercial_notifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
    ALTER TABLE commercial_notifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

    CREATE UNIQUE INDEX IF NOT EXISTS commercial_notifications_outbox_id_idx
      ON commercial_notifications (outbox_id);

    CREATE INDEX IF NOT EXISTS commercial_notifications_user_creche_read_idx
      ON commercial_notifications (recipient_user_id, creche_id, read_at);
  `);
  console.log("[startup] commercial foundation: schema verificado (idempotente).");
}

/**
 * Phase R37.B: idempotent tutor commercial conditions schema (runs in all environments).
 * Defines tutor_commercial_conditions, tutor_commercial_operations, tutor_commercial_audits.
 */
export async function ensureTutorCommercialSchema(): Promise<void> {
  await (db as any).execute(`
    -- 1. Tutor Commercial Conditions
    CREATE TABLE IF NOT EXISTS tutor_commercial_conditions (
      id SERIAL PRIMARY KEY,
      creche_id INTEGER NOT NULL REFERENCES creches(id),
      tutor_id INTEGER NOT NULL REFERENCES users(id),
      catalogue_item_id INTEGER NOT NULL REFERENCES catalogue_items(id),
      condition_type VARCHAR(32) NOT NULL,
      custom_price_cents INTEGER,
      percentage_bps INTEGER,
      fixed_discount_cents INTEGER,
      valid_from TIMESTAMP NOT NULL,
      valid_until TIMESTAMP,
      status VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED',
      reason TEXT NOT NULL,
      created_by_user_id INTEGER NOT NULL REFERENCES users(id),
      supersedes_condition_id INTEGER,
      revoked_by_user_id INTEGER REFERENCES users(id),
      revoked_at TIMESTAMP,
      idempotency_key VARCHAR(64),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    ALTER TABLE tutor_commercial_conditions ADD COLUMN IF NOT EXISTS custom_price_cents INTEGER;
    ALTER TABLE tutor_commercial_conditions ADD COLUMN IF NOT EXISTS percentage_bps INTEGER;
    ALTER TABLE tutor_commercial_conditions ADD COLUMN IF NOT EXISTS fixed_discount_cents INTEGER;
    ALTER TABLE tutor_commercial_conditions ADD COLUMN IF NOT EXISTS valid_from TIMESTAMP;
    ALTER TABLE tutor_commercial_conditions ADD COLUMN IF NOT EXISTS valid_until TIMESTAMP;
    ALTER TABLE tutor_commercial_conditions ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'SCHEDULED';
    ALTER TABLE tutor_commercial_conditions ADD COLUMN IF NOT EXISTS reason TEXT;
    ALTER TABLE tutor_commercial_conditions ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER;
    ALTER TABLE tutor_commercial_conditions ADD COLUMN IF NOT EXISTS supersedes_condition_id INTEGER;
    ALTER TABLE tutor_commercial_conditions ADD COLUMN IF NOT EXISTS revoked_by_user_id INTEGER;
    ALTER TABLE tutor_commercial_conditions ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP;
    ALTER TABLE tutor_commercial_conditions ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(64);
    ALTER TABLE tutor_commercial_conditions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
    ALTER TABLE tutor_commercial_conditions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

    CREATE INDEX IF NOT EXISTS tutor_commercial_creche_tutor_item_idx
      ON tutor_commercial_conditions (creche_id, tutor_id, catalogue_item_id);

    CREATE INDEX IF NOT EXISTS tutor_commercial_status_validity_idx
      ON tutor_commercial_conditions (creche_id, tutor_id, catalogue_item_id, status, valid_from, valid_until);

    CREATE UNIQUE INDEX IF NOT EXISTS tutor_commercial_unique_idempotency_idx
      ON tutor_commercial_conditions (creche_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tutor_commercial_condition_type_check') THEN
        ALTER TABLE tutor_commercial_conditions ADD CONSTRAINT tutor_commercial_condition_type_check
          CHECK (condition_type IN ('CUSTOM_PRICE', 'PERCENTAGE_DISCOUNT', 'FIXED_DISCOUNT'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tutor_commercial_status_check') THEN
        ALTER TABLE tutor_commercial_conditions ADD CONSTRAINT tutor_commercial_status_check
          CHECK (status IN ('SCHEDULED', 'ACTIVE', 'SUPERSEDED', 'EXPIRED', 'REVOKED', 'CANCELLED'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tutor_commercial_validity_window_check') THEN
        ALTER TABLE tutor_commercial_conditions ADD CONSTRAINT tutor_commercial_validity_window_check
          CHECK (valid_until IS NULL OR valid_until > valid_from);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tutor_commercial_custom_price_check') THEN
        ALTER TABLE tutor_commercial_conditions ADD CONSTRAINT tutor_commercial_custom_price_check
          CHECK (condition_type != 'CUSTOM_PRICE' OR (custom_price_cents IS NOT NULL AND custom_price_cents >= 0 AND percentage_bps IS NULL AND fixed_discount_cents IS NULL));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tutor_commercial_percentage_check') THEN
        ALTER TABLE tutor_commercial_conditions ADD CONSTRAINT tutor_commercial_percentage_check
          CHECK (condition_type != 'PERCENTAGE_DISCOUNT' OR (percentage_bps IS NOT NULL AND percentage_bps >= 0 AND percentage_bps <= 10000 AND custom_price_cents IS NULL AND fixed_discount_cents IS NULL));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tutor_commercial_fixed_discount_check') THEN
        ALTER TABLE tutor_commercial_conditions ADD CONSTRAINT tutor_commercial_fixed_discount_check
          CHECK (condition_type != 'FIXED_DISCOUNT' OR (fixed_discount_cents IS NOT NULL AND fixed_discount_cents >= 0 AND custom_price_cents IS NULL AND percentage_bps IS NULL));
      END IF;
    END $$;

    -- 2. Tutor Commercial Operations Ledger (Idempotency Engine)
    CREATE TABLE IF NOT EXISTS tutor_commercial_operations (
      id SERIAL PRIMARY KEY,
      creche_id INTEGER NOT NULL REFERENCES creches(id),
      tutor_id INTEGER NOT NULL REFERENCES users(id),
      idempotency_key VARCHAR(64) NOT NULL,
      operation_type VARCHAR(64) NOT NULL,
      payload_hash VARCHAR(64) NOT NULL,
      status VARCHAR(32) NOT NULL,
      response_json JSONB,
      condition_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS tutor_commercial_ops_creche_key_idx
      ON tutor_commercial_operations (creche_id, idempotency_key);

    -- 3. Tutor Commercial Audits
    CREATE TABLE IF NOT EXISTS tutor_commercial_audits (
      id SERIAL PRIMARY KEY,
      creche_id INTEGER NOT NULL REFERENCES creches(id),
      tutor_id INTEGER NOT NULL REFERENCES users(id),
      condition_id INTEGER,
      catalogue_item_id INTEGER,
      action VARCHAR(64) NOT NULL,
      actor_user_id INTEGER NOT NULL REFERENCES users(id),
      actor_role VARCHAR(32) NOT NULL,
      reason TEXT NOT NULL,
      before_state JSONB,
      after_state JSONB,
      request_id VARCHAR(64),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS tutor_commercial_audits_creche_tutor_idx
      ON tutor_commercial_audits (creche_id, tutor_id, created_at);
  `);
  console.log("[startup] tutor commercial foundation: schema verificado (idempotente).");
}

export async function ensureCrechePromotionalCampaignSchema() {
  await (db as any).execute(`
    -- 1. Creche Promotional Campaigns
    CREATE TABLE IF NOT EXISTS creche_promotional_campaigns (
      id SERIAL PRIMARY KEY,
      creche_id INTEGER NOT NULL REFERENCES creches(id),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      benefit_type VARCHAR(32) NOT NULL,
      percentage_bps INTEGER,
      fixed_discount_cents INTEGER,
      fixed_promotional_price_cents INTEGER,
      audience_type VARCHAR(32) NOT NULL DEFAULT 'ALL_ACTIVE_TUTORS',
      condition_interaction_policy VARCHAR(32) NOT NULL DEFAULT 'EXCLUDE_IF_TUTOR_CONDITION',
      usage_limit_type VARCHAR(32) NOT NULL DEFAULT 'UNLIMITED',
      usage_limit_per_tutor INTEGER,
      priority INTEGER NOT NULL DEFAULT 100,
      valid_from TIMESTAMP NOT NULL,
      valid_until TIMESTAMP NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'DRAFT',
      reason TEXT,
      created_by_user_id INTEGER NOT NULL REFERENCES users(id),
      supersedes_campaign_id INTEGER REFERENCES creche_promotional_campaigns(id),
      revoked_by_user_id INTEGER REFERENCES users(id),
      revoked_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    ALTER TABLE creche_promotional_campaigns ADD COLUMN IF NOT EXISTS name VARCHAR(255);
    ALTER TABLE creche_promotional_campaigns ADD COLUMN IF NOT EXISTS description TEXT;
    ALTER TABLE creche_promotional_campaigns ADD COLUMN IF NOT EXISTS benefit_type VARCHAR(32);
    ALTER TABLE creche_promotional_campaigns ADD COLUMN IF NOT EXISTS percentage_bps INTEGER;
    ALTER TABLE creche_promotional_campaigns ADD COLUMN IF NOT EXISTS fixed_discount_cents INTEGER;
    ALTER TABLE creche_promotional_campaigns ADD COLUMN IF NOT EXISTS fixed_promotional_price_cents INTEGER;
    ALTER TABLE creche_promotional_campaigns ADD COLUMN IF NOT EXISTS audience_type VARCHAR(32) DEFAULT 'ALL_ACTIVE_TUTORS';
    ALTER TABLE creche_promotional_campaigns ADD COLUMN IF NOT EXISTS condition_interaction_policy VARCHAR(32) DEFAULT 'EXCLUDE_IF_TUTOR_CONDITION';
    ALTER TABLE creche_promotional_campaigns ADD COLUMN IF NOT EXISTS usage_limit_type VARCHAR(32) DEFAULT 'UNLIMITED';
    ALTER TABLE creche_promotional_campaigns ADD COLUMN IF NOT EXISTS usage_limit_per_tutor INTEGER;
    ALTER TABLE creche_promotional_campaigns ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 100;
    ALTER TABLE creche_promotional_campaigns ADD COLUMN IF NOT EXISTS valid_from TIMESTAMP;
    ALTER TABLE creche_promotional_campaigns ADD COLUMN IF NOT EXISTS valid_until TIMESTAMP;
    ALTER TABLE creche_promotional_campaigns ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'DRAFT';
    ALTER TABLE creche_promotional_campaigns ADD COLUMN IF NOT EXISTS reason TEXT;
    ALTER TABLE creche_promotional_campaigns ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER;
    ALTER TABLE creche_promotional_campaigns ADD COLUMN IF NOT EXISTS supersedes_campaign_id INTEGER;
    ALTER TABLE creche_promotional_campaigns ADD COLUMN IF NOT EXISTS revoked_by_user_id INTEGER;
    ALTER TABLE creche_promotional_campaigns ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP;
    ALTER TABLE creche_promotional_campaigns ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
    ALTER TABLE creche_promotional_campaigns ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

    CREATE INDEX IF NOT EXISTS creche_promotional_campaigns_lookup_idx
      ON creche_promotional_campaigns (creche_id, status);

    CREATE INDEX IF NOT EXISTS creche_promotional_campaigns_temporal_idx
      ON creche_promotional_campaigns (creche_id, status, valid_from, valid_until);

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_benefit_type_check') THEN
        ALTER TABLE creche_promotional_campaigns ADD CONSTRAINT creche_promotional_benefit_type_check
          CHECK (benefit_type IN ('PERCENTAGE_DISCOUNT', 'FIXED_DISCOUNT', 'FIXED_PROMOTIONAL_PRICE'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_status_check') THEN
        ALTER TABLE creche_promotional_campaigns ADD CONSTRAINT creche_promotional_status_check
          CHECK (status IN ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED', 'REVOKED'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_audience_type_check') THEN
        ALTER TABLE creche_promotional_campaigns ADD CONSTRAINT creche_promotional_audience_type_check
          CHECK (audience_type IN ('ALL_ACTIVE_TUTORS', 'SELECTED_TUTORS'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_interaction_policy_check') THEN
        ALTER TABLE creche_promotional_campaigns ADD CONSTRAINT creche_promotional_interaction_policy_check
          CHECK (condition_interaction_policy IN ('EXCLUDE_IF_TUTOR_CONDITION', 'ALLOW_IF_BETTER'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_usage_limit_type_check') THEN
        ALTER TABLE creche_promotional_campaigns ADD CONSTRAINT creche_promotional_usage_limit_type_check
          CHECK (usage_limit_type IN ('UNLIMITED', 'ONCE_PER_TUTOR', 'N_PER_TUTOR'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_validity_window_check') THEN
        ALTER TABLE creche_promotional_campaigns ADD CONSTRAINT creche_promotional_validity_window_check
          CHECK (valid_until > valid_from);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_percentage_check') THEN
        ALTER TABLE creche_promotional_campaigns ADD CONSTRAINT creche_promotional_percentage_check
          CHECK (benefit_type != 'PERCENTAGE_DISCOUNT' OR (percentage_bps IS NOT NULL AND percentage_bps >= 1 AND percentage_bps <= 10000 AND fixed_discount_cents IS NULL AND fixed_promotional_price_cents IS NULL));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_fixed_discount_check') THEN
        ALTER TABLE creche_promotional_campaigns ADD CONSTRAINT creche_promotional_fixed_discount_check
          CHECK (benefit_type != 'FIXED_DISCOUNT' OR (fixed_discount_cents IS NOT NULL AND fixed_discount_cents > 0 AND percentage_bps IS NULL AND fixed_promotional_price_cents IS NULL));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_fixed_price_check') THEN
        ALTER TABLE creche_promotional_campaigns ADD CONSTRAINT creche_promotional_fixed_price_check
          CHECK (benefit_type != 'FIXED_PROMOTIONAL_PRICE' OR (fixed_promotional_price_cents IS NOT NULL AND fixed_promotional_price_cents >= 0 AND percentage_bps IS NULL AND fixed_discount_cents IS NULL));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_usage_limit_check') THEN
        ALTER TABLE creche_promotional_campaigns ADD CONSTRAINT creche_promotional_usage_limit_check
          CHECK (usage_limit_type != 'N_PER_TUTOR' OR (usage_limit_per_tutor IS NOT NULL AND usage_limit_per_tutor > 0));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_priority_check') THEN
        ALTER TABLE creche_promotional_campaigns ADD CONSTRAINT creche_promotional_priority_check
          CHECK (priority >= 0);
      END IF;
    END $$;

    -- 2. Campaign Items
    CREATE TABLE IF NOT EXISTS creche_promotional_campaign_items (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES creche_promotional_campaigns(id) ON DELETE CASCADE,
      creche_id INTEGER NOT NULL REFERENCES creches(id),
      catalogue_item_id INTEGER NOT NULL REFERENCES catalogue_items(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS creche_promotional_items_unique_idx
      ON creche_promotional_campaign_items (campaign_id, catalogue_item_id);

    CREATE INDEX IF NOT EXISTS creche_promotional_items_creche_item_idx
      ON creche_promotional_campaign_items (creche_id, catalogue_item_id);

    -- 3. Campaign Selected Tutors
    CREATE TABLE IF NOT EXISTS creche_promotional_campaign_tutors (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES creche_promotional_campaigns(id) ON DELETE CASCADE,
      creche_id INTEGER NOT NULL REFERENCES creches(id),
      tutor_id INTEGER NOT NULL REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS creche_promotional_tutors_unique_idx
      ON creche_promotional_campaign_tutors (campaign_id, tutor_id);

    CREATE INDEX IF NOT EXISTS creche_promotional_tutors_creche_tutor_idx
      ON creche_promotional_campaign_tutors (creche_id, tutor_id);

    -- 4. Campaign Audits
    CREATE TABLE IF NOT EXISTS creche_promotional_campaign_audits (
      id SERIAL PRIMARY KEY,
      creche_id INTEGER NOT NULL REFERENCES creches(id),
      campaign_id INTEGER NOT NULL REFERENCES creche_promotional_campaigns(id),
      action VARCHAR(64) NOT NULL,
      actor_user_id INTEGER NOT NULL REFERENCES users(id),
      actor_role VARCHAR(32) NOT NULL,
      reason TEXT NOT NULL,
      before_state JSONB,
      after_state JSONB,
      request_id VARCHAR(64),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS creche_promotional_audits_campaign_idx
      ON creche_promotional_campaign_audits (creche_id, campaign_id, created_at);

    -- 5. Campaign Operations Ledger
    CREATE TABLE IF NOT EXISTS creche_promotional_campaign_operations (
      id SERIAL PRIMARY KEY,
      creche_id INTEGER NOT NULL REFERENCES creches(id),
      campaign_id INTEGER,
      idempotency_key VARCHAR(64) NOT NULL,
      operation_type VARCHAR(64) NOT NULL,
      payload_hash VARCHAR(64) NOT NULL,
      status VARCHAR(32) NOT NULL,
      response_json JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS creche_promotional_ops_creche_key_idx
      ON creche_promotional_campaign_operations (creche_id, idempotency_key);

    -- 6. Campaign Redemptions (R37.C2A)
    CREATE TABLE IF NOT EXISTS creche_promotional_campaign_redemptions (
      id SERIAL PRIMARY KEY,
      creche_id INTEGER NOT NULL REFERENCES creches(id),
      campaign_id INTEGER NOT NULL REFERENCES creche_promotional_campaigns(id),
      tutor_id INTEGER NOT NULL REFERENCES users(id),
      booking_id INTEGER NOT NULL REFERENCES bookings(id),
      context_type VARCHAR(32) NOT NULL DEFAULT 'BOOKING',
      status VARCHAR(32) NOT NULL DEFAULT 'RESERVED',
      reserved_at TIMESTAMP NOT NULL DEFAULT NOW(),
      applied_at TIMESTAMP,
      released_at TIMESTAMP,
      release_reason TEXT,
      campaign_snapshot JSONB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS creche_promotional_redemptions_unique_context_idx
      ON creche_promotional_campaign_redemptions (creche_id, campaign_id, tutor_id, booking_id);

    CREATE INDEX IF NOT EXISTS creche_promotional_redemptions_usage_idx
      ON creche_promotional_campaign_redemptions (creche_id, tutor_id, campaign_id, status);

    CREATE INDEX IF NOT EXISTS creche_promotional_redemptions_booking_idx
      ON creche_promotional_campaign_redemptions (creche_id, booking_id);

    DO $$ BEGIN
      ALTER TABLE creche_promotional_campaign_redemptions DROP CONSTRAINT IF EXISTS creche_promotional_redemption_status_check;
      ALTER TABLE creche_promotional_campaign_redemptions ADD CONSTRAINT creche_promotional_redemption_status_check
        CHECK (status IN ('RESERVED', 'PARTIALLY_APPLIED', 'APPLIED', 'RELEASED'));
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_redemption_context_type_check') THEN
        ALTER TABLE creche_promotional_campaign_redemptions ADD CONSTRAINT creche_promotional_redemption_context_type_check
          CHECK (context_type IN ('BOOKING'));
      END IF;
    END $$;

    -- 7. Campaign Redemption Items (R37.C2A / R37.C2B)
    CREATE TABLE IF NOT EXISTS creche_promotional_campaign_redemption_items (
      id SERIAL PRIMARY KEY,
      redemption_id INTEGER NOT NULL REFERENCES creche_promotional_campaign_redemptions(id),
      catalogue_item_id INTEGER NOT NULL REFERENCES catalogue_items(id),
      line_type VARCHAR(32) NOT NULL,
      booking_service_id INTEGER REFERENCES booking_services(id),
      base_unit_price_cents INTEGER NOT NULL,
      effective_unit_price_cents INTEGER NOT NULL,
      unit_discount_cents INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      base_line_total_cents INTEGER NOT NULL,
      discount_line_total_cents INTEGER NOT NULL,
      final_line_total_cents INTEGER NOT NULL,
      campaign_snapshot JSONB NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'RESERVED',
      application_mode VARCHAR(32),
      applied_invoice_id INTEGER REFERENCES invoices(id) ON DELETE RESTRICT,
      applied_invoice_item_id INTEGER REFERENCES invoice_items(id) ON DELETE RESTRICT,
      applied_at TIMESTAMP,
      released_at TIMESTAMP,
      release_reason TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );

    ALTER TABLE creche_promotional_campaign_redemption_items ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'RESERVED';
    ALTER TABLE creche_promotional_campaign_redemption_items ADD COLUMN IF NOT EXISTS application_mode VARCHAR(32);
    ALTER TABLE creche_promotional_campaign_redemption_items ADD COLUMN IF NOT EXISTS applied_invoice_id INTEGER REFERENCES invoices(id) ON DELETE RESTRICT;
    ALTER TABLE creche_promotional_campaign_redemption_items ADD COLUMN IF NOT EXISTS applied_invoice_item_id INTEGER REFERENCES invoice_items(id) ON DELETE RESTRICT;
    ALTER TABLE creche_promotional_campaign_redemption_items ADD COLUMN IF NOT EXISTS applied_at TIMESTAMP;
    ALTER TABLE creche_promotional_campaign_redemption_items ADD COLUMN IF NOT EXISTS released_at TIMESTAMP;
    ALTER TABLE creche_promotional_campaign_redemption_items ADD COLUMN IF NOT EXISTS release_reason TEXT;

    CREATE UNIQUE INDEX IF NOT EXISTS creche_promotional_items_primary_unique_idx
      ON creche_promotional_campaign_redemption_items (redemption_id)
      WHERE line_type = 'PRIMARY';

    CREATE UNIQUE INDEX IF NOT EXISTS creche_promotional_items_service_unique_idx
      ON creche_promotional_campaign_redemption_items (redemption_id, booking_service_id)
      WHERE line_type = 'BOOKING_SERVICE';

    CREATE INDEX IF NOT EXISTS creche_promotional_redemption_items_redemption_idx
      ON creche_promotional_campaign_redemption_items (redemption_id);

    CREATE INDEX IF NOT EXISTS creche_promotional_redemption_items_catalogue_idx
      ON creche_promotional_campaign_redemption_items (catalogue_item_id);

    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_redemption_item_line_type_check') THEN
        ALTER TABLE creche_promotional_campaign_redemption_items ADD CONSTRAINT creche_promotional_redemption_item_line_type_check
          CHECK (line_type IN ('PRIMARY', 'BOOKING_SERVICE'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_redemption_item_service_fk_check') THEN
        ALTER TABLE creche_promotional_campaign_redemption_items ADD CONSTRAINT creche_promotional_redemption_item_service_fk_check
          CHECK ((line_type = 'PRIMARY' AND booking_service_id IS NULL) OR (line_type = 'BOOKING_SERVICE' AND booking_service_id IS NOT NULL));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_redemption_item_base_price_check') THEN
        ALTER TABLE creche_promotional_campaign_redemption_items ADD CONSTRAINT creche_promotional_redemption_item_base_price_check
          CHECK (base_unit_price_cents >= 0);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_redemption_item_effective_price_check') THEN
        ALTER TABLE creche_promotional_campaign_redemption_items ADD CONSTRAINT creche_promotional_redemption_item_effective_price_check
          CHECK (effective_unit_price_cents >= 0 AND effective_unit_price_cents <= base_unit_price_cents);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_redemption_item_unit_discount_check') THEN
        ALTER TABLE creche_promotional_campaign_redemption_items ADD CONSTRAINT creche_promotional_redemption_item_unit_discount_check
          CHECK (unit_discount_cents = base_unit_price_cents - effective_unit_price_cents);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_redemption_item_quantity_check') THEN
        ALTER TABLE creche_promotional_campaign_redemption_items ADD CONSTRAINT creche_promotional_redemption_item_quantity_check
          CHECK (quantity > 0);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_redemption_item_base_line_total_check') THEN
        ALTER TABLE creche_promotional_campaign_redemption_items ADD CONSTRAINT creche_promotional_redemption_item_base_line_total_check
          CHECK (base_line_total_cents = base_unit_price_cents * quantity);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_redemption_item_final_line_total_check') THEN
        ALTER TABLE creche_promotional_campaign_redemption_items ADD CONSTRAINT creche_promotional_redemption_item_final_line_total_check
          CHECK (final_line_total_cents = effective_unit_price_cents * quantity);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_redemption_item_discount_line_total_check') THEN
        ALTER TABLE creche_promotional_campaign_redemption_items ADD CONSTRAINT creche_promotional_redemption_item_discount_line_total_check
          CHECK (discount_line_total_cents = base_line_total_cents - final_line_total_cents);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_redemption_item_status_check') THEN
        ALTER TABLE creche_promotional_campaign_redemption_items ADD CONSTRAINT creche_promotional_redemption_item_status_check
          CHECK (status IN ('RESERVED', 'APPLIED', 'RELEASED'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_redemption_item_app_mode_check') THEN
        ALTER TABLE creche_promotional_campaign_redemption_items ADD CONSTRAINT creche_promotional_redemption_item_app_mode_check
          CHECK (application_mode IS NULL OR application_mode IN ('INVOICE_ITEM', 'COMPLIMENTARY_ZERO_VALUE'));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creche_promotional_redemption_item_app_consistency_check') THEN
        ALTER TABLE creche_promotional_campaign_redemption_items ADD CONSTRAINT creche_promotional_redemption_item_app_consistency_check
          CHECK (
            (status = 'RESERVED' AND application_mode IS NULL AND applied_invoice_id IS NULL AND applied_invoice_item_id IS NULL AND applied_at IS NULL) OR
            (status = 'RELEASED' AND application_mode IS NULL AND applied_invoice_id IS NULL AND applied_invoice_item_id IS NULL) OR
            (status = 'APPLIED' AND application_mode = 'INVOICE_ITEM' AND applied_invoice_id IS NOT NULL AND applied_invoice_item_id IS NOT NULL AND applied_at IS NOT NULL) OR
            (status = 'APPLIED' AND application_mode = 'COMPLIMENTARY_ZERO_VALUE' AND applied_invoice_id IS NULL AND applied_invoice_item_id IS NULL AND applied_at IS NOT NULL)
          );
      END IF;

      -- invoice_items foreign keys to campaign tables
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_applied_campaign_fk') THEN
        ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_applied_campaign_fk
          FOREIGN KEY (applied_campaign_id) REFERENCES creche_promotional_campaigns(id) ON DELETE RESTRICT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_applied_redemption_fk') THEN
        ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_applied_redemption_fk
          FOREIGN KEY (applied_campaign_redemption_id) REFERENCES creche_promotional_campaign_redemptions(id) ON DELETE RESTRICT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_items_applied_redemption_item_fk') THEN
        ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_applied_redemption_item_fk
          FOREIGN KEY (applied_campaign_redemption_item_id) REFERENCES creche_promotional_campaign_redemption_items(id) ON DELETE RESTRICT;
      END IF;
    END $$;
  `);
  console.log("[startup] creche promotional campaigns foundation: schema verificado (idempotente).");
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
  // Phase R36.C Slice 1: idempotent commercial foundation schema (runs in all environments)
  await ensureCommercialFoundationSchema();
  // Phase R37.B: idempotent tutor commercial conditions schema (runs in all environments)
  await ensureTutorCommercialSchema();
  // Phase R37.C1: idempotent creche promotional campaigns schema (runs in all environments)
  await ensureCrechePromotionalCampaignSchema();

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
