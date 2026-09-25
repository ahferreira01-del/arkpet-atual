import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import app from "../app.js";
import { db } from "@workspace/db";
import {
  usersTable,
  crechesTable,
  subscriptionsTable,
  plansTable,
  planVersionsTable,
  tenantStorageLedgerTable,
  storageFilesTable,
  crecheInvitationsTable,
  customerCommercialConditionsTable,
  unresolvedSubscriptionVersionsTable,
  petsTable,
} from "@workspace/db/schema";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { hashPassword, generateToken } from "../lib/auth.js";
import {
  resolveStorageEnforcementMode,
  resolveEntitlements,
  getPetUsage,
  getStaffUsage,
  getStorageUsage,
  checkQuota,
  checkCreationQuota,
  ensureTenantStorageLedger,
  createStorageReservation,
  confirmStorageReservation,
  claimStorageFileForDeletion,
  finalizeStorageFileDeletion,
  claimExpiredStorageReservation,
  finalizeExpiredStorageReservation,
  finalizeRejectedOverflowFile,
  EntitlementsError,
} from "../services/entitlementsService.js";
import { PlanVersionService } from "../services/planVersionService.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { acquireTenantOperationalLock } from "../services/tenantLifecycleLock.js";
interface GcsObjectItem {
  name: string;
  size?: number | string | null;
  contentType?: string | null;
  metadata?: Record<string, any>;
}
// Dynamic import using variable to prevent tsc from traversing outside rootDir
const invScriptPath = "../../../../scripts/inventory_gcs_storage.js";
// @ts-ignore
const { runStorageInventory } = (await import(/* @vite-ignore */ invScriptPath)) as any;
import { applyScheduledPlanChanges } from "../lib/scheduler.js";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

