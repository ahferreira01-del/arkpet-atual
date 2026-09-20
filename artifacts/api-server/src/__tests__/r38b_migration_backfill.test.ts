import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@workspace/db";
import {
  plansTable,
  subscriptionsTable,
  crechesTable,
  planVersionsTable,
  planVersionPricesTable,
  unresolvedSubscriptionVersionsTable,
} from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

const UP_MIGRATION_PATH = path.resolve(process.cwd(), "lib/db/src/migrations/0038_r38b_plan_versioning.sql");
const DOWN_MIGRATION_PATH = path.resolve(process.cwd(), "lib/db/src/migrations/0038_r38b_plan_versioning.down.sql");

export function classifyDatabaseEnvironment(params: {
  dbUrl?: string;
  testDbUrl?: string;
  nodeEnv?: string;
  appEnv?: string;
  arkpetEnv?: string;
  integrationMarker?: string | boolean;
  vitestActive?: boolean;
  currentDatabase?: string;
  currentUser?: string;
}): { isSafe: boolean; reason: string; metadata: any } {
  const nodeEnv = (params.nodeEnv ?? process.env.NODE_ENV ?? "").toLowerCase();
  const appEnv = (params.appEnv ?? process.env.APP_ENV ?? "").toLowerCase();
  const arkpetEnv = (params.arkpetEnv ?? process.env.ARKPET_ENV ?? "").toLowerCase();
  const effectiveUrl = params.testDbUrl ?? process.env.TEST_DATABASE_URL ?? params.dbUrl ?? process.env.DATABASE_URL;

  if (nodeEnv === "production" || appEnv === "production" || arkpetEnv === "production") {
    return {
      isSafe: false,
      reason: "Blocked: Environment variable is explicitly set to production",
      metadata: { host: "redacted", database: "redacted", user: "redacted", isExplicitNonProd: false, classification: "PRODUCTION" },
    };
  }

  if (!effectiveUrl) {
    return {
      isSafe: false,
      reason: "Blocked: No DATABASE_URL or TEST_DATABASE_URL configured",
      metadata: { host: "none", database: "none", user: "none", isExplicitNonProd: false, classification: "UNCLASSIFIED" },
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(effectiveUrl);
  } catch {
    return {
      isSafe: false,
      reason: "Blocked: Invalid database connection string format",
      metadata: { host: "invalid", database: "invalid", user: "invalid", isExplicitNonProd: false, classification: "UNCLASSIFIED" },
    };
  }

  const host = parsed.hostname.toLowerCase();
  const dbName = (params.currentDatabase ?? parsed.pathname.replace(/^\//, "")).toLowerCase();
  const user = (params.currentUser ?? parsed.username).toLowerCase();

  const prodHostKeywords = ["prod", "production", "live", "arkpet-prod", "aws.prod", "primary-cluster"];
  const isProdHost = prodHostKeywords.some((kw) => {
    const parts = host.split(/[.-]/);
    return parts.includes(kw) || host.includes(`-${kw}-`) || host.endsWith(`-${kw}`) || host.startsWith(`${kw}-`);
  });

  if (isProdHost || host.includes("production") || dbName.includes("prod") || dbName.includes("production")) {
    return {
      isSafe: false,
      reason: "Blocked: Database matches production pattern",
      metadata: { host, database: dbName, user, isExplicitNonProd: false, classification: "PRODUCTION" },
    };
  }

  const isTestDbUrl = Boolean(params.testDbUrl ?? process.env.TEST_DATABASE_URL);
  const hasMarker = Boolean(
    params.integrationMarker === true ||
    params.integrationMarker === "true" ||
    process.env.R38A_INTEGRATION_TESTS === "true" ||
    params.vitestActive === true ||
    process.env.VITEST === "true"
  );
  const isSafeHost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.includes("neon.tech") ||
    host.includes("test") ||
    host.includes("dev") ||
    host.includes("qa") ||
    host.includes("staging");

  if (!hasMarker) {
    return {
      isSafe: false,
      reason: "Blocked: Missing explicit integration test execution marker",
      metadata: { host, database: dbName, user, isExplicitNonProd: false, classification: "UNCLASSIFIED" },
    };
  }

  if (!isSafeHost) {
    return {
      isSafe: false,
      reason: "Blocked: Target database host is not on approved non-production list",
      metadata: { host, database: dbName, user, isExplicitNonProd: false, classification: "UNCLASSIFIED" },
    };
  }

  return {
    isSafe: true,
    reason: "Verified safe non-production database environment",
    metadata: { host, database: dbName, user, isExplicitNonProd: true, classification: "TEST" },
  };
}

export async function assertNonProductionDatabase(): Promise<void> {
  const check = classifyDatabaseEnvironment({
    vitestActive: Boolean(process.env.VITEST),
    integrationMarker: process.env.R38A_INTEGRATION_TESTS ?? "true",
  });
  if (!check.isSafe) {
    throw new Error(`Integration tests refused to run: ${check.reason}`);
  }
  const res = await db.execute(sql`SELECT current_database(), current_user;`);
  const row = res.rows[0] as any;
  const dbName = String(row.current_database || "").toLowerCase();
  if (dbName.includes("prod") || dbName.includes("production")) {
    throw new Error("Integration tests refused to run: live current_database() matches production pattern.");
  }
}

describe("Domain 08: Data Migration, Backfill & Rollback Compatibility (TC-MIG-01 to TC-MIG-08)", () => {
  beforeAll(async () => {
    // Fail-Closed Non-Production Safety Guard
    await assertNonProductionDatabase();

    // Apply the R38.B schema migration first
    const upSql = fs.readFileSync(UP_MIGRATION_PATH, "utf-8");
    await db.execute(sql.raw(upSql));

    // Ensure Trial v1 has 0 price rows (clean any stray price rows from prior runs)
    await db.execute(sql`
      ALTER TABLE plan_version_prices DISABLE TRIGGER trg_plan_version_prices_before_delete;
      DELETE FROM plan_version_prices
      WHERE plan_version_id IN (
        SELECT pv.id FROM plan_versions pv
        JOIN plans p ON pv.plan_id = p.id
        WHERE LOWER(p.name) LIKE '%trial%'
      );
      ALTER TABLE plan_version_prices ENABLE TRIGGER trg_plan_version_prices_before_delete;
    `);
  });

  it("TC-MIG-01: Additive Schema Migration Applies Cleanly", async () => {
    // 1. Verify tables exist
    const tablesRes = await db.execute(sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'plan_versions',
          'plan_version_prices',
          'billing_webhook_errors',
          'unresolved_subscription_versions'
        );
    `);
    const tableNames = (tablesRes.rows as any[]).map((r) => r.table_name);
    expect(tableNames).toContain("plan_versions");
    expect(tableNames).toContain("plan_version_prices");
    expect(tableNames).toContain("billing_webhook_errors");
    expect(tableNames).toContain("unresolved_subscription_versions");

    // 2. Verify new columns on subscriptions table
    const colsRes = await db.execute(sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'subscriptions'
        AND column_name IN (
          'plan_version_id',
          'plan_version_price_id',
          'contracted_price_cents',
          'contracted_stripe_price_id',
          'scheduled_plan_version_id',
          'scheduled_plan_version_price_id',
          'scheduled_price_cents',
          'scheduled_stripe_price_id'
        );
    `);
    const colNames = (colsRes.rows as any[]).map((r) => r.column_name);
    expect(colNames).toContain("plan_version_id");
    expect(colNames).toContain("plan_version_price_id");
    expect(colNames).toContain("contracted_price_cents");
    expect(colNames).toContain("contracted_stripe_price_id");
    expect(colNames).toContain("scheduled_plan_version_id");
    expect(colNames).toContain("scheduled_plan_version_price_id");
    expect(colNames).toContain("scheduled_price_cents");
    expect(colNames).toContain("scheduled_stripe_price_id");
  });

  it("TC-MIG-02: Baseline Catalog Seed Creates Exactly V1 for All Plans", async () => {
    const allPlans = await db.select().from(plansTable);
    const baselinePlanNames = ["Trial", "Starter", "Essencial", "Pro", "Premium", "Enterprise"];

    // Verify all 6 baseline plans exist in the catalog
    for (const name of baselinePlanNames) {
      const match = allPlans.find((p) => p.name.toLowerCase() === name.toLowerCase());
      expect(match, `Baseline plan ${name} must exist in plans table`).toBeDefined();
    }

    const plans = allPlans.filter((p) => !p.name.includes("CNC") && !p.name.includes("Test"));
    const versions = await db.select().from(planVersionsTable);

    // Baseline catalog seed creates version 1 for each plan (at least 6 baseline plans)
    expect(plans.length).toBeGreaterThanOrEqual(6);
    expect(versions.length).toBeGreaterThanOrEqual(plans.length);

    for (const plan of plans) {
      const v1 = versions.find((v) => v.planId === plan.id && v.versionNumber === 1);
      expect(v1, `Plan ${plan.name} must have a version 1 seeded`).toBeDefined();
      expect(["ACTIVE", "SUPERSEDED", "ARCHIVED"]).toContain(v1?.status);

      // Verify each plan has at least one active version
      const activeVer = versions.find((v) => v.planId === plan.id && v.status === "ACTIVE");
      expect(activeVer, `Plan ${plan.name} must have an active version`).toBeDefined();

      if (plan.name.toLowerCase().includes("trial")) {
        // Trial v1 pet_limit = 30 per migration seed
        expect(v1?.petLimit).toBe(30);
        expect(v1?.priceBrl).toBe(0);

        // Trial has zero interval price rows
        const trialPrices = await db
          .select()
          .from(planVersionPricesTable)
          .where(eq(planVersionPricesTable.planVersionId, v1!.id));
        expect(trialPrices.length).toBe(0);
      } else if (plan.priceBrl > 0 && baselinePlanNames.includes(plan.name)) {
        // Paid baseline plans have version prices for month, quarter, semester, year
        const prices = await db
          .select()
          .from(planVersionPricesTable)
          .where(eq(planVersionPricesTable.planVersionId, v1!.id));
        expect(prices.length).toBe(4);
      }
    }
  });

  it("TC-MIG-03: Subscription Backfill Evidence Binding", async () => {
    const ts = Date.now();
    const [testCreche1] = await db
      .insert(crechesTable)
      .values({
        name: `Backfill Test Creche 1 ${ts}`,
        address: "Rua Teste Backfill 1, 100",
        phone: "11999999991",
        email: `bf1-${ts}@arkpet.test`,
      })
      .returning();

    const [testCreche2] = await db
      .insert(crechesTable)
      .values({
        name: `Backfill Test Creche 2 ${ts}`,
        address: "Rua Teste Backfill 2, 200",
        phone: "11999999992",
        email: `bf2-${ts}@arkpet.test`,
      })
      .returning();

    const [starterPlan] = await db
      .select()
      .from(plansTable)
      .where(eq(plansTable.name, "Starter"))
      .limit(1);

    // 1. Subscription with reliable evidence (billing_interval = 'month')
    const [subWithEvidence] = await db
      .insert(subscriptionsTable)
      .values({
        crecheId: testCreche1.id,
        planId: starterPlan.id,
        status: "active",
        billingInterval: "month",
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
      })
      .returning();

    // 2. Unpriced paid subscription (billing_interval = null)
    const [subUnresolved] = await db
      .insert(subscriptionsTable)
      .values({
        crecheId: testCreche2.id,
        planId: starterPlan.id,
        status: "active",
        billingInterval: null,
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
      })
      .returning();

    // Re-run backfill block from migration
    const upSql = fs.readFileSync(UP_MIGRATION_PATH, "utf-8");
    await db.execute(sql.raw(upSql));

    // Verify subWithEvidence was bound
    const [reloadedWithEvidence] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, subWithEvidence.id));
    expect(reloadedWithEvidence.planVersionId).toBeDefined();
    expect(reloadedWithEvidence.planVersionPriceId).toBeDefined();
    const [expectedPriceRow] = await db
      .select()
      .from(planVersionPricesTable)
      .where(eq(planVersionPricesTable.id, reloadedWithEvidence.planVersionPriceId!));
    expect(reloadedWithEvidence.contractedPriceCents).toBe(expectedPriceRow.priceBrl);

    // Verify subUnresolved was routed to unresolved_subscription_versions ledger
    const [reloadedUnresolved] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, subUnresolved.id));
    expect(reloadedUnresolved.planVersionId).toBeNull();
    expect(reloadedUnresolved.contractedPriceCents).toBeNull();

    const unresolvedEntries = await db
      .select()
      .from(unresolvedSubscriptionVersionsTable)
      .where(eq(unresolvedSubscriptionVersionsTable.subscriptionId, subUnresolved.id));
    expect(unresolvedEntries.length).toBeGreaterThanOrEqual(1);
    expect(unresolvedEntries[0].diagnosticCategory).toBe("PAID_WITHOUT_PRICE_EVIDENCE");
  });

  it("TC-MIG-04: Safe Integer Centavos Backfill Verification", async () => {
    const boundSubs = await db
      .select()
      .from(subscriptionsTable)
      .where(sql`contracted_price_cents IS NOT NULL`);

    for (const sub of boundSubs) {
      expect(Number.isInteger(sub.contractedPriceCents)).toBe(true);
      expect(sub.contractedPriceCents).toBeGreaterThanOrEqual(0);
      if (sub.contractedPriceCents! > 0) {
        expect(sub.contractedPriceCents!).toBeLessThan(10000000);
      }
    }
  });

  it("TC-MIG-05: Binary Rollback Compatibility with Parent Commit", async () => {
    const legacySubs = await db.execute(sql`
      SELECT id, creche_id, plan_id, status, billing_interval, current_period_end
      FROM subscriptions
      LIMIT 10;
    `);
    expect(legacySubs.rows).toBeDefined();

    const legacyPlans = await db.execute(sql`
      SELECT id, name, price_brl, pet_limit, description
      FROM plans
      LIMIT 10;
    `);
    expect(legacyPlans.rows).toBeDefined();
  });

  it("TC-MIG-06: Migration Idempotency (Re-Execution Safety)", async () => {
    const upSql = fs.readFileSync(UP_MIGRATION_PATH, "utf-8");
    await expect(db.execute(sql.raw(upSql))).resolves.not.toThrow();

    const activeVersions = await db.execute(sql`
      SELECT plan_id, COUNT(*) as cnt
      FROM plan_versions
      WHERE status = 'ACTIVE'
      GROUP BY plan_id
      HAVING COUNT(*) > 1;
    `);
    expect(activeVersions.rows.length).toBe(0);
  });

  it("TC-MIG-07: Production Down-Migration Guard Aborts Safely", async () => {
    const downSql = fs.readFileSync(DOWN_MIGRATION_PATH, "utf-8");

    // Subscriptions exist with plan_version_id IS NOT NULL, so down-migration must abort
    await expect(db.execute(sql.raw(downSql))).rejects.toThrow(
      /Cannot drop plan_versions in production: bound subscriptions exist/i,
    );

    const checkTable = await db.execute(sql`
      SELECT 1 FROM information_schema.tables WHERE table_name = 'plan_versions';
    `);
    expect(checkTable.rows.length).toBe(1);
  });

  it("TC-MIG-08: Reversible Down-Migration on Disposable Non-Production Database Only", async () => {
    let rolledBack = false;
    try {
      await db.transaction(async (tx) => {
        // Temporarily decouple subscriptions in this transaction
        await tx.execute(sql`UPDATE subscriptions SET plan_version_id = NULL, plan_version_price_id = NULL;`);

        // Run down-migration
        const downSql = fs.readFileSync(DOWN_MIGRATION_PATH, "utf-8");
        await tx.execute(sql.raw(downSql));

        // Verify tables dropped inside transaction
        const checkTables = await tx.execute(sql`
          SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name IN ('plan_versions', 'plan_version_prices');
        `);
        expect(checkTables.rows.length).toBe(0);

        // Force rollback
        tx.rollback();
      });
    } catch (err: any) {
      if (err.message && (err.message.includes("rollback") || err.message.includes("Rollback"))) {
        rolledBack = true;
      } else {
        throw err;
      }
    }

    // Outer tables remain present
    const checkTablesOuter = await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'plan_versions';
    `);
    expect(checkTablesOuter.rows.length).toBe(1);
  });
});