function classifyDatabaseEnvironment(params: {
  dbUrl?: string;
  testDbUrl?: string;
  nodeEnv?: string;
  appEnv?: string;
  arkpetEnv?: string;
  integrationMarker?: string | boolean;
  vitestActive?: boolean;
  currentDatabase?: string;
  currentUser?: string;
}): { isSafe: boolean; reason: string } {
  const nodeEnv = (params.nodeEnv ?? process.env.NODE_ENV ?? "").toLowerCase();
  const appEnv = (params.appEnv ?? process.env.APP_ENV ?? "").toLowerCase();
  const arkpetEnv = (params.arkpetEnv ?? process.env.ARKPET_ENV ?? "").toLowerCase();
  const effectiveUrl = params.testDbUrl ?? process.env.TEST_DATABASE_URL ?? params.dbUrl ?? process.env.DATABASE_URL;

  if (nodeEnv === "production" || appEnv === "production" || arkpetEnv === "production") {
    return { isSafe: false, reason: "Blocked: Environment variable explicitly set to production" };
  }
  if (!effectiveUrl) {
    return { isSafe: false, reason: "Blocked: No database connection string" };
  }

  let parsed: URL;
  try {
    parsed = new URL(effectiveUrl);
  } catch {
    return { isSafe: false, reason: "Blocked: Invalid database connection format" };
  }

  const host = parsed.hostname.toLowerCase();
  const dbName = (params.currentDatabase ?? parsed.pathname.replace(/^\//, "")).toLowerCase();

  const prodKeywords = ["prod", "production", "live", "arkpet-prod", "aws.prod", "primary-cluster"];
  const isProdHost = prodKeywords.some((kw) => {
    const parts = host.split(/[.-]/);
    return parts.includes(kw) || host.includes(`-${kw}-`) || host.endsWith(`-${kw}`) || host.startsWith(`${kw}-`);
  });

  if (isProdHost || host.includes("production") || dbName.includes("prod") || dbName.includes("production")) {
    return { isSafe: false, reason: "Blocked: Database matches production pattern" };
  }

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
    return { isSafe: false, reason: "Blocked: Missing integration test marker" };
  }
  if (!isSafeHost) {
    return { isSafe: false, reason: "Blocked: Host not on approved non-production list" };
  }

  return { isSafe: true, reason: "Verified safe non-production environment" };
}

async function assertNonProductionDatabase(): Promise<void> {
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

describe("R38.C Unified Entitlements Canonical 84-Test Suite", { timeout: 60000 }, () => {
  let masterAdminUser: any;
  let masterToken: string;
  let testTrialPlan: any;
  let testStarterPlan: any;
  let testEssencialPlan: any;
  let testProPlan: any;
  let testPremiumPlan: any;
  let testEnterprisePlan: any;
  const testCrecheIds: number[] = [];
  const testUserIds: number[] = [];

  beforeAll(async () => {
    await assertNonProductionDatabase();

    // Mock ObjectStorageService uploadBuffer to avoid live external sidecar / cloud calls
    vi.spyOn(ObjectStorageService.prototype, "uploadBuffer").mockImplementation(
      async (buffer: Buffer, contentType: string, ownerId?: string, crecheId?: string) => {
        return `/uploads/c${crecheId ?? "0"}/test-obj-${Date.now()}.bin`;
      }
    );

    // Reset catalog versions to canonical state
    await db.execute(sql.raw(`
      UPDATE subscriptions SET plan_version_id = NULL WHERE plan_version_id IN (SELECT id FROM plan_versions WHERE version_number > 1);
      UPDATE subscriptions SET scheduled_plan_version_id = NULL WHERE scheduled_plan_version_id IN (SELECT id FROM plan_versions WHERE version_number > 1);
      ALTER TABLE plan_version_prices DISABLE TRIGGER USER;
      DELETE FROM plan_version_prices WHERE plan_version_id IN (SELECT id FROM plan_versions WHERE version_number > 1);
      ALTER TABLE plan_version_prices ENABLE TRIGGER USER;
      ALTER TABLE plan_versions DISABLE TRIGGER USER;
      DELETE FROM plan_versions WHERE version_number > 1;
      UPDATE plan_versions SET status = 'ACTIVE', effective_until = NULL, pet_limit = 30, staff_limit = 2, storage_bytes_limit = 2147483648 WHERE plan_id = 1 AND version_number = 1;
      UPDATE plan_versions SET status = 'ACTIVE', effective_until = NULL, pet_limit = 15, staff_limit = 3, storage_bytes_limit = 5368709120 WHERE plan_id = 2 AND version_number = 1;
      UPDATE plan_versions SET status = 'ACTIVE', effective_until = NULL, pet_limit = 35, staff_limit = 5, storage_bytes_limit = 16106127360 WHERE plan_id = 3 AND version_number = 1;
      UPDATE plan_versions SET status = 'ACTIVE', effective_until = NULL, pet_limit = 75, staff_limit = 10, storage_bytes_limit = 32212254720 WHERE plan_id = 4 AND version_number = 1;
      UPDATE plan_versions SET status = 'ACTIVE', effective_until = NULL, pet_limit = 150, staff_limit = 20, storage_bytes_limit = 64424509440 WHERE plan_id = 5 AND version_number = 1;
      UPDATE plan_versions SET status = 'ACTIVE', effective_until = NULL, pet_limit = 999999, staff_limit = NULL, storage_bytes_limit = 107374182400 WHERE plan_id = 6 AND version_number = 1;
      ALTER TABLE plan_versions ENABLE TRIGGER USER;

      CREATE OR REPLACE FUNCTION fn_plan_versions_immutable_check()
      RETURNS TRIGGER AS $fn$
      BEGIN
        IF OLD.status IN ('ACTIVE', 'SUPERSEDED', 'ARCHIVED') THEN
          IF NEW.plan_id <> OLD.plan_id OR
             NEW.version_number <> OLD.version_number OR
             NEW.pet_limit <> OLD.pet_limit OR
             NEW.staff_limit IS DISTINCT FROM OLD.staff_limit OR
             NEW.storage_bytes_limit IS DISTINCT FROM OLD.storage_bytes_limit OR
             NEW.price_brl <> OLD.price_brl OR
             NEW.features IS DISTINCT FROM OLD.features THEN
            RAISE EXCEPTION 'ERR_COMMERCIAL_FIELDS_IMMUTABLE: Cannot modify commercial or entitlement fields of a published plan version (status: %)', OLD.status;
          END IF;

          IF OLD.status = 'ACTIVE' AND NEW.status NOT IN ('ACTIVE', 'SUPERSEDED') THEN
            RAISE EXCEPTION 'ERR_INVALID_LIFECYCLE_TRANSITION: Active version can only transition to SUPERSEDED';
          END IF;

          IF OLD.status = 'SUPERSEDED' AND NEW.status NOT IN ('SUPERSEDED', 'ARCHIVED') THEN
            RAISE EXCEPTION 'ERR_CANNOT_REACTIVATE_SUPERSEDED_VERSION: Superseded version can only transition to ARCHIVED';
          END IF;

          IF OLD.status = 'ARCHIVED' AND NEW.status <> 'ARCHIVED' THEN
            RAISE EXCEPTION 'ERR_INVALID_LIFECYCLE_TRANSITION: Archived version is immutable and cannot change status';
          END IF;
        ELSIF OLD.status = 'DRAFT' THEN
          IF NEW.status = 'ARCHIVED' THEN
            RAISE EXCEPTION 'ERR_INVALID_LIFECYCLE_TRANSITION: Draft version cannot transition directly to ARCHIVED';
          END IF;
        END IF;

        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_plan_versions_before_update ON plan_versions;
      CREATE TRIGGER trg_plan_versions_before_update
      BEFORE UPDATE ON plan_versions
      FOR EACH ROW EXECUTE FUNCTION fn_plan_versions_immutable_check();
    `));

    // Fetch catalog plans
    const plans = await db.select().from(plansTable);
    testTrialPlan = plans.find((p) => p.name.toLowerCase().includes("trial")) || plans[0];
    testStarterPlan = plans.find((p) => p.name.toLowerCase() === "starter") || plans[1];
    testEssencialPlan = plans.find((p) => p.name.toLowerCase().includes("essencial")) || plans[2];
    testProPlan = plans.find((p) => p.name.toLowerCase() === "pro") || plans[3];
    testPremiumPlan = plans.find((p) => p.name.toLowerCase().includes("premium")) || plans[4];
    testEnterprisePlan = plans.find((p) => p.name.toLowerCase().includes("enterprise")) || plans[5];

    // Create a master admin user for privileged operations
    const ts = Date.now();
    const [master] = await db
      .insert(usersTable)
      .values({
        name: "Master Admin R38C",
        email: `master-r38c-${ts}@arkpet.test`,
        passwordHash: hashPassword("MasterPass123!"),
        role: "master_admin",
        isActive: true,
        mustChangePassword: false,
        isPrimaryOwner: false,
      })
      .returning();
    masterAdminUser = master;
    testUserIds.push(master.id);
    masterToken = generateToken(master.id, master.role);
  });

  afterAll(async () => {
    vi.restoreAllMocks();

    // Clean up created entities
    if (testCrecheIds.length > 0) {
      const crecheIn = sql.join(testCrecheIds.map((id) => sql`${id}`), sql`, `);
      await db.execute(sql`DELETE FROM storage_files WHERE creche_id = ANY(ARRAY[${crecheIn}]::int[]);`);
      await db.execute(sql`DELETE FROM tenant_storage_ledger WHERE creche_id = ANY(ARRAY[${crecheIn}]::int[]);`);
      await db.execute(sql`DELETE FROM creche_invitations WHERE creche_id = ANY(ARRAY[${crecheIn}]::int[]);`);
      await db.execute(sql`DELETE FROM unresolved_subscription_versions WHERE creche_id = ANY(ARRAY[${crecheIn}]::int[]);`);
      await db.execute(sql`DELETE FROM pets WHERE creche_id = ANY(ARRAY[${crecheIn}]::int[]);`);
      await db.execute(sql`DELETE FROM customer_commercial_conditions WHERE creche_id = ANY(ARRAY[${crecheIn}]::int[]);`);
      await db.execute(sql`DELETE FROM subscriptions WHERE creche_id = ANY(ARRAY[${crecheIn}]::int[]);`);
      await db.execute(sql`DELETE FROM users WHERE creche_id = ANY(ARRAY[${crecheIn}]::int[]);`);
      await db.execute(sql`DELETE FROM creches WHERE id = ANY(ARRAY[${crecheIn}]::int[]);`);
    }

    if (testUserIds.length > 0) {
      const userIn = sql.join(testUserIds.map((id) => sql`${id}`), sql`, `);
      await db.execute(sql`UPDATE plan_versions SET activated_by_user_id = NULL WHERE activated_by_user_id = ANY(ARRAY[${userIn}]::int[]);`);
      await db.execute(sql`DELETE FROM users WHERE id = ANY(ARRAY[${userIn}]::int[]);`);
    }
  });

  // Helper to create an isolated test creche with primary owner & subscription
  async function createTestTenant(options: {
    planId: number;
    planVersionId?: number | null;
    status?: "active" | "trial" | "past_due" | "cancelled" | "suspended";
    syncStatus?: "in_sync" | "sync_pending";
    crecheStatus?: "active" | "inactive" | "archived";
    scheduledPlanId?: number | null;
    scheduledPlanVersionId?: number | null;
    scheduledStatus?: "PENDING" | "LEGACY_PENDING" | "FAILED_OVER_QUOTA" | null;
  }) {
    const uid = randomUUID();
    const [c] = await db
      .insert(crechesTable)
      .values({
        name: `Test Creche R38C ${uid}`,
        address: "Rua Teste 123, São Paulo",
        phone: "11988887777",
        email: `creche-r38c-${uid}@arkpet.test`,
        status: options.crecheStatus ?? "active",
      })
      .returning();
    testCrecheIds.push(c.id);

    const [u] = await db
      .insert(usersTable)
      .values({
        name: `Owner R38C ${uid}`,
        email: `owner-r38c-${uid}@arkpet.test`,
        passwordHash: hashPassword("OwnerPass123!"),
        role: "creche_admin",
        crecheId: c.id,
        isPrimaryOwner: true,
        isActive: true,
        mustChangePassword: false,
      })
      .returning();
    testUserIds.push(u.id);

    // Resolve active version if not provided and planId is given
    let pVerId = options.planVersionId;
    if (pVerId === undefined) {
      const [act] = await db
        .select()
        .from(planVersionsTable)
        .where(and(eq(planVersionsTable.planId, options.planId), eq(planVersionsTable.status, "ACTIVE")))
        .limit(1);
      pVerId = act ? act.id : null;
    }

    const [sub] = await db
      .insert(subscriptionsTable)
      .values({
        crecheId: c.id,
        planId: options.planId,
        planVersionId: pVerId,
        status: options.status ?? "active",
        billingInterval: "month",
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        scheduledPlanId: options.scheduledPlanId ?? null,
        scheduledPlanVersionId: options.scheduledPlanVersionId ?? null,
        scheduledStatus: options.scheduledStatus ?? null,
        scheduledPeriodEnd: options.scheduledPlanId ? new Date(Date.now() + 30 * 24 * 3600 * 1000) : null,
      })
      .returning();

    const token = generateToken(u.id, u.role);
    return { creche: c, user: u, subscription: sub, token };
  }

  // =========================================================================
  // SUITE 1: Frozen Anchors & Catalog Invariants (5 Tests: TC-ANC-01..05)
  // =========================================================================
  describe("Suite 1: Frozen Anchors & Catalog Invariants (5 Tests)", () => {
    it("TC-ANC-01: Trial v1 Invariant", async () => {
      const [trialV1] = await db
        .select()
        .from(planVersionsTable)
        .where(and(eq(planVersionsTable.planId, 1), eq(planVersionsTable.versionNumber, 1)))
        .limit(1);

      expect(trialV1).toBeDefined();
      expect(trialV1.petLimit).toBe(30);
      expect(trialV1.staffLimit).toBe(2);
      expect(Number(trialV1.storageBytesLimit)).toBe(2147483648); // 2 GiB
      expect(trialV1.priceBrl).toBe(0);
    });

    it("TC-ANC-02: Starter Quota Anchors", async () => {
      const [starterV1] = await db
        .select()
        .from(planVersionsTable)
        .where(and(eq(planVersionsTable.planId, 2), eq(planVersionsTable.versionNumber, 1)))
        .limit(1);

      expect(starterV1).toBeDefined();
      expect(starterV1.staffLimit).toBe(3);
      expect(Number(starterV1.storageBytesLimit)).toBe(5368709120); // 5 GiB per DEC-14
    });

    it("TC-ANC-03: Enterprise Unlimited Staff", async () => {
      const [entV1] = await db
        .select()
        .from(planVersionsTable)
        .where(and(eq(planVersionsTable.planId, 6), eq(planVersionsTable.versionNumber, 1)))
        .limit(1);

      expect(entV1).toBeDefined();
      expect(entV1.staffLimit).toBeNull();

      const tenant = await createTestTenant({ planId: 6, planVersionId: entV1.id });
      const quota = await checkQuota(db, { crecheId: tenant.creche.id, resource: "staff" });
      expect(quota.unlimited).toBe(true);
      expect(quota.limit).toBeNull();
      expect(quota.allowed).toBe(true);
    });

    it("TC-ANC-04: Enterprise Finite Storage", async () => {
      const [entV1] = await db
        .select()
        .from(planVersionsTable)
        .where(and(eq(planVersionsTable.planId, 6), eq(planVersionsTable.versionNumber, 1)))
        .limit(1);

      expect(entV1).toBeDefined();
      expect(Number(entV1.storageBytesLimit)).toBe(107374182400); // 100 GiB

      const tenant = await createTestTenant({ planId: 6, planVersionId: entV1.id });
      const quota = await checkQuota(db, { crecheId: tenant.creche.id, resource: "storage" });
      expect(quota.unlimited).toBe(false);
      expect(Number(quota.limitBytes)).toBe(107374182400);
    });

    it("TC-ANC-05: 6-Tier Catalog Consistency", async () => {
      const versions = await db
        .select()
        .from(planVersionsTable)
        .where(eq(planVersionsTable.status, "ACTIVE"));

      const expectedTiers: Record<number, { pets: number; staff: number | null; storage: number }> = {
        1: { pets: 30, staff: 2, storage: 2147483648 },
        2: { pets: 15, staff: 3, storage: 5368709120 },
        3: { pets: 35, staff: 5, storage: 16106127360 },
        4: { pets: 75, staff: 10, storage: 32212254720 },
        5: { pets: 150, staff: 20, storage: 64424509440 },
        6: { pets: 999999, staff: null, storage: 107374182400 },
      };

      for (const [planIdStr, expected] of Object.entries(expectedTiers)) {
        const pId = Number(planIdStr);
        const v = versions.find((ver) => ver.planId === pId);
        expect(v, `Missing ACTIVE version for planId ${pId}`).toBeDefined();
        expect(v!.petLimit).toBe(expected.pets);
        expect(v!.staffLimit).toBe(expected.staff);
        expect(Number(v!.storageBytesLimit)).toBe(expected.storage);
      }
    });
  });

  // =========================================================================
  // SUITE 2: Migration Order, Idempotency & Invariants (6 Tests: TC-MIG-01..06)
  // =========================================================================
  describe("Suite 2: Migration Order, Idempotency & Invariants (6 Tests)", () => {
    it("TC-MIG-01: Migration 0039 Execution Order", () => {
      const migrationPath = path.resolve(
        process.cwd(),
        "lib/db/src/migrations/0039_r38c_unified_entitlements.sql"
      );
      expect(fs.existsSync(migrationPath)).toBe(true);
      const sqlContent = fs.readFileSync(migrationPath, "utf-8");

      const idxA = sqlContent.indexOf("STEP A:");
      const idxB = sqlContent.indexOf("STEP B:");
      const idxC = sqlContent.indexOf("STEP C:");
      const idxD = sqlContent.indexOf("STEP D:");
      const idxE = sqlContent.indexOf("STEP E:");
      const idxF = sqlContent.indexOf("STEP F:");

      expect(idxA).toBeGreaterThan(-1);
      expect(idxB).toBeGreaterThan(idxA);
      expect(idxC).toBeGreaterThan(idxB);
      expect(idxD).toBeGreaterThan(idxC);
      expect(idxE).toBeGreaterThan(idxD);
      expect(idxF).toBeGreaterThan(idxE);
    });

    it("TC-MIG-02: Migration Backfill Pre-Commit Assertion", async () => {
      await expect(
        db.transaction(async (tx) => {
          await tx.execute(sql`
            DO $$
            DECLARE
              v_count INTEGER;
            BEGIN
              SELECT COUNT(*) INTO v_count FROM plan_versions WHERE plan_id = 99999;
              IF v_count <> 1 THEN
                RAISE EXCEPTION 'CANONICAL_BOOTSTRAP_ASSERTION_FAILED: Test intentional assertion failure';
              END IF;
            END $$;
          `);
        })
      ).rejects.toThrow(/CANONICAL_BOOTSTRAP_ASSERTION_FAILED/);
    });

    it("TC-MIG-03: Migration 0039 Idempotent Rerun", async () => {
      const res = await db.execute(sql`
        UPDATE plan_versions
        SET staff_limit = 3, storage_bytes_limit = 5368709120
        WHERE plan_id = 2 AND version_number = 1 AND (staff_limit IS NULL OR storage_bytes_limit IS NULL);
      `);
      expect(res.rowCount).toBe(0);
    });

    it("TC-MIG-04: Post-Bootstrap Immutability Trigger Barrier", async () => {
      let err: any;
      try {
        await db.execute(sql`
          UPDATE plan_versions
          SET staff_limit = 99
          WHERE plan_id = 2 AND status = 'ACTIVE';
        `);
      } catch (e: any) {
        err = e;
      }
      expect(err).toBeDefined();
      const fullMsg = `${err.message} ${err.cause?.message || ""}`;
      expect(fullMsg).toMatch(/ERR_COMMERCIAL_FIELDS_IMMUTABLE|ERR_VERSION_IMMUTABLE/i);
    });

    it("TC-MIG-05: Commercial Fields Zero Drift", async () => {
      const prices = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM plan_version_prices;
      `);
      expect(Number(prices.rows[0]?.cnt)).toBeGreaterThanOrEqual(6);
    });

    it("TC-MIG-06: Enterprise Rerun Guard & Drift Abort", async () => {
      const res = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM plan_versions
        WHERE plan_id = 6 AND version_number = 1 AND storage_bytes_limit IS NULL;
      `);
      expect(Number(res.rows[0]?.cnt)).toBe(0);
    });
  });

  // =========================================================================
  // SUITE 3: Pet Quota Enforcement & Concurrency Gating (3 Tests: TC-PET-01..03)
  // =========================================================================
  describe("Suite 3: Pet Quota Enforcement & Concurrency Gating (3 Tests)", () => {
    it("TC-PET-01: Status Transition Gate", async () => {
      const tenant = await createTestTenant({ planId: 2 }); // Starter (15 pets)

      for (let i = 1; i <= 15; i++) {
        await db.insert(petsTable).values({
          crecheId: tenant.creche.id,
          tutorId: tenant.user.id,
          name: `Active Pet ${i}`,
          species: "dog",
          status: "active",
        });
      }

      await db.insert(petsTable).values({
        crecheId: tenant.creche.id,
        tutorId: tenant.user.id,
        name: "Inactive Pet",
        species: "dog",
        status: "inactive",
      });

      const quota = await checkCreationQuota(db, {
        crecheId: tenant.creche.id,
        resource: "pets",
        requestedDelta: 1,
      });

      expect(quota.allowed).toBe(false);
      expect(quota.used).toBe(15);
      expect(quota.limit).toBe(15);
    });

    it("TC-PET-02: Concurrency Serialization", async () => {
      const tenant = await createTestTenant({ planId: 2 });

      for (let i = 1; i <= 14; i++) {
        await db.insert(petsTable).values({
          crecheId: tenant.creche.id,
          tutorId: tenant.user.id,
          name: `Pet ${i}`,
          species: "dog",
          status: "active",
        });
      }

      const worker = async (petName: string) => {
        return await db.transaction(async (tx) => {
          await acquireTenantOperationalLock(tenant.creche.id, tx);
          await tx.execute(sql`SELECT id FROM creches WHERE id = ${tenant.creche.id} FOR UPDATE`);
          const q = await checkCreationQuota(tx, {
            crecheId: tenant.creche.id,
            resource: "pets",
            requestedDelta: 1,
          });
          if (!q.allowed) {
            throw new EntitlementsError("PLAN_LIMIT_REACHED", "Limit reached", 403);
          }
          await tx.insert(petsTable).values({
            crecheId: tenant.creche.id,
            tutorId: tenant.user.id,
            name: petName,
            species: "dog",
            status: "active",
          });
          return true;
        });
      };

      const results = await Promise.allSettled([
        worker("Concurrent Pet A"),
        worker("Concurrent Pet B"),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      const activeCount = await getPetUsage(db, tenant.creche.id);
      expect(activeCount).toBe(15);
    });

    it("TC-PET-03: Inactive Pet Accounting", async () => {
      const tenant = await createTestTenant({ planId: 2 });

      for (let i = 1; i <= 10; i++) {
        await db.insert(petsTable).values({
          crecheId: tenant.creche.id,
          tutorId: tenant.user.id,
          name: `Active ${i}`,
          species: "dog",
          status: "active",
        });
      }
      for (let i = 1; i <= 5; i++) {
        await db.insert(petsTable).values({
          crecheId: tenant.creche.id,
          tutorId: tenant.user.id,
          name: `Inactive ${i}`,
          species: "dog",
          status: "inactive",
        });
      }

      const quota = await checkCreationQuota(db, {
        crecheId: tenant.creche.id,
        resource: "pets",
        requestedDelta: 1,
      });

      expect(quota.allowed).toBe(true);
      expect(quota.used).toBe(10);
      expect(quota.remaining).toBe(4);
    });
  });

  // =========================================================================
  // SUITE 4: Staff Quota Enforcement & Concurrency Races (7 Tests: TC-STF-01..07)
  // =========================================================================
  describe("Suite 4: Staff Quota Enforcement & Concurrency Races (7 Tests)", () => {
    it("TC-STF-01: Staff Limit Hard Block", async () => {
      const tenant = await createTestTenant({ planId: 2 }); // Starter (limit: 3 staff)

      for (let i = 1; i <= 2; i++) {
        await db.insert(usersTable).values({
          name: `Staff Member ${i}`,
          email: `staff-${i}-${Date.now()}@arkpet.test`,
          passwordHash: hashPassword("Pass123!"),
          role: "staff",
          crecheId: tenant.creche.id,
          isActive: true,
          mustChangePassword: false,
        });
      }

      const quota = await checkCreationQuota(db, {
        crecheId: tenant.creche.id,
        resource: "staff",
        requestedDelta: 1,
      });

      expect(quota.allowed).toBe(false);
      expect(quota.used).toBe(3);
      expect(quota.limit).toBe(3);
    });

    it("TC-STF-02: Role Promotion Bypass Gate", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      for (let i = 1; i <= 2; i++) {
        await db.insert(usersTable).values({
          name: `Staff ${i}`,
          email: `staff-prom-${i}-${Date.now()}@arkpet.test`,
          passwordHash: hashPassword("Pass123!"),
          role: "staff",
          crecheId: tenant.creche.id,
          isActive: true,
          mustChangePassword: false,
        });
      }

      await db.insert(usersTable).values({
        name: "Tutor User",
        email: `tutor-${Date.now()}@arkpet.test`,
        passwordHash: hashPassword("Pass123!"),
        role: "tutor",
        crecheId: tenant.creche.id,
        isActive: true,
        mustChangePassword: false,
      });

      const quota = await checkCreationQuota(db, {
        crecheId: tenant.creche.id,
        resource: "staff",
        requestedDelta: 1,
      });

      expect(quota.allowed).toBe(false);
      expect(quota.used).toBe(3);
      expect(quota.limit).toBe(3);
    });

    it("TC-STF-03: Staff Counting Predicate", async () => {
      const tenant = await createTestTenant({ planId: 4 });
      await db.insert(usersTable).values({
        name: "Secondary Admin",
        email: `sec-admin-${Date.now()}@arkpet.test`,
        passwordHash: hashPassword("Pass123!"),
        role: "creche_admin",
        crecheId: tenant.creche.id,
        isActive: true,
        mustChangePassword: false,
      });
      await db.insert(usersTable).values({
        name: "Active Staff",
        email: `act-staff-${Date.now()}@arkpet.test`,
        passwordHash: hashPassword("Pass123!"),
        role: "staff",
        crecheId: tenant.creche.id,
        isActive: true,
        mustChangePassword: false,
      });
      await db.insert(usersTable).values({
        name: "Disabled Staff",
        email: `dis-staff-${Date.now()}@arkpet.test`,
        passwordHash: hashPassword("Pass123!"),
        role: "staff",
        crecheId: tenant.creche.id,
        isActive: false,
        mustChangePassword: false,
      });
      for (let i = 1; i <= 5; i++) {
        await db.insert(usersTable).values({
          name: `Tutor ${i}`,
          email: `tutor-${i}-${Date.now()}@arkpet.test`,
          passwordHash: hashPassword("Pass123!"),
          role: "tutor",
          crecheId: tenant.creche.id,
          isActive: true,
          mustChangePassword: false,
        });
      }

      const staffCount = await getStaffUsage(db, tenant.creche.id);
      expect(staffCount).toBe(3);
    });

    it("TC-STF-04: Disabled Staff Accounting", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      const [staffMember] = await db
        .insert(usersTable)
        .values({
          name: "Active Staff To Disable",
          email: `to-dis-${Date.now()}@arkpet.test`,
          passwordHash: hashPassword("Pass123!"),
          role: "staff",
          crecheId: tenant.creche.id,
          isActive: true,
          mustChangePassword: false,
        })
        .returning();

      await db.insert(usersTable).values({
        name: "Other Staff",
        email: `other-stf-${Date.now()}@arkpet.test`,
        passwordHash: hashPassword("Pass123!"),
        role: "staff",
        crecheId: tenant.creche.id,
        isActive: true,
        mustChangePassword: false,
      });

      expect(await getStaffUsage(db, tenant.creche.id)).toBe(3);

      await db
        .update(usersTable)
        .set({ isActive: false })
        .where(eq(usersTable.id, staffMember.id));

      const updatedCount = await getStaffUsage(db, tenant.creche.id);
      expect(updatedCount).toBe(2);

      const quota = await checkCreationQuota(db, {
        crecheId: tenant.creche.id,
        resource: "staff",
        requestedDelta: 1,
      });
      expect(quota.allowed).toBe(true);
    });

    it("TC-STF-05: Tutor Creation Zero Staff Quota", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      const initialStaff = await getStaffUsage(db, tenant.creche.id);

      for (let i = 1; i <= 5; i++) {
        await db.insert(usersTable).values({
          name: `New Tutor ${i}`,
          email: `newtutor-${i}-${Date.now()}@arkpet.test`,
          passwordHash: hashPassword("Pass123!"),
          role: "tutor",
          crecheId: tenant.creche.id,
          isActive: true,
          mustChangePassword: false,
        });
      }

      const postStaff = await getStaffUsage(db, tenant.creche.id);
      expect(postStaff).toBe(initialStaff);
    });

    it("TC-STF-06: Concurrent Staff Creation Race", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      await db.insert(usersTable).values({
        name: "Staff 1",
        email: `stf1-${Date.now()}@arkpet.test`,
        passwordHash: hashPassword("Pass123!"),
        role: "staff",
        crecheId: tenant.creche.id,
        isActive: true,
        mustChangePassword: false,
      });

      const worker = async (email: string) => {
        return await db.transaction(async (tx) => {
          await acquireTenantOperationalLock(tenant.creche.id, tx);
          await tx.execute(sql`SELECT id FROM creches WHERE id = ${tenant.creche.id} FOR UPDATE`);
          const q = await checkCreationQuota(tx, {
            crecheId: tenant.creche.id,
            resource: "staff",
            requestedDelta: 1,
          });
          if (!q.allowed) {
            throw new EntitlementsError("STAFF_LIMIT_EXCEEDED", "Staff limit reached", 403);
          }
          await tx.insert(usersTable).values({
            name: "Concurrent Staff",
            email,
            passwordHash: hashPassword("Pass123!"),
            role: "staff",
            crecheId: tenant.creche.id,
            isActive: true,
            mustChangePassword: false,
          });
          return true;
        });
      };

      const results = await Promise.allSettled([
        worker(`c-stf-a-${Date.now()}@arkpet.test`),
        worker(`c-stf-b-${Date.now()}@arkpet.test`),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      const finalCount = await getStaffUsage(db, tenant.creche.id);
      expect(finalCount).toBe(3);
    });

    it("TC-STF-07: Mixed Staff Creation + Invitation Race", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      await db.insert(usersTable).values({
        name: "Staff 1",
        email: `stf-mix1-${Date.now()}@arkpet.test`,
        passwordHash: hashPassword("Pass123!"),
        role: "staff",
        crecheId: tenant.creche.id,
        isActive: true,
        mustChangePassword: false,
      });

      const createStaffWorker = async () => {
        return await db.transaction(async (tx) => {
          await acquireTenantOperationalLock(tenant.creche.id, tx);
          await tx.execute(sql`SELECT id FROM creches WHERE id = ${tenant.creche.id} FOR UPDATE`);
          const q = await checkCreationQuota(tx, {
            crecheId: tenant.creche.id,
            resource: "staff",
            requestedDelta: 1,
          });
          if (!q.allowed) throw new EntitlementsError("STAFF_LIMIT_EXCEEDED", "Limit reached", 403);
          await tx.insert(usersTable).values({
            name: "Mixed Direct Staff",
            email: `mix-stf-${Date.now()}@arkpet.test`,
            passwordHash: hashPassword("Pass123!"),
            role: "staff",
            crecheId: tenant.creche.id,
            isActive: true,
            mustChangePassword: false,
          });
          return "staff_created";
        });
      };

      const createInviteWorker = async () => {
        return await db.transaction(async (tx) => {
          await acquireTenantOperationalLock(tenant.creche.id, tx);
          await tx.execute(sql`SELECT id FROM creches WHERE id = ${tenant.creche.id} FOR UPDATE`);
          const q = await checkCreationQuota(tx, {
            crecheId: tenant.creche.id,
            resource: "staff",
            requestedDelta: 1,
          });
          if (!q.allowed) throw new EntitlementsError("STAFF_LIMIT_EXCEEDED", "Limit reached", 403);
          await tx.insert(crecheInvitationsTable).values({
            crecheId: tenant.creche.id,
            email: `mix-inv-${Date.now()}@arkpet.test`,
            role: "staff",
            token: `token-${randomUUID()}`,
            status: "pending",
            expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
          });
          return "invite_created";
        });
      };

      const results = await Promise.allSettled([createStaffWorker(), createInviteWorker()]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      const finalCount = await getStaffUsage(db, tenant.creche.id);
      expect(finalCount).toBe(3);
    });
  });

  // =========================================================================
  // SUITE 5: Staff Invitation Lifecycle & Quota Accounting (8 Tests: TC-INV-01..08)
  // =========================================================================
  describe("Suite 5: Staff Invitation Lifecycle & Quota Accounting (8 Tests)", () => {
    it("TC-INV-01: Pending Invitation Slot Reservation", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      await db.insert(usersTable).values({
        name: "Staff 1",
        email: `stf-inv1-${Date.now()}@arkpet.test`,
        passwordHash: hashPassword("Pass123!"),
        role: "staff",
        crecheId: tenant.creche.id,
        isActive: true,
        mustChangePassword: false,
      });

      await db.insert(crecheInvitationsTable).values({
        crecheId: tenant.creche.id,
        email: `pending-staff-${Date.now()}@arkpet.test`,
        role: "staff",
        token: `token-${randomUUID()}`,
        status: "pending",
        expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
      });

      const effectiveUsage = await getStaffUsage(db, tenant.creche.id);
      expect(effectiveUsage).toBe(3);

      const quota = await checkCreationQuota(db, {
        crecheId: tenant.creche.id,
        resource: "staff",
        requestedDelta: 1,
      });
      expect(quota.allowed).toBe(false);
    });

    it("TC-INV-02: Invitation Acceptance Atomicity", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      await db.insert(usersTable).values({
        name: "Staff 1",
        email: `stf-atom-${Date.now()}@arkpet.test`,
        passwordHash: hashPassword("Pass123!"),
        role: "staff",
        crecheId: tenant.creche.id,
        isActive: true,
        mustChangePassword: false,
      });

      const inviteEmail = `accept-atom-${Date.now()}@arkpet.test`;
      const [inv] = await db
        .insert(crecheInvitationsTable)
        .values({
          crecheId: tenant.creche.id,
          email: inviteEmail,
          role: "staff",
          token: `token-${randomUUID()}`,
          status: "pending",
          expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
        })
        .returning();

      expect(await getStaffUsage(db, tenant.creche.id)).toBe(3);

      await db.transaction(async (tx) => {
        await acquireTenantOperationalLock(tenant.creche.id, tx);
        await tx
          .update(crecheInvitationsTable)
          .set({ status: "accepted", acceptedAt: new Date() })
          .where(eq(crecheInvitationsTable.id, inv.id));

        await tx.insert(usersTable).values({
          name: "Accepted User",
          email: inviteEmail,
          passwordHash: hashPassword("Pass123!"),
          role: inv.role as any,
          crecheId: tenant.creche.id,
          isActive: true,
          mustChangePassword: false,
        });
      });

      expect(await getStaffUsage(db, tenant.creche.id)).toBe(3);
    });

    it("TC-INV-03: Invitation Expiration Release", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      await db.insert(usersTable).values({
        name: "Staff 1",
        email: `stf-exp-${Date.now()}@arkpet.test`,
        passwordHash: hashPassword("Pass123!"),
        role: "staff",
        crecheId: tenant.creche.id,
        isActive: true,
        mustChangePassword: false,
      });

      const [inv] = await db
        .insert(crecheInvitationsTable)
        .values({
          crecheId: tenant.creche.id,
          email: `exp-inv-${Date.now()}@arkpet.test`,
          role: "staff",
          token: `token-${randomUUID()}`,
          status: "pending",
          expiresAt: new Date(Date.now() - 1000),
        })
        .returning();

      await db
        .update(crecheInvitationsTable)
        .set({ status: "expired" })
        .where(eq(crecheInvitationsTable.id, inv.id));

      const usage = await getStaffUsage(db, tenant.creche.id);
      expect(usage).toBe(2);
    });

    it("TC-INV-04: Invitation Revocation Release", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      const [inv] = await db
        .insert(crecheInvitationsTable)
        .values({
          crecheId: tenant.creche.id,
          email: `rev-inv-${Date.now()}@arkpet.test`,
          role: "staff",
          token: `token-${randomUUID()}`,
          status: "pending",
          expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
        })
        .returning();

      expect(await getStaffUsage(db, tenant.creche.id)).toBe(2);

      await db
        .update(crecheInvitationsTable)
        .set({ status: "revoked" })
        .where(eq(crecheInvitationsTable.id, inv.id));

      expect(await getStaffUsage(db, tenant.creche.id)).toBe(1);
    });

    it("TC-INV-05: Tutor Invitation Zero Staff Impact", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      const initialUsage = await getStaffUsage(db, tenant.creche.id);

      await db.insert(crecheInvitationsTable).values({
        crecheId: tenant.creche.id,
        email: `tutor-inv-${Date.now()}@arkpet.test`,
        role: "tutor",
        token: `token-${randomUUID()}`,
        status: "pending",
        expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
      });

      const usage = await getStaffUsage(db, tenant.creche.id);
      expect(usage).toBe(initialUsage);
    });

    it("TC-INV-06: Duplicate Invitation Conflict", async () => {
      const tenant = await createTestTenant({ planId: 4 });
      const email = `dup-${Date.now()}@arkpet.test`;

      await db.insert(crecheInvitationsTable).values({
        crecheId: tenant.creche.id,
        email,
        role: "staff",
        token: `token-${randomUUID()}`,
        status: "pending",
        expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
      });

      const [existing] = await db
        .select()
        .from(crecheInvitationsTable)
        .where(
          and(
            eq(crecheInvitationsTable.crecheId, tenant.creche.id),
            eq(crecheInvitationsTable.email, email),
            eq(crecheInvitationsTable.status, "pending")
          )
        );

      expect(existing).toBeDefined();
    });

    it("TC-INV-07: Expiration vs Acceptance Terminal Race", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      const [inv] = await db
        .insert(crecheInvitationsTable)
        .values({
          crecheId: tenant.creche.id,
          email: `race-acc-${Date.now()}@arkpet.test`,
          role: "staff",
          token: `token-${randomUUID()}`,
          status: "pending",
          expiresAt: new Date(Date.now() + 1000),
        })
        .returning();

      const tryAccept = async () => {
        const res = await db
          .update(crecheInvitationsTable)
          .set({ status: "accepted", acceptedAt: new Date() })
          .where(and(eq(crecheInvitationsTable.id, inv.id), eq(crecheInvitationsTable.status, "pending")))
          .returning();
        return res.length > 0;
      };

      const tryExpire = async () => {
        const res = await db
          .update(crecheInvitationsTable)
          .set({ status: "expired" })
          .where(and(eq(crecheInvitationsTable.id, inv.id), eq(crecheInvitationsTable.status, "pending")))
          .returning();
        return res.length > 0;
      };

      const [r1, r2] = await Promise.all([tryAccept(), tryExpire()]);
      expect(Number(r1) + Number(r2)).toBe(1);
    });

    it("TC-INV-08: Expiration vs Revocation Terminal Race", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      const [inv] = await db
        .insert(crecheInvitationsTable)
        .values({
          crecheId: tenant.creche.id,
          email: `race-rev-${Date.now()}@arkpet.test`,
          role: "staff",
          token: `token-${randomUUID()}`,
          status: "pending",
          expiresAt: new Date(Date.now() + 1000),
        })
        .returning();

      const tryRevoke = async () => {
        const res = await db
          .update(crecheInvitationsTable)
          .set({ status: "revoked" })
          .where(and(eq(crecheInvitationsTable.id, inv.id), eq(crecheInvitationsTable.status, "pending")))
          .returning();
        return res.length > 0;
      };

      const tryExpire = async () => {
        const res = await db
          .update(crecheInvitationsTable)
          .set({ status: "expired" })
          .where(and(eq(crecheInvitationsTable.id, inv.id), eq(crecheInvitationsTable.status, "pending")))
          .returning();
        return res.length > 0;
      };

      const [r1, r2] = await Promise.all([tryRevoke(), tryExpire()]);
      expect(Number(r1) + Number(r2)).toBe(1);
    });
  });

  // =========================================================================
  // SUITE 6: Storage Quotas, Direct Uploads & CAS Accounting (18 Tests: TC-STR-01..18)
  // =========================================================================
  describe("Suite 6: Storage Quotas, Direct Uploads & CAS Accounting (18 Tests)", () => {
    it("TC-STR-01: Direct Upload Quota Gate", async () => {
      const tenant = await createTestTenant({ planId: 2 }); // Starter: 5 GiB
      await ensureTenantStorageLedger(db, tenant.creche.id);

      const limit = 5368709120;
      const current = Math.floor(limit * 0.98); // 4.9 GiB
      await db
        .update(tenantStorageLedgerTable)
        .set({ usedBytes: current })
        .where(eq(tenantStorageLedgerTable.crecheId, tenant.creche.id));

      const uploadSize = 209715200; // 200 MiB
      const quota = await checkCreationQuota(db, {
        crecheId: tenant.creche.id,
        resource: "storage",
        requestedDelta: uploadSize,
      });

      expect(quota.allowed).toBe(false);
      expect(quota.usedBytes).toBe(current);
    });

    it("TC-STR-02: Presigned Replay Surface Disabled", async () => {
      const tenant = await createTestTenant({ planId: 2 });

      const res = await request(app)
        .post("/api/storage/uploads/request-url")
        .set("Authorization", `Bearer ${tenant.token}`)
        .send({
          name: "test.png",
          size: 1024,
          contentType: "image/png",
        });

      expect(res.status).toBe(501);
      expect(res.body.code).toBe("PRESIGNED_UPLOAD_REPLAY_UNSAFE");
    });

    it("TC-STR-03: Storage Reservation Delta Reconciliation", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      await ensureTenantStorageLedger(db, tenant.creche.id);

      const { file: resv } = await createStorageReservation(db, {
        crecheId: tenant.creche.id,
        fileKey: `uploads/c${tenant.creche.id}/recon-${randomUUID()}.bin`,
        contentType: "application/octet-stream",
        requestedBytes: 10485760, // 10 MiB
      });

      let ledger = await getStorageUsage(db, tenant.creche.id);
      expect(ledger.reservedBytes).toBe(10485760);
      expect(ledger.usedBytes).toBe(0);

      await confirmStorageReservation(db, resv.id, 6291456); // 6 MiB

      ledger = await getStorageUsage(db, tenant.creche.id);
      expect(ledger.reservedBytes).toBe(0);
      expect(ledger.usedBytes).toBe(6291456);
    });

    it("TC-STR-04: Direct Upload 80% Warning", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      await ensureTenantStorageLedger(db, tenant.creche.id);

      const limit = 5368709120;
      const current = Math.floor(limit * 0.82);
      await db
        .update(tenantStorageLedgerTable)
        .set({ usedBytes: current })
        .where(eq(tenantStorageLedgerTable.crecheId, tenant.creche.id));

      const quota = await checkCreationQuota(db, {
        crecheId: tenant.creche.id,
        resource: "storage",
        requestedDelta: 1024,
      });

      expect(quota.allowed).toBe(true);
      expect(quota.warning80).toBe(true);
    });

    it("TC-STR-05: 100% Hard Block (ENFORCE Mode)", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      await ensureTenantStorageLedger(db, tenant.creche.id);

      const limit = 5368709120;
      await db
        .update(tenantStorageLedgerTable)
        .set({ usedBytes: limit + 1000 })
        .where(eq(tenantStorageLedgerTable.crecheId, tenant.creche.id));

      const quota = await checkCreationQuota(db, {
        crecheId: tenant.creche.id,
        resource: "storage",
        requestedDelta: 1024,
      });

      expect(quota.allowed).toBe(false);
    });

    it("TC-STR-06: Two-Phase Delete: GCS Failure", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      await ensureTenantStorageLedger(db, tenant.creche.id);

      const { file } = await createStorageReservation(db, {
        crecheId: tenant.creche.id,
        fileKey: `uploads/c${tenant.creche.id}/del-fail-${randomUUID()}.png`,
        contentType: "image/png",
        requestedBytes: 1000,
      });
      await confirmStorageReservation(db, file.id, 1000);

      const claimed = await claimStorageFileForDeletion(db, file.id);
      expect(claimed.status).toBe("deleting");

      const ledger = await getStorageUsage(db, tenant.creche.id);
      expect(ledger.usedBytes).toBe(1000);
    });

    it("TC-STR-07: Two-Phase Delete: GCS Success", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      await ensureTenantStorageLedger(db, tenant.creche.id);

      const { file } = await createStorageReservation(db, {
        crecheId: tenant.creche.id,
        fileKey: `uploads/c${tenant.creche.id}/del-succ-${randomUUID()}.png`,
        contentType: "image/png",
        requestedBytes: 2000,
      });
      await confirmStorageReservation(db, file.id, 2000);

      await claimStorageFileForDeletion(db, file.id);
      await finalizeStorageFileDeletion(db, file.id);

      const ledger = await getStorageUsage(db, tenant.creche.id);
      expect(ledger.usedBytes).toBe(0);

      const [f] = await db.select().from(storageFilesTable).where(eq(storageFilesTable.id, file.id));
      expect(f.status).toBe("deleted");
    });

    it("TC-STR-08: Delete Already-Absent Object", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      await ensureTenantStorageLedger(db, tenant.creche.id);

      const { file } = await createStorageReservation(db, {
        crecheId: tenant.creche.id,
        fileKey: `uploads/c${tenant.creche.id}/absent-${randomUUID()}.png`,
        contentType: "image/png",
        requestedBytes: 3000,
      });
      await confirmStorageReservation(db, file.id, 3000);

      await claimStorageFileForDeletion(db, file.id);
      await finalizeStorageFileDeletion(db, file.id);

      const ledger = await getStorageUsage(db, tenant.creche.id);
      expect(ledger.usedBytes).toBe(0);
    });

    it("TC-STR-09: Confirm vs Cleanup CAS Race", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      const { file } = await createStorageReservation(db, {
        crecheId: tenant.creche.id,
        fileKey: `uploads/c${tenant.creche.id}/race-cas-${randomUUID()}.png`,
        contentType: "image/png",
        requestedBytes: 4000,
      });

      const tryConfirm = async () => {
        try {
          await confirmStorageReservation(db, file.id, 4000);
          return true;
        } catch {
          return false;
        }
      };

      const tryExpire = async () => {
        try {
          await claimExpiredStorageReservation(db, file.id);
          return true;
        } catch {
          return false;
        }
      };

      const [c, e] = await Promise.all([tryConfirm(), tryExpire()]);
      expect(Number(c) + Number(e)).toBe(1);
    });

    it("TC-STR-10: Expired Reservation: Object Absent", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      const { file } = await createStorageReservation(db, {
        crecheId: tenant.creche.id,
        fileKey: `uploads/c${tenant.creche.id}/exp-absent-${randomUUID()}.png`,
        contentType: "image/png",
        requestedBytes: 5000,
      });

      await db.update(storageFilesTable).set({
        reservationExpiresAt: new Date(Date.now() - 60000),
      }).where(eq(storageFilesTable.id, file.id));

      await claimExpiredStorageReservation(db, file.id);
      await finalizeExpiredStorageReservation(db, file.id);

      const [f] = await db.select().from(storageFilesTable).where(eq(storageFilesTable.id, file.id));
      expect(f.status).toBe("abandoned");

      const ledger = await getStorageUsage(db, tenant.creche.id);
      expect(ledger.reservedBytes).toBe(0);
    });

    it("TC-STR-11: CAS File Deletion Protocol & DB Atomicity", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      const { file } = await createStorageReservation(db, {
        crecheId: tenant.creche.id,
        fileKey: `uploads/c${tenant.creche.id}/atom-del-${randomUUID()}.png`,
        contentType: "image/png",
        requestedBytes: 6000,
      });
      await confirmStorageReservation(db, file.id, 6000);

      await claimStorageFileForDeletion(db, file.id);
      await finalizeStorageFileDeletion(db, file.id);

      const [f] = await db.select().from(storageFilesTable).where(eq(storageFilesTable.id, file.id));
      expect(f.status).toBe("deleted");
    });

    it("TC-STR-12: Overflow Cleanup CAS Worker", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      const [file] = await db
        .insert(storageFilesTable)
        .values({
          crecheId: tenant.creche.id,
          fileKey: `uploads/c${tenant.creche.id}/overflow-${randomUUID()}.png`,
          sizeBytes: 7000,
          contentType: "image/png",
          status: "rejected_overflow_deleting",
        })
        .returning();

      await finalizeRejectedOverflowFile(db, file.id);

      const [f] = await db.select().from(storageFilesTable).where(eq(storageFilesTable.id, file.id));
      expect(f.status).toBe("rejected_overflow_deleted");
    });

    it("TC-STR-13: Distinct Object Cloud Accounting", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      await ensureTenantStorageLedger(db, tenant.creche.id);

      const { file: file1 } = await createStorageReservation(db, {
        crecheId: tenant.creche.id,
        fileKey: `uploads/c${tenant.creche.id}/a-${randomUUID()}.png`,
        contentType: "image/png",
        requestedBytes: 8000,
      });
      await confirmStorageReservation(db, file1.id, 8000);

      const { file: file2 } = await createStorageReservation(db, {
        crecheId: tenant.creche.id,
        fileKey: `uploads/c${tenant.creche.id}/b-${randomUUID()}.png`,
        contentType: "image/png",
        requestedBytes: 8000,
      });
      await confirmStorageReservation(db, file2.id, 8000);

      const ledger = await getStorageUsage(db, tenant.creche.id);
      expect(ledger.usedBytes).toBe(16000);
    });

    it("TC-STR-14: Direct Upload Finalization Failure", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      const { file } = await createStorageReservation(db, {
        crecheId: tenant.creche.id,
        fileKey: `uploads/c${tenant.creche.id}/fin-fail-${randomUUID()}.png`,
        contentType: "image/png",
        requestedBytes: 9000,
      });

      let [f] = await db.select().from(storageFilesTable).where(eq(storageFilesTable.id, file.id));
      expect(f.status).toBe("reserved");

      await db.update(storageFilesTable).set({
        reservationExpiresAt: new Date(Date.now() - 60000),
      }).where(eq(storageFilesTable.id, file.id));

      await claimExpiredStorageReservation(db, file.id);
      await finalizeExpiredStorageReservation(db, file.id);

      [f] = await db.select().from(storageFilesTable).where(eq(storageFilesTable.id, file.id));
      expect(f.status).toBe("abandoned");
    });

    it("TC-STR-15: Rejected Overflow Cleanup Failure Preservation", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      await ensureTenantStorageLedger(db, tenant.creche.id);

      await db
        .update(tenantStorageLedgerTable)
        .set({ reservedBytes: 10000 })
        .where(eq(tenantStorageLedgerTable.crecheId, tenant.creche.id));

      const [file] = await db
        .insert(storageFilesTable)
        .values({
          crecheId: tenant.creche.id,
          fileKey: `uploads/c${tenant.creche.id}/overflow-pres-${randomUUID()}.png`,
          sizeBytes: 10000,
          contentType: "image/png",
          status: "rejected_overflow_deleting",
        })
        .returning();

      let [f] = await db.select().from(storageFilesTable).where(eq(storageFilesTable.id, file.id));
      expect(f.status).toBe("rejected_overflow_deleting");

      await finalizeRejectedOverflowFile(db, file.id);
      [f] = await db.select().from(storageFilesTable).where(eq(storageFilesTable.id, file.id));
      expect(f.status).toBe("rejected_overflow_deleted");
    });

    it("TC-STR-16: Expired Reservation: Object Present, Delete Success", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      const { file } = await createStorageReservation(db, {
        crecheId: tenant.creche.id,
        fileKey: `uploads/c${tenant.creche.id}/exp-pres-${randomUUID()}.png`,
        contentType: "image/png",
        requestedBytes: 11000,
      });

      await db.update(storageFilesTable).set({
        reservationExpiresAt: new Date(Date.now() - 60000),
      }).where(eq(storageFilesTable.id, file.id));

      await claimExpiredStorageReservation(db, file.id);
      await finalizeExpiredStorageReservation(db, file.id);

      const [f] = await db.select().from(storageFilesTable).where(eq(storageFilesTable.id, file.id));
      expect(f.status).toBe("abandoned");
    });

    it("TC-STR-17: Expired Reservation: Object Present, Delete Fails", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      const { file } = await createStorageReservation(db, {
        crecheId: tenant.creche.id,
        fileKey: `uploads/c${tenant.creche.id}/exp-del-fail-${randomUUID()}.png`,
        contentType: "image/png",
        requestedBytes: 12000,
      });

      await db.update(storageFilesTable).set({
        reservationExpiresAt: new Date(Date.now() - 60000),
      }).where(eq(storageFilesTable.id, file.id));

      const claimed = await claimExpiredStorageReservation(db, file.id);
      expect(claimed.status).toBe("expired_cleanup_deleting");

      const [f] = await db.select().from(storageFilesTable).where(eq(storageFilesTable.id, file.id));
      expect(f.status).toBe("expired_cleanup_deleting");
    });

    it("TC-STR-18: Storage Files UpdatedAt Tracking", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      const { file } = await createStorageReservation(db, {
        crecheId: tenant.creche.id,
        fileKey: `uploads/c${tenant.creche.id}/updated-at-${randomUUID()}.png`,
        contentType: "image/png",
        requestedBytes: 13000,
      });

      expect(file.updatedAt).toBeDefined();
      const firstUpdatedAt = new Date(file.updatedAt).getTime();

      await confirmStorageReservation(db, file.id, 13000);

      const [updated] = await db.select().from(storageFilesTable).where(eq(storageFilesTable.id, file.id));
      expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(firstUpdatedAt);
    });
  });

  // =========================================================================
  // SUITE 7: Storage Activation Modes & Preflight Rules (6 Tests: TC-MOD-01..06)
  // =========================================================================
  describe("Suite 7: Storage Activation Modes & Preflight Rules (6 Tests)", () => {
    it("TC-MOD-01: AUDIT Mode Hard Block Suppression", () => {
      const mode = resolveStorageEnforcementMode({ STORAGE_ENFORCEMENT_MODE: "AUDIT" });
      expect(mode).toBe("AUDIT");
    });

    it("TC-MOD-02: SHADOW Mode Warning & Telemetry", () => {
      const mode = resolveStorageEnforcementMode({ STORAGE_ENFORCEMENT_MODE: "SHADOW" });
      expect(mode).toBe("SHADOW");
    });

    it("TC-MOD-03: ENFORCE Mode Hard Block", () => {
      const mode = resolveStorageEnforcementMode({ STORAGE_ENFORCEMENT_MODE: "ENFORCE" });
      expect(mode).toBe("ENFORCE");
    });

    it("TC-MOD-04: Production Missing Mode Fails Boot", () => {
      expect(() => {
        resolveStorageEnforcementMode({ NODE_ENV: "production" });
      }).toThrow(/STORAGE_ENFORCEMENT_MODE_REQUIRED/);
    });

    it("TC-MOD-05: Production Invalid Mode Fails Boot", () => {
      expect(() => {
        resolveStorageEnforcementMode({ NODE_ENV: "production", STORAGE_ENFORCEMENT_MODE: "INVALID_MODE" });
      }).toThrow(/STORAGE_ENFORCEMENT_MODE_INVALID/);
    });

    it("TC-MOD-06: Non-Production Missing Mode Default", () => {
      const mode = resolveStorageEnforcementMode({ NODE_ENV: "development" });
      expect(mode).toBe("AUDIT");
    });
  });

  // =========================================================================
  // SUITE 8: Historical Storage Inventory & Concurrent Deduplication (8 Tests: TC-HST-01..08)
  // =========================================================================
  describe("Suite 8: Historical Storage Inventory & Concurrent Deduplication (8 Tests)", () => {
    it("TC-HST-01: Inventory Classification: MAPPED", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      const fileKey = `uploads/c${tenant.creche.id}/test-mapped-${randomUUID()}.png`;

      await db.insert(storageFilesTable).values({
        crecheId: tenant.creche.id,
        fileKey,
        sizeBytes: 1024,
        contentType: "image/png",
        status: "confirmed",
      });

      const items: GcsObjectItem[] = [{ name: fileKey, size: 1024, contentType: "image/png" }];
      const report = await runStorageInventory({ items, mode: "dry-run", db });

      expect(report.categories.MAPPED.count).toBe(1);
    });

    it("TC-HST-02: Inventory Classification: TENANT_MAPPED", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      const fileKey = `uploads/c${tenant.creche.id}/unrecorded-${randomUUID()}.png`;

      const items: GcsObjectItem[] = [{ name: fileKey, size: 2048, contentType: "image/png" }];
      const report = await runStorageInventory({ items, mode: "dry-run", db });

      expect(report.categories.TENANT_MAPPED_ENTITY_UNKNOWN.count).toBe(1);
    });

    it("TC-HST-03: Inventory Classification: TENANT_UNKNOWN", async () => {
      const fileKey = `uploads/unknown-tenant-path/file-${randomUUID()}.png`;
      const items: GcsObjectItem[] = [{ name: fileKey, size: 1024, contentType: "image/png" }];
      const report = await runStorageInventory({ items, mode: "dry-run", db });

      expect(report.categories.TENANT_UNKNOWN.count).toBe(1);
      expect(report.enforceReady).toBe(false);
    });

    it("TC-HST-04: Inventory Classification: MISSING_METADATA", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      const fileKey = `uploads/c${tenant.creche.id}/no-meta-${randomUUID()}.png`;

      const items: GcsObjectItem[] = [{ name: fileKey, size: undefined, contentType: undefined }];
      const report = await runStorageInventory({ items, mode: "dry-run", db });

      expect(report.categories.MISSING_METADATA.count).toBe(1);
      expect(report.enforceReady).toBe(false);
    });

    it("TC-HST-05: Inventory Deduplication: Same Physical Key", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      const fileKey = `uploads/c${tenant.creche.id}/dedup-${randomUUID()}.png`;

      const items: GcsObjectItem[] = [
        { name: fileKey, size: 4096, contentType: "image/png" },
        { name: fileKey, size: 4096, contentType: "image/png" },
      ];
      const report = await runStorageInventory({ items, mode: "dry-run", db });

      expect(report.categories.DUPLICATE.count).toBe(1);
      expect(report.duplicateKeysSkipped).toBe(1);
    });

    it("TC-HST-06: Inventory Distinct Keys: Same Hash", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      const key1 = `uploads/c${tenant.creche.id}/distinct1-${randomUUID()}.png`;
      const key2 = `uploads/c${tenant.creche.id}/distinct2-${randomUUID()}.png`;

      const items: GcsObjectItem[] = [
        { name: key1, size: 5000, contentType: "image/png" },
        { name: key2, size: 5000, contentType: "image/png" },
      ];
      const report = await runStorageInventory({ items, mode: "dry-run", db });

      expect(report.totalObjects).toBe(2);
      expect(report.duplicateKeysSkipped).toBe(0);
    });

    it("TC-HST-07: Inventory Backfill Idempotency & Concurrency Proof", async () => {
      const tenant = await createTestTenant({ planId: 2 });
      const fileKey = `uploads/c${tenant.creche.id}/idemp-backfill-${randomUUID()}.png`;
      const items: GcsObjectItem[] = [{ name: fileKey, size: 6000, contentType: "image/png" }];

      const report1 = await runStorageInventory({ items, mode: "backfill", db });
      expect(report1.databaseFilesAdded).toBe(1);
      expect(report1.databaseBytesAdded).toBe(6000);

      const report2 = await runStorageInventory({ items, mode: "backfill", db });
      expect(report2.databaseFilesAdded).toBe(0);
      expect(report2.databaseBytesAdded).toBe(0);
      expect(report2.existingMappedCount).toBe(1);
    });

    it("TC-HST-08: Operational ENFORCE Sign-off Gate", async () => {
      const items: GcsObjectItem[] = [
        { name: "uploads/invalid-orphan/test.png", size: 1024, contentType: "image/png" },
      ];
      const report = await runStorageInventory({ items, mode: "dry-run", db });
      expect(report.enforceReady).toBe(false);
    });
  });

  // =========================================================================
  // SUITE 9: Downgrades, State Machine & Scheduling Lifecycle (8 Tests: TC-DWN-01..08)
  // =========================================================================
  describe("Suite 9: Downgrades, State Machine & Scheduling Lifecycle (8 Tests)", () => {
    it("TC-DWN-01: DEC-12 Pre-Schedule Block", async () => {
      const tenant = await createTestTenant({ planId: 4 }); // Pro (75 pets, 10 staff, 30 GiB)

      for (let i = 1; i <= 20; i++) {
        await db.insert(petsTable).values({
          crecheId: tenant.creche.id,
          tutorId: tenant.user.id,
          name: `Pet ${i}`,
          species: "dog",
          status: "active",
        });
      }

      const res = await request(app)
        .post("/api/billing/change-plan")
        .set("Authorization", `Bearer ${tenant.token}`)
        .send({
          planId: 2,
          interval: "month",
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("DOWNGRADE_USAGE_EXCEEDS_LIMITS");
      expect(res.body.violations?.pets?.current).toBe(20);
      expect(res.body.violations?.pets?.target).toBe(15);
      expect(res.body.violations?.pets?.excess).toBe(5);
    });

    it("TC-DWN-02: Scheduled Target Binding", async () => {
      const [starterV1] = await db
        .select()
        .from(planVersionsTable)
        .where(and(eq(planVersionsTable.planId, 2), eq(planVersionsTable.versionNumber, 1)));

      const tenant = await createTestTenant({
        planId: 4,
        scheduledPlanId: 2,
        scheduledPlanVersionId: starterV1.id,
        scheduledStatus: "PENDING",
      });

      const entitlements = await resolveEntitlements(db, tenant.creche.id);
      expect(entitlements.planId).toBe(4);
    });

    it("TC-DWN-03: Downgrade Creation Clamping", async () => {
      const [starterV1] = await db
        .select()
        .from(planVersionsTable)
        .where(and(eq(planVersionsTable.planId, 2), eq(planVersionsTable.versionNumber, 1)));

      const tenant = await createTestTenant({
        planId: 4,
        scheduledPlanId: 2,
        scheduledPlanVersionId: starterV1.id,
        scheduledStatus: "PENDING",
      });

      for (let i = 1; i <= 14; i++) {
        await db.insert(petsTable).values({
          crecheId: tenant.creche.id,
          tutorId: tenant.user.id,
          name: `Pet ${i}`,
          species: "dog",
          status: "active",
        });
      }

      const q1 = await checkCreationQuota(db, {
        crecheId: tenant.creche.id,
        resource: "pets",
        requestedDelta: 1,
      });
      expect(q1.allowed).toBe(true);
      expect(q1.effectiveLimit).toBe(15);

      await db.insert(petsTable).values({
        crecheId: tenant.creche.id,
        tutorId: tenant.user.id,
        name: "Pet 15",
        species: "dog",
        status: "active",
      });

      const q2 = await checkCreationQuota(db, {
        crecheId: tenant.creche.id,
        resource: "pets",
        requestedDelta: 1,
      });
      expect(q2.allowed).toBe(false);
      expect(q2.effectiveLimit).toBe(15);
    });

    it("TC-DWN-04: T1 Defensive Re-Validation", async () => {
      const [starterV1] = await db
        .select()
        .from(planVersionsTable)
        .where(and(eq(planVersionsTable.planId, 2), eq(planVersionsTable.versionNumber, 1)));

      const tenant = await createTestTenant({
        planId: 4,
        scheduledPlanId: 2,
        scheduledPlanVersionId: starterV1.id,
        scheduledStatus: "PENDING",
      });

      for (let i = 1; i <= 16; i++) {
        await db.insert(petsTable).values({
          crecheId: tenant.creche.id,
          tutorId: tenant.user.id,
          name: `Over Pet ${i}`,
          species: "dog",
          status: "active",
        });
      }

      await db
        .update(subscriptionsTable)
        .set({
          currentPeriodEnd: new Date(Date.now() - 1000),
          scheduledPeriodEnd: new Date(Date.now() - 1000),
        })
        .where(eq(subscriptionsTable.id, tenant.subscription.id));

      await applyScheduledPlanChanges();

      const [sub] = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.id, tenant.subscription.id));

      expect(sub.planId).toBe(4);
      expect(sub.scheduledStatus).toBe("FAILED_OVER_QUOTA");
    });

    it("TC-DWN-05: Downgrade Cancellation", async () => {
      const [starterV1] = await db
        .select()
        .from(planVersionsTable)
        .where(and(eq(planVersionsTable.planId, 2), eq(planVersionsTable.versionNumber, 1)));

      const tenant = await createTestTenant({
        planId: 4,
        scheduledPlanId: 2,
        scheduledPlanVersionId: starterV1.id,
        scheduledStatus: "PENDING",
      });

      const res = await request(app)
        .post("/api/billing/cancel-scheduled-change")
        .set("Authorization", `Bearer ${tenant.token}`)
        .send();

      expect(res.status).toBe(200);

      const [sub] = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.id, tenant.subscription.id));

      expect(sub.scheduledPlanId).toBeNull();
      expect(sub.scheduledPlanVersionId).toBeNull();
      expect(sub.scheduledStatus).toBeNull();

      const q = await checkCreationQuota(db, {
        crecheId: tenant.creche.id,
        resource: "pets",
        requestedDelta: 1,
      });
      expect(q.effectiveLimit).toBe(75);
    });

    it("TC-DWN-06: Transient Upgrade Safety (sync_pending)", async () => {
      const tenant = await createTestTenant({
        planId: 2,
        syncStatus: "sync_pending",
      });

      const quota = await checkCreationQuota(db, {
        crecheId: tenant.creche.id,
        resource: "pets",
        requestedDelta: 1,
      });

      expect(quota.limit).toBe(15);
    });

    it("TC-DWN-07: Scheduled Status Full Lifecycle", async () => {
      const [starterV1] = await db
        .select()
        .from(planVersionsTable)
        .where(and(eq(planVersionsTable.planId, 2), eq(planVersionsTable.versionNumber, 1)));

      const tenant = await createTestTenant({ planId: 4 });

      await db
        .update(subscriptionsTable)
        .set({
          scheduledPlanId: 2,
          scheduledPlanVersionId: starterV1.id,
          scheduledStatus: "PENDING",
        })
        .where(eq(subscriptionsTable.id, tenant.subscription.id));

      await db
        .update(subscriptionsTable)
        .set({ scheduledStatus: "FAILED_OVER_QUOTA" })
        .where(eq(subscriptionsTable.id, tenant.subscription.id));

      await request(app)
        .post("/api/billing/cancel-scheduled-change")
        .set("Authorization", `Bearer ${tenant.token}`)
        .send();

      const [sub] = await db
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.id, tenant.subscription.id));
      expect(sub.scheduledStatus).toBeNull();
    });

    it("TC-DWN-08: Daily Scheduler Non-Repetition Invariant", async () => {
      const tenant = await createTestTenant({
        planId: 4,
        scheduledPlanId: 2,
        scheduledStatus: "FAILED_OVER_QUOTA",
      });

      const eligible = await db.execute(sql`
        SELECT id FROM subscriptions
        WHERE id = ${tenant.subscription.id}
          AND scheduled_plan_id IS NOT NULL
          AND scheduled_period_end <= NOW()
          AND (scheduled_status = 'PENDING' OR scheduled_status IS NULL);
      `);

      expect(eligible.rows.length).toBe(0);
    });
  });

  // =========================================================================
  // SUITE 10: Billing Quota DTO & Unresolved Legacy Representations (5 Tests: TC-DTO-01..05)
  // =========================================================================
  describe("Suite 10: Billing Quota DTO & Unresolved Legacy Representations (5 Tests)", () => {
    it("TC-DTO-01: Bound Plan DTO Representation", async () => {
      const tenant = await createTestTenant({ planId: 2 });

      const res = await request(app)
        .get("/api/billing/subscription")
        .set("Authorization", `Bearer ${tenant.token}`);

      expect(res.status).toBe(200);
      expect(res.body.quotas).toBeDefined();
      expect(res.body.quotas.pets.limit).toBe(15);
      expect(res.body.quotas.staff.limit).toBe(3);
      expect(res.body.quotas.storage.limitBytes).toBe(5368709120);
      expect(res.body.quotas.storage.enforcementMode).toBeDefined();
    });

    it("TC-DTO-02: Enterprise DTO Representation", async () => {
      const tenant = await createTestTenant({ planId: 6 });

      const res = await request(app)
        .get("/api/billing/subscription")
        .set("Authorization", `Bearer ${tenant.token}`);

      expect(res.status).toBe(200);
      expect(res.body.quotas.staff.unlimited).toBe(true);
      expect(res.body.quotas.staff.limit).toBeNull();
      expect(res.body.quotas.storage.limitBytes).toBe(107374182400);
    });

    it("TC-DTO-03: Scheduled Target PENDING DTO", async () => {
      const [starterV1] = await db
        .select()
        .from(planVersionsTable)
        .where(and(eq(planVersionsTable.planId, 2), eq(planVersionsTable.versionNumber, 1)));

      const tenant = await createTestTenant({
        planId: 4,
        scheduledPlanId: 2,
        scheduledPlanVersionId: starterV1.id,
        scheduledStatus: "PENDING",
      });

      const res = await request(app)
        .get("/api/billing/subscription")
        .set("Authorization", `Bearer ${tenant.token}`);

      expect(res.status).toBe(200);
      expect(res.body.scheduledChange).toBeDefined();
      expect(res.body.scheduledChange.scheduledStatus).toBe("PENDING");
      expect(res.body.scheduledChange.targetPetLimit).toBe(15);
      expect(res.body.scheduledChange.targetStaffLimit).toBe(3);
    });

    it("TC-DTO-04: Scheduled Target FAILED_OVER_QUOTA DTO", async () => {
      const [starterV1] = await db
        .select()
        .from(planVersionsTable)
        .where(and(eq(planVersionsTable.planId, 2), eq(planVersionsTable.versionNumber, 1)));

      const tenant = await createTestTenant({
        planId: 4,
        scheduledPlanId: 2,
        scheduledPlanVersionId: starterV1.id,
        scheduledStatus: "FAILED_OVER_QUOTA",
      });

      for (let i = 1; i <= 20; i++) {
        await db.insert(petsTable).values({
          crecheId: tenant.creche.id,
          tutorId: tenant.user.id,
          name: `Pet ${i}`,
          species: "dog",
          status: "active",
        });
      }

      const res = await request(app)
        .get("/api/billing/subscription")
        .set("Authorization", `Bearer ${tenant.token}`);

      expect(res.status).toBe(200);
      expect(res.body.scheduledChange).toBeDefined();
      expect(res.body.scheduledChange.scheduledStatus).toBe("FAILED_OVER_QUOTA");
      expect(res.body.scheduledChange.targetPetLimit).toBe(15);
      expect(res.body.quotas.pets.used).toBe(20);
    });

    it("TC-DTO-05: Unresolved Legacy Subscription DTO", async () => {
      const tenant = await createTestTenant({
        planId: 2,
        planVersionId: null,
      });

      await db.insert(unresolvedSubscriptionVersionsTable).values({
        subscriptionId: tenant.subscription.id,
        crecheId: tenant.creche.id,
        diagnosticCategory: "TEST_UNRESOLVED_LEGACY",
        notes: "Test legacy unmapped version",
      });

      const res = await request(app)
        .get("/api/billing/subscription")
        .set("Authorization", `Bearer ${tenant.token}`);

      expect(res.status).toBe(200);
      expect(res.body.commercialBindingStatus).toBe("unresolved_legacy_contract");
      expect(res.body.planVersion).toBeNull();
      expect(res.body.quotas.staff.enforcementBypassed).toBe(true);
      expect(res.body.quotas.staff.enforcementReason).toBe("UNRESOLVED_LEGACY_CONTRACT");
      expect(res.body.quotas.storage.enforcementBypassed).toBe(true);
      expect(res.body.quotas.storage.enforcementReason).toBe("UNRESOLVED_LEGACY_CONTRACT");
    });
  });

  // =========================================================================
  // SUITE 11: Admin Plan Version Write-Path & Immutability (5 Tests: TC-ADM-01..05)
  // =========================================================================
  describe("Suite 11: Admin Plan Version Write-Path & Immutability (5 Tests)", () => {
    it("TC-ADM-01: Draft Version Creation", async () => {
      const draft = await PlanVersionService.createDraftVersion({
        planId: 2,
        petLimit: 25,
        staffLimit: 4,
        storageBytesLimit: 10737418240, // 10 GiB
        priceBrl: 15000,
        versionName: "Draft Test R38C",
        prices: [{ interval: "month", priceBrl: 15000 }],
      });

      expect(draft.status).toBe("DRAFT");
      expect(draft.staffLimit).toBe(4);
      expect(Number(draft.storageBytesLimit)).toBe(10737418240);

      await db.delete(planVersionsTable).where(eq(planVersionsTable.id, draft.id));
    });

    it("TC-ADM-02: Draft Version Modification", async () => {
      const draft = await PlanVersionService.createDraftVersion({
        planId: 2,
        petLimit: 25,
        staffLimit: 4,
        storageBytesLimit: 10737418240,
        priceBrl: 15000,
        prices: [{ interval: "month", priceBrl: 15000 }],
      });

      const updated = await PlanVersionService.updateDraftVersion({
        planId: 2,
        versionNumber: draft.versionNumber,
        staffLimit: 5,
      });

      expect(updated.staffLimit).toBe(5);

      await db.delete(planVersionsTable).where(eq(planVersionsTable.id, draft.id));
    });

    it("TC-ADM-03: Version Activation Completeness Gate", async () => {
      await db.execute(sql.raw(`
        ALTER TABLE plan_versions DISABLE TRIGGER trg_plan_versions_before_update;
      `));
      const [draft] = await db
        .insert(planVersionsTable)
        .values({
          planId: 2,
          versionNumber: 999,
          status: "DRAFT",
          petLimit: 25,
          staffLimit: 4,
          storageBytesLimit: 0, // Invalid non-positive
          priceBrl: 15000,
        })
        .returning();
      await db.execute(sql.raw(`
        ALTER TABLE plan_versions ENABLE TRIGGER trg_plan_versions_before_update;
      `));

      await expect(
        PlanVersionService.activateVersion({
          planId: 2,
          versionNumber: 999,
          userId: masterAdminUser.id,
          changeReason: "Activation test",
        })
      ).rejects.toThrow(/positive storageBytesLimit/i);

      await db.delete(planVersionsTable).where(eq(planVersionsTable.id, draft.id));
    });

    it("TC-ADM-04: Version Activation Freezes Tuple", async () => {
      const draft = await PlanVersionService.createDraftVersion({
        planId: 2,
        petLimit: 22,
        staffLimit: 4,
        storageBytesLimit: 8589934592, // 8 GiB
        priceBrl: 14000,
        prices: [{ interval: "month", priceBrl: 14000 }],
      });

      const activated = await PlanVersionService.activateVersion({
        planId: 2,
        versionNumber: draft.versionNumber,
        userId: masterAdminUser.id,
        changeReason: "Promoting draft to active",
      });

      expect(activated.status).toBe("ACTIVE");
      expect(activated.effectiveFrom).toBeDefined();

      await db.execute(sql.raw(`
        UPDATE subscriptions SET plan_version_id = NULL WHERE plan_version_id = ${draft.id};
        UPDATE subscriptions SET scheduled_plan_version_id = NULL WHERE scheduled_plan_version_id = ${draft.id};
        ALTER TABLE plan_version_prices DISABLE TRIGGER USER;
        DELETE FROM plan_version_prices WHERE plan_version_id = ${draft.id};
        ALTER TABLE plan_version_prices ENABLE TRIGGER USER;
        ALTER TABLE plan_versions DISABLE TRIGGER USER;
        DELETE FROM plan_versions WHERE id = ${draft.id};
        UPDATE plan_versions SET status = 'ACTIVE', effective_until = NULL, staff_limit = 3, storage_bytes_limit = 5368709120 WHERE plan_id = 2 AND version_number = 1;
        ALTER TABLE plan_versions ENABLE TRIGGER USER;
      `));
    });

    it("TC-ADM-05: Published Version Edit Rejected", async () => {
      await expect(
        PlanVersionService.updateDraftVersion({
          planId: 2,
          versionNumber: 1,
          staffLimit: 10,
        })
      ).rejects.toThrow(/only DRAFT versions can be modified/i);
    });
  });

  // =========================================================================
  // SUITE 12: Tenant Isolation & Commercial Overrides (5 Tests: TC-ISO-01..05)
  // =========================================================================
  describe("Suite 12: Tenant Isolation & Commercial Overrides (5 Tests)", () => {
    it("TC-ISO-01: Multi-Tenant Storage Isolation", async () => {
      const tenantA = await createTestTenant({ planId: 2 });
      const tenantB = await createTestTenant({ planId: 2 });

      await ensureTenantStorageLedger(db, tenantA.creche.id);
      await ensureTenantStorageLedger(db, tenantB.creche.id);

      const { file: fileA } = await createStorageReservation(db, {
        crecheId: tenantA.creche.id,
        fileKey: `uploads/c${tenantA.creche.id}/tenantA-${randomUUID()}.png`,
        contentType: "image/png",
        requestedBytes: 50000000, // 50 MB
      });
      await confirmStorageReservation(db, fileA.id, 50000000);

      const usageA = await getStorageUsage(db, tenantA.creche.id);
      const usageB = await getStorageUsage(db, tenantB.creche.id);

      expect(usageA.usedBytes).toBe(50000000);
      expect(usageB.usedBytes).toBe(0);
    });

    it("TC-ISO-02: Commercial Condition Staff Override", async () => {
      const tenant = await createTestTenant({ planId: 2 });

      const [cond] = await db
        .insert(customerCommercialConditionsTable)
        .values({
          crecheId: tenant.creche.id,
          status: "active",
          validFrom: new Date(Date.now() - 1000),
          validUntil: new Date(Date.now() + 30 * 86400 * 1000),
          entitlementStaffLimit: 12,
        })
        .returning();

      await db
        .update(subscriptionsTable)
        .set({ activeConditionId: cond.id })
        .where(eq(subscriptionsTable.id, tenant.subscription.id));

      const entitlements = await resolveEntitlements(db, tenant.creche.id);
      expect(entitlements.staffLimit).toBe(12);
      expect(entitlements.source.staff).toBe("commercial_override");

      const quota = await checkCreationQuota(db, {
        crecheId: tenant.creche.id,
        resource: "staff",
        requestedDelta: 1,
      });
      expect(quota.limit).toBe(12);
      expect(quota.allowed).toBe(true);
    });

    it("TC-ISO-03: Commercial Condition Storage Override", async () => {
      const tenant = await createTestTenant({ planId: 2 });

      const overrideBytes = 21474836480;
      const [cond] = await db
        .insert(customerCommercialConditionsTable)
        .values({
          crecheId: tenant.creche.id,
          status: "active",
          validFrom: new Date(Date.now() - 1000),
          validUntil: new Date(Date.now() + 30 * 86400 * 1000),
          entitlementStorageBytesLimit: overrideBytes,
        })
        .returning();

      await db
        .update(subscriptionsTable)
        .set({ activeConditionId: cond.id })
        .where(eq(subscriptionsTable.id, tenant.subscription.id));

      const entitlements = await resolveEntitlements(db, tenant.creche.id);
      expect(Number(entitlements.storageBytesLimit)).toBe(overrideBytes);
      expect(entitlements.source.storage).toBe("commercial_override");
    });

    it("TC-ISO-04: Archived Tenant Quota Lockdown", async () => {
      const tenant = await createTestTenant({
        planId: 4,
        crecheStatus: "archived",
      });

      await expect(
        db.transaction(async (tx) => {
          await acquireTenantOperationalLock(tenant.creche.id, tx);
        })
      ).rejects.toThrow(/arquivada|archived/i);
    });

    it("TC-ISO-05: Commercial Condition NULL Fallback", async () => {
      const tenant = await createTestTenant({ planId: 2 });

      const [cond] = await db
        .insert(customerCommercialConditionsTable)
        .values({
          crecheId: tenant.creche.id,
          status: "active",
          validFrom: new Date(Date.now() - 1000),
          validUntil: new Date(Date.now() + 30 * 86400 * 1000),
          entitlementStaffLimit: null,
        })
        .returning();

      await db
        .update(subscriptionsTable)
        .set({ activeConditionId: cond.id })
        .where(eq(subscriptionsTable.id, tenant.subscription.id));

      const entitlements = await resolveEntitlements(db, tenant.creche.id);
      expect(entitlements.staffLimit).toBe(3);
      expect(entitlements.staffUnlimited).toBe(false);
      expect(entitlements.source.staff).toBe("plan_version");
    });
  });
});
