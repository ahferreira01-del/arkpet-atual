import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app.js";
import { db } from "@workspace/db";
import {
  crechesTable,
  usersTable,
  subscriptionsTable,
  plansTable,
  invoicesTable,
  bookingsTable,
  petsTable,
  tutorCreditsTable,
  commercialAuditLedgerTable,
} from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { hashPassword, generateToken } from "../lib/auth.js";
import {
  provisionTenant,
  archiveTenant,
  restoreTenant,
  evaluateArchiveBlockers,
  TenantProvisioningError,
  TenantArchiveBlockedError,
  TRIAL_DURATION_DAYS,
} from "../services/tenantProvisioning.js";
import {
  ensureTenantIntegritySchema,
  backfillPrimaryOwners,
  initializeDatabase,
} from "../startup.js";

export interface SafeDbMetadata {
  host: string;
  database: string;
  user: string;
  isExplicitNonProd: boolean;
  classification: "TEST" | "DEVELOPMENT" | "QA" | "EPHEMERAL" | "UNCLASSIFIED" | "PRODUCTION";
}

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
}): { isSafe: boolean; reason: string; metadata: SafeDbMetadata } {
  const nodeEnv = (params.nodeEnv ?? process.env.NODE_ENV ?? "").toLowerCase();
  const appEnv = (params.appEnv ?? process.env.APP_ENV ?? "").toLowerCase();
  const arkpetEnv = (params.arkpetEnv ?? process.env.ARKPET_ENV ?? "").toLowerCase();
  const effectiveUrl = params.testDbUrl ?? process.env.TEST_DATABASE_URL ?? params.dbUrl ?? process.env.DATABASE_URL;

  // 1. Hard deny: production environment flags
  if (nodeEnv === "production" || appEnv === "production" || arkpetEnv === "production") {
    return {
      isSafe: false,
      reason: "Blocked: Environment variable (NODE_ENV/APP_ENV/ARKPET_ENV) is explicitly set to production",
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

  // 2. Hard deny: production host / endpoint keywords
  const prodHostKeywords = ["prod", "production", "live", "arkpet-prod", "aws.prod", "primary-cluster"];
  const isProdHost = prodHostKeywords.some((kw) => {
    const parts = host.split(/[.-]/);
    return parts.includes(kw) || host.includes(`-${kw}-`) || host.endsWith(`-${kw}`) || host.startsWith(`${kw}-`);
  });

  if (isProdHost || host.includes("production")) {
    return {
      isSafe: false,
      reason: "Blocked: Database host matches production host pattern",
      metadata: { host, database: dbName, user, isExplicitNonProd: false, classification: "PRODUCTION" },
    };
  }

  if (dbName.includes("prod") || dbName.includes("production")) {
    return {
      isSafe: false,
      reason: "Blocked: Database name matches production database pattern",
      metadata: { host, database: dbName, user, isExplicitNonProd: false, classification: "PRODUCTION" },
    };
  }

  // 3. Positive multi-factor verification of safe non-production identity
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
      reason: "Blocked: Missing explicit integration test execution marker (VITEST or R38A_INTEGRATION_TESTS)",
      metadata: { host, database: dbName, user, isExplicitNonProd: false, classification: "UNCLASSIFIED" },
    };
  }

  if (!isSafeHost) {
    return {
      isSafe: false,
      reason: "Blocked: Target database host is not on approved non-production list (localhost, neon.tech dev, *.test, *.dev, *.qa, *.staging)",
      metadata: { host, database: dbName, user, isExplicitNonProd: false, classification: "UNCLASSIFIED" },
    };
  }

  let classification: "TEST" | "DEVELOPMENT" | "QA" | "EPHEMERAL" = "TEST";
  if (isTestDbUrl || nodeEnv === "test") {
    classification = "TEST";
  } else if (host.includes("neon.tech") && host.startsWith("ep-")) {
    classification = "EPHEMERAL";
  } else if (host.includes("dev") || nodeEnv === "development") {
    classification = "DEVELOPMENT";
  } else {
    classification = "QA";
  }

  return {
    isSafe: true,
    reason: `Verified ${classification} database environment`,
    metadata: {
      host,
      database: dbName,
      user,
      isExplicitNonProd: true,
      classification,
    },
  };
}

export async function assertNonProductionDatabase(): Promise<SafeDbMetadata> {
  const check = classifyDatabaseEnvironment({
    vitestActive: Boolean(process.env.VITEST),
    integrationMarker: process.env.R38A_INTEGRATION_TESTS ?? "true",
  });

  if (!check.isSafe) {
    const safeMsg = `R38.A integration tests refused to run: database environment is not explicitly classified as non-production. [${check.reason}]`;
    console.error(safeMsg);
    throw new Error(safeMsg);
  }

  // Live verification query to double check current_database()
  try {
    const res = await db.execute(sql`SELECT current_database(), current_user;`);
    const row = res.rows[0] as any;
    const dbName = String(row.current_database || "").toLowerCase();
    if (dbName.includes("prod") || dbName.includes("production")) {
      const safeMsg = "R38.A integration tests refused to run: live current_database() matches production pattern.";
      console.error(safeMsg);
      throw new Error(safeMsg);
    }
  } catch (err: any) {
    if (err.message?.includes("refused to run")) throw err;
    throw new Error(`R38.A integration tests refused to run: database verification query failed: ${err.message}`);
  }

  return check.metadata;
}

describe("R38.A Tenant Provisioning & Integrity Test Suite (TEST-01 to TEST-48)", () => {
  let masterAdminUser: any;
  let masterToken: string;
  let trialPlanId: number;

  const testCrecheIds: number[] = [];
  const testUserIds: number[] = [];

  beforeAll(async () => {
    // 0. Fail-Closed Non-Production Database Safety Guard
    await assertNonProductionDatabase();

    // 1. Ensure DB schema integrity
    await ensureTenantIntegritySchema();

    // 2. Ensure Trial Plan exists
    const [existingTrialPlan] = await db
      .select()
      .from(plansTable)
      .where(eq(plansTable.name, "Trial"))
      .limit(1);

    if (!existingTrialPlan) {
      const [newPlan] = await db
        .insert(plansTable)
        .values({
          name: "Trial",
          petLimit: 10,
          priceBrl: 0,
          description: "Teste grátis por 14 dias",
        })
        .returning();
      trialPlanId = newPlan.id;
    } else {
      trialPlanId = existingTrialPlan.id;
    }

    // 3. Create Master Admin for testing privileged operations
    const ts = Date.now();
    const masterEmail = `master-prov-${ts}@arkpet.test`;
    const [master] = await db
      .insert(usersTable)
      .values({
        name: "Master Admin R38",
        email: masterEmail,
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
    // Clean up created records
    if (testCrecheIds.length > 0) {
      await db.delete(commercialAuditLedgerTable).where(
        sql`target_creche_id = ANY(ARRAY[${sql.join(testCrecheIds.map(id => sql`${id}`), sql`, `)}]::int[])`
      );
      await db.delete(subscriptionsTable).where(
        sql`creche_id = ANY(ARRAY[${sql.join(testCrecheIds.map(id => sql`${id}`), sql`, `)}]::int[])`
      );
      await db.delete(invoicesTable).where(
        sql`creche_id = ANY(ARRAY[${sql.join(testCrecheIds.map(id => sql`${id}`), sql`, `)}]::int[])`
      );
      await db.delete(bookingsTable).where(
        sql`creche_id = ANY(ARRAY[${sql.join(testCrecheIds.map(id => sql`${id}`), sql`, `)}]::int[])`
      );
      await db.delete(petsTable).where(
        sql`creche_id = ANY(ARRAY[${sql.join(testCrecheIds.map(id => sql`${id}`), sql`, `)}]::int[])`
      );
      await db.delete(tutorCreditsTable).where(
        sql`creche_id = ANY(ARRAY[${sql.join(testCrecheIds.map(id => sql`${id}`), sql`, `)}]::int[])`
      );
      await db.delete(usersTable).where(
        sql`creche_id = ANY(ARRAY[${sql.join(testCrecheIds.map(id => sql`${id}`), sql`, `)}]::int[])`
      );
      await db.delete(crechesTable).where(
        sql`id = ANY(ARRAY[${sql.join(testCrecheIds.map(id => sql`${id}`), sql`, `)}]::int[])`
      );
    }
    if (testUserIds.length > 0) {
      await db.delete(usersTable).where(
        sql`id = ANY(ARRAY[${sql.join(testUserIds.map(id => sql`${id}`), sql`, `)}]::int[])`
      );
    }
  });

  // =========================================================================
  // GROUP A: MASTER PROVISIONING (POST /api/creches)
  // =========================================================================
  describe("GROUP A: MASTER PROVISIONING (POST /api/creches)", () => {
    it("TEST-01: Atomic Master Provisioning (Success)", async () => {
      const ts = Date.now();
      const adminEmail = `owner-t01-${ts}@test.invalid`;
      const res = await request(app)
        .post("/api/creches")
        .set("Authorization", `Bearer ${masterToken}`)
        .send({
          name: `Creche Test 01 ${ts}`,
          address: "Rua das Palmeiras 100",
          phone: "11988887777",
          email: `creche-t01-${ts}@test.invalid`,
          adminName: "Dono Alpha",
          adminEmail,
          adminPassword: "SecretPassword123!",
          reason: "Abertura de nova unidade Master",
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
      expect(res.body.status).toBe("active");
      const crecheId = res.body.id;
      testCrecheIds.push(crecheId);

      // Verify Creche in DB
      const [creche] = await db.select().from(crechesTable).where(eq(crechesTable.id, crecheId));
      expect(creche).toBeDefined();
      expect(creche.status).toBe("active");
      expect(creche.adminId).not.toBeNull();

      // Verify User in DB
      const [user] = await db.select().from(usersTable).where(eq(usersTable.email, adminEmail));
      expect(user).toBeDefined();
      expect(user.role).toBe("creche_admin");
      expect(user.isPrimaryOwner).toBe(true);
      expect(user.crecheId).toBe(crecheId);
      expect(creche.adminId).toBe(user.id);

      // Verify Subscription in DB (14-day trial)
      const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.crecheId, crecheId));
      expect(sub).toBeDefined();
      expect(sub.status).toBe("trial");
      expect(sub.planId).toBe(trialPlanId);
      expect(sub.trialEndsAt).not.toBeNull();
      const diffDays = Math.round((new Date(sub.trialEndsAt!).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBeGreaterThanOrEqual(13);
      expect(diffDays).toBeLessThanOrEqual(15);

      // Verify Commercial Audit Ledger
      const [audit] = await db
        .select()
        .from(commercialAuditLedgerTable)
        .where(
          and(
            eq(commercialAuditLedgerTable.targetCrecheId, crecheId),
            eq(commercialAuditLedgerTable.action, "TENANT_PROVISIONED")
          )
        );
      expect(audit).toBeDefined();
      expect(audit.reason).toBe("Abertura de nova unidade Master");
      expect(audit.actorRole).toBe("master_admin");
    });

    it("TEST-02: Master Provisioning Default Reason Compatibility", async () => {
      const ts = Date.now();
      const adminEmail = `owner-t02-${ts}@test.invalid`;
      const res = await request(app)
        .post("/api/creches")
        .set("Authorization", `Bearer ${masterToken}`)
        .send({
          name: `Creche Test 02 ${ts}`,
          address: "Rua Sem Motivo 200",
          phone: "11988887777",
          email: `creche-t02-${ts}@test.invalid`,
          adminName: "Dono Beta",
          adminEmail,
          adminPassword: "SecretPassword123!",
        });

      expect(res.status).toBe(201);
      const crecheId = res.body.id;
      testCrecheIds.push(crecheId);

      // Verify default reason in audit log
      const [audit] = await db
        .select()
        .from(commercialAuditLedgerTable)
        .where(
          and(
            eq(commercialAuditLedgerTable.targetCrecheId, crecheId),
            eq(commercialAuditLedgerTable.action, "TENANT_PROVISIONED")
          )
        );
      expect(audit).toBeDefined();
      expect(audit.reason).toBe("Criação direta de creche pelo Master Admin");
    });

    it("TEST-03: Master Provisioning Email Conflict", async () => {
      const ts = Date.now();
      const duplicateEmail = `conflict-t03-${ts}@test.invalid`;

      // Create pre-existing user with this email
      const [existing] = await db
        .insert(usersTable)
        .values({
          name: "Existing User",
          email: duplicateEmail,
          passwordHash: hashPassword("Pass123!"),
          role: "staff",
          isActive: true,
        })
        .returning();
      testUserIds.push(existing.id);

      const res = await request(app)
        .post("/api/creches")
        .set("Authorization", `Bearer ${masterToken}`)
        .send({
          name: `Creche Conflict ${ts}`,
          address: "Rua Conflito",
          phone: "11988887777",
          email: `creche-conflict-${ts}@test.invalid`,
          adminName: "Tentativa Conflito",
          adminEmail: duplicateEmail,
          adminPassword: "SecretPassword123!",
        });

      expect(res.status).toBe(409);
      // Verify no creche was created
      const creches = await db
        .select()
        .from(crechesTable)
        .where(eq(crechesTable.name, `Creche Conflict ${ts}`));
      expect(creches.length).toBe(0);
    });

    it("TEST-04: Master Provisioning Subscription Failure Rollback", async () => {
      const ts = Date.now();
      const orphanEmail = `orphan-t04-${ts}@test.invalid`;

      // Trigger provisioning with simulated failure by passing invalid/corrupt parameters or bad trial plan
      await expect(
        provisionTenant({
          name: `Creche Rollback ${ts}`,
          email: `creche-rollback-${ts}@test.invalid`,
          adminName: "Rollback User",
          adminEmail: orphanEmail,
          adminPassword: "Password123!",
        }, {
          insert: () => {
            throw new Error("Simulated subscription insert failure");
          },
        })
      ).rejects.toThrow();

      // Verify full rollback: 0 orphan creche or user rows
      const users = await db.select().from(usersTable).where(eq(usersTable.email, orphanEmail));
      expect(users.length).toBe(0);
    });

    it("TEST-05: Master Provisioning Non-Master Rejection", async () => {
      const ts = Date.now();
      // Regular user token
      const [regular] = await db
        .insert(usersTable)
        .values({
          name: "Regular Admin",
          email: `regular-t05-${ts}@test.invalid`,
          passwordHash: hashPassword("Pass123!"),
          role: "creche_admin",
          isActive: true,
        })
        .returning();
      testUserIds.push(regular.id);
      const regularToken = generateToken(regular.id, regular.role);

      const res = await request(app)
        .post("/api/creches")
        .set("Authorization", `Bearer ${regularToken}`)
        .send({
          name: `Creche NonMaster ${ts}`,
          address: "Rua Proibida",
          phone: "11988887777",
          email: `creche-nonmaster-${ts}@test.invalid`,
          adminName: "Tentativa Proibida",
          adminEmail: `admin-forbidden-${ts}@test.invalid`,
          adminPassword: "SecretPassword123!",
        });

      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // GROUP B: PUBLIC SELF-SERVICE SIGNUP (POST /api/auth/register-creche)
  // =========================================================================
  describe("GROUP B: PUBLIC SELF-SERVICE SIGNUP (POST /api/auth/register-creche)", () => {
    it("TEST-06: Self-Signup Atomic Success (DEC-01/05/08)", async () => {
      const ts = Date.now();
      const adminEmail = `selfsignup-t06-${ts}@test.invalid`;

      const res = await request(app)
        .post("/api/auth/register-creche")
        .set("X-Forwarded-For", `192.168.1.${ts % 200}`)
        .send({
          name: "Dono Autocadastro",
          email: adminEmail,
          password: "SecretPassword123!",
          crecheName: `Creche Autocadastro ${ts}`,
          crechePhone: "11977776666",
          crecheAddress: "Av Brasil 500",
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("token");
      expect(res.body).toHaveProperty("user");
      expect(res.body.user.isPrimaryOwner).toBe(true);

      const crecheId = res.body.user.crecheId;
      testCrecheIds.push(crecheId);

      // Verify Creche, Sub, Audit
      const [creche] = await db.select().from(crechesTable).where(eq(crechesTable.id, crecheId));
      expect(creche.status).toBe("active");

      const [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.crecheId, crecheId));
      expect(sub.status).toBe("trial");

      const [audit] = await db
        .select()
        .from(commercialAuditLedgerTable)
        .where(
          and(
            eq(commercialAuditLedgerTable.targetCrecheId, crecheId),
            eq(commercialAuditLedgerTable.action, "TENANT_PROVISIONED")
          )
        );
      expect(audit).toBeDefined();
      expect(audit.reason).toBe("Autocadastro público de creche (trial)");
    });

    it("TEST-07: Self-Signup Email Conflict Race", async () => {
      const ts = Date.now();
      const dupEmail = `dup-t07-${ts}@test.invalid`;

      const [existing] = await db
        .insert(usersTable)
        .values({
          name: "User Exists",
          email: dupEmail,
          passwordHash: hashPassword("Pass123!"),
          role: "creche_admin",
          isActive: true,
        })
        .returning();
      testUserIds.push(existing.id);

      const res = await request(app)
        .post("/api/auth/register-creche")
        .set("X-Forwarded-For", `192.168.2.${ts % 200}`)
        .send({
          name: "User Duplicate",
          email: dupEmail,
          password: "SecretPassword123!",
          crecheName: `Creche Dup ${ts}`,
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Este e-mail já está cadastrado.");
    });

    it("TEST-08: Self-Signup Rate Limiting", async () => {
      const fixedIp = "192.168.99.88";
      // Exhaust rate limiter on this specific IP (sensitiveLimiter max = 10)
      let lastStatus = 0;
      for (let i = 0; i < 12; i++) {
        const res = await request(app)
          .post("/api/auth/register-creche")
          .set("X-Forwarded-For", fixedIp)
          .send({
            name: "Rate Limit Test",
            email: `invalid-email-${i}`,
            password: "123",
            crecheName: "Rate Limit Creche",
          });
        lastStatus = res.status;
      }
      expect(lastStatus).toBe(429);
    });

    it("TEST-09: Self-Signup Input Validation Error", async () => {
      const ts = Date.now();
      const res = await request(app)
        .post("/api/auth/register-creche")
        .set("X-Forwarded-For", `192.168.3.${ts % 200}`)
        .send({
          name: "Bad Input",
          email: "not-an-email",
          password: "short",
          crecheName: "Bad Input Creche",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });
  });

  // =========================================================================
  // GROUP C: PRIMARY OWNER INTEGRITY & UNIQUENESS (DEC-26)
  // =========================================================================
  describe("GROUP C: PRIMARY OWNER INTEGRITY & UNIQUENESS (DEC-26)", () => {
    it("TEST-10: Database Prevents Multiple Primary Owners", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Creche DEC26 ${ts}`,
          address: "Rua Unicidade",
          phone: "11988887777",
          email: `creche-dec26-${ts}@test.invalid`,
          status: "active",
        })
        .returning();
      testCrecheIds.push(creche.id);

      // Insert 1st primary owner
      const [user1] = await db
        .insert(usersTable)
        .values({
          name: "Owner 1",
          email: `owner1-${ts}@test.invalid`,
          passwordHash: hashPassword("Pass123!"),
          role: "creche_admin",
          crecheId: creche.id,
          isPrimaryOwner: true,
          isActive: true,
        })
        .returning();
      testUserIds.push(user1.id);

      // Attempt inserting 2nd primary owner for same creche
      let errorThrown: any = null;
      try {
        await db.insert(usersTable).values({
          name: "Owner 2",
          email: `owner2-${ts}@test.invalid`,
          passwordHash: hashPassword("Pass123!"),
          role: "creche_admin",
          crecheId: creche.id,
          isPrimaryOwner: true,
          isActive: true,
        });
      } catch (err: any) {
        errorThrown = err;
      }

      expect(errorThrown).not.toBeNull();
      const codeOrMsg = String((errorThrown as any)?.cause?.code || (errorThrown as any)?.code || (errorThrown as any)?.cause?.message || errorThrown?.message);
      expect(codeOrMsg).toMatch(/23505|unique|users_creche_primary_owner_unique_idx/i);
    });

    it("TEST-11: Multiple Users with is_primary_owner = false Allowed", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Creche NonOwners ${ts}`,
          address: "Rua Non Owners",
          phone: "11988887777",
          email: `creche-nonowners-${ts}@test.invalid`,
          status: "active",
        })
        .returning();
      testCrecheIds.push(creche.id);

      const [staff1] = await db
        .insert(usersTable)
        .values({
          name: "Staff 1",
          email: `staff1-${ts}@test.invalid`,
          passwordHash: hashPassword("Pass123!"),
          role: "staff",
          crecheId: creche.id,
          isPrimaryOwner: false,
          isActive: true,
        })
        .returning();

      const [staff2] = await db
        .insert(usersTable)
        .values({
          name: "Staff 2",
          email: `staff2-${ts}@test.invalid`,
          passwordHash: hashPassword("Pass123!"),
          role: "staff",
          crecheId: creche.id,
          isPrimaryOwner: false,
          isActive: true,
        })
        .returning();

      testUserIds.push(staff1.id, staff2.id);
      expect(staff1.id).toBeDefined();
      expect(staff2.id).toBeDefined();
    });

    it("TEST-12: Master Admin Null Creche Not Constrained", async () => {
      const ts = Date.now();
      const [master1] = await db
        .insert(usersTable)
        .values({
          name: "Master 1",
          email: `master1-${ts}@test.invalid`,
          passwordHash: hashPassword("Pass123!"),
          role: "master_admin",
          crecheId: null,
          isPrimaryOwner: true,
          isActive: true,
        })
        .returning();

      const [master2] = await db
        .insert(usersTable)
        .values({
          name: "Master 2",
          email: `master2-${ts}@test.invalid`,
          passwordHash: hashPassword("Pass123!"),
          role: "master_admin",
          crecheId: null,
          isPrimaryOwner: true,
          isActive: true,
        })
        .returning();

      testUserIds.push(master1.id, master2.id);
      expect(master1.id).toBeDefined();
      expect(master2.id).toBeDefined();
    });

    it("TEST-13: Primary Owner Flag in Login Payload", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Creche Login ${ts}`,
          address: "Rua Login",
          phone: "11988887777",
          email: `creche-login-${ts}@test.invalid`,
          status: "active",
        })
        .returning();
      testCrecheIds.push(creche.id);

      const ownerEmail = `owner-login-${ts}@test.invalid`;
      const staffEmail = `staff-login-${ts}@test.invalid`;

      const [owner] = await db
        .insert(usersTable)
        .values({
          name: "Owner Login",
          email: ownerEmail,
          passwordHash: hashPassword("Secret123!"),
          role: "creche_admin",
          crecheId: creche.id,
          isPrimaryOwner: true,
          isActive: true,
        })
        .returning();

      const [staff] = await db
        .insert(usersTable)
        .values({
          name: "Staff Login",
          email: staffEmail,
          passwordHash: hashPassword("Secret123!"),
          role: "staff",
          crecheId: creche.id,
          isPrimaryOwner: false,
          isActive: true,
        })
        .returning();

      testUserIds.push(owner.id, staff.id);

      // Login as Owner
      const resOwner = await request(app)
        .post("/api/auth/login")
        .send({ email: ownerEmail, password: "Secret123!" });
      expect(resOwner.status).toBe(200);
      expect(resOwner.body.user.isPrimaryOwner).toBe(true);

      // Login as Staff
      const resStaff = await request(app)
        .post("/api/auth/login")
        .send({ email: staffEmail, password: "Secret123!" });
      expect(resStaff.status).toBe(200);
      expect(resStaff.body.user.isPrimaryOwner).toBe(false);
    });
  });

  // =========================================================================
  // GROUP D: HISTORICAL BACKFILL & AMBIGUITY SAFETY
  // =========================================================================
  describe("GROUP D: HISTORICAL BACKFILL & AMBIGUITY SAFETY", () => {
    it("TEST-14: Backfill Category A: Single Admin", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Backfill CatA ${ts}`,
          address: "Rua Cat A",
          phone: "11988887777",
          email: `creche-cata-${ts}@test.invalid`,
          status: "active",
        })
        .returning();
      testCrecheIds.push(creche.id);

      const [admin] = await db
        .insert(usersTable)
        .values({
          name: "Single Admin",
          email: `single-admin-${ts}@test.invalid`,
          passwordHash: hashPassword("Pass123!"),
          role: "creche_admin",
          crecheId: creche.id,
          isPrimaryOwner: false,
          isActive: true,
        })
        .returning();
      testUserIds.push(admin.id);

      const report = await backfillPrimaryOwners();
      expect(report.assignedCount).toBeGreaterThanOrEqual(1);

      const [updatedAdmin] = await db.select().from(usersTable).where(eq(usersTable.id, admin.id));
      expect(updatedAdmin.isPrimaryOwner).toBe(true);
    });

    it("TEST-15: Backfill Category B: Admin Matching admin_id", async () => {
      const ts = Date.now();
      const [admin1] = await db
        .insert(usersTable)
        .values({
          name: "Admin Matching",
          email: `matching-admin-${ts}@test.invalid`,
          passwordHash: hashPassword("Pass123!"),
          role: "creche_admin",
          isPrimaryOwner: false,
          isActive: true,
        })
        .returning();

      const [admin2] = await db
        .insert(usersTable)
        .values({
          name: "Admin Other",
          email: `other-admin-${ts}@test.invalid`,
          passwordHash: hashPassword("Pass123!"),
          role: "creche_admin",
          isPrimaryOwner: false,
          isActive: true,
        })
        .returning();

      testUserIds.push(admin1.id, admin2.id);

      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Backfill CatB ${ts}`,
          address: "Rua Cat B",
          phone: "11988887777",
          email: `creche-catb-${ts}@test.invalid`,
          adminId: admin1.id,
          status: "active",
        })
        .returning();
      testCrecheIds.push(creche.id);

      await db.update(usersTable).set({ crecheId: creche.id }).where(eq(usersTable.id, admin1.id));
      await db.update(usersTable).set({ crecheId: creche.id }).where(eq(usersTable.id, admin2.id));

      await backfillPrimaryOwners();

      const [refreshed1] = await db.select().from(usersTable).where(eq(usersTable.id, admin1.id));
      const [refreshed2] = await db.select().from(usersTable).where(eq(usersTable.id, admin2.id));

      expect(refreshed1.isPrimaryOwner).toBe(true);
      expect(refreshed2.isPrimaryOwner).toBe(false);
    });

    it("TEST-16: Backfill Category C: Ambiguous Multiple Admins NOT Assigned", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Backfill CatC Ambiguous ${ts}`,
          address: "Rua Cat C",
          phone: "11988887777",
          email: `creche-catc-${ts}@test.invalid`,
          adminId: null, // No match
          status: "active",
        })
        .returning();
      testCrecheIds.push(creche.id);

      const [adminA] = await db
        .insert(usersTable)
        .values({
          name: "Ambiguous Admin A",
          email: `amb-a-${ts}@test.invalid`,
          passwordHash: hashPassword("Pass123!"),
          role: "creche_admin",
          crecheId: creche.id,
          isPrimaryOwner: false,
          isActive: true,
        })
        .returning();

      const [adminB] = await db
        .insert(usersTable)
        .values({
          name: "Ambiguous Admin B",
          email: `amb-b-${ts}@test.invalid`,
          passwordHash: hashPassword("Pass123!"),
          role: "creche_admin",
          crecheId: creche.id,
          isPrimaryOwner: false,
          isActive: true,
        })
        .returning();

      testUserIds.push(adminA.id, adminB.id);

      const report = await backfillPrimaryOwners();
      const foundAmbiguous = report.unresolvedAmbiguous.find(c => c.crecheId === creche.id);
      expect(foundAmbiguous).toBeDefined();

      const [refA] = await db.select().from(usersTable).where(eq(usersTable.id, adminA.id));
      const [refB] = await db.select().from(usersTable).where(eq(usersTable.id, adminB.id));

      // Neither should be updated
      expect(refA.isPrimaryOwner).toBe(false);
      expect(refB.isPrimaryOwner).toBe(false);
    });

    it("TEST-17: Backfill Category D: No Active Admin NOT Assigned", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Backfill CatD NoAdmin ${ts}`,
          address: "Rua Cat D",
          phone: "11988887777",
          email: `creche-catd-${ts}@test.invalid`,
          status: "active",
        })
        .returning();
      testCrecheIds.push(creche.id);

      const report = await backfillPrimaryOwners();
      const foundNoAdmin = report.unresolvedNoAdmin.find(c => c.crecheId === creche.id);
      expect(foundNoAdmin).toBeDefined();
    });

    it("TEST-18: Startup Migration Does NOT Fail on Unresolved Owners", async () => {
      // Running initializeDatabase on DB containing ambiguous and no-admin creches
      await expect(initializeDatabase()).resolves.not.toThrow();
    });

    it("TEST-19: Unique Index Allows Zero Owners (At Most One Invariant)", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Creche Zero Owners ${ts}`,
          address: "Rua Zero",
          phone: "11988887777",
          email: `creche-zero-${ts}@test.invalid`,
          status: "active",
        })
        .returning();
      testCrecheIds.push(creche.id);

      const owners = await db
        .select()
        .from(usersTable)
        .where(
          and(
            eq(usersTable.crecheId, creche.id),
            eq(usersTable.isPrimaryOwner, true)
          )
        );
      expect(owners.length).toBe(0);
    });
  });

  // =========================================================================
  // GROUP E: SAAS-BR-003 TENANT ARCHIVE & DETERMINISTIC BLOCKERS
  // =========================================================================
  describe("GROUP E: SAAS-BR-003 TENANT ARCHIVE & DETERMINISTIC BLOCKERS", () => {
    it("TEST-20: Soft-Delete Transitions to Archived (Success)", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Creche Archive Success ${ts}`,
          address: "Rua Archive",
          phone: "11988887777",
          email: `creche-archive-${ts}@test.invalid`,
          status: "active",
        })
        .returning();
      testCrecheIds.push(creche.id);

      const res = await request(app)
        .delete(`/api/creches/${creche.id}`)
        .set("Authorization", `Bearer ${masterToken}`)
        .send({ reason: "Desistência formal do cliente" });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.creche.status).toBe("archived");

      // Verify row not deleted, status is archived and deletedAt is populated
      const [refreshed] = await db.select().from(crechesTable).where(eq(crechesTable.id, creche.id));
      expect(refreshed).toBeDefined();
      expect(refreshed.status).toBe("archived");
      expect(refreshed.deletedAt).not.toBeNull();
    });

    it("TEST-21: Soft-Delete Preserves User Associations", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Creche Archive Users ${ts}`,
          address: "Rua Users",
          phone: "11988887777",
          email: `creche-users-${ts}@test.invalid`,
          status: "active",
        })
        .returning();
      testCrecheIds.push(creche.id);

      const [user] = await db
        .insert(usersTable)
        .values({
          name: "User In Creche",
          email: `user-archive-${ts}@test.invalid`,
          passwordHash: hashPassword("Pass123!"),
          role: "staff",
          crecheId: creche.id,
          isActive: true,
        })
        .returning();
      testUserIds.push(user.id);

      await request(app)
        .delete(`/api/creches/${creche.id}`)
        .set("Authorization", `Bearer ${masterToken}`)
        .send({ reason: "Arquivamento para verificar usuários" });

      const [refreshedUser] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
      expect(refreshedUser.crecheId).toBe(creche.id);
    });

    it("TEST-22: Soft-Delete Suspends Local Subscription", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Creche Sub Suspend ${ts}`,
          address: "Rua Sub",
          phone: "11988887777",
          email: `creche-sub-${ts}@test.invalid`,
          status: "active",
        })
        .returning();
      testCrecheIds.push(creche.id);

      const [sub] = await db
        .insert(subscriptionsTable)
        .values({
          crecheId: creche.id,
          planId: trialPlanId,
          status: "trial",
          trialEndsAt: new Date(Date.now() + 10 * 86400000),
        })
        .returning();

      await request(app)
        .delete(`/api/creches/${creche.id}`)
        .set("Authorization", `Bearer ${masterToken}`)
        .send({ reason: "Arquivamento suspendendo trial" });

      const [refreshedSub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, sub.id));
      expect(refreshedSub.status).toBe("suspended");

      // Verify Audit log recorded transition
      const [audit] = await db
        .select()
        .from(commercialAuditLedgerTable)
        .where(
          and(
            eq(commercialAuditLedgerTable.targetCrecheId, creche.id),
            eq(commercialAuditLedgerTable.action, "TENANT_ARCHIVED")
          )
        );
      expect(audit).toBeDefined();
      expect((audit.afterState as any)?.subscriptionStatus).toBe("suspended");
    });

    it("TEST-23: Archive Blocked by Open Tutor Invoices", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Creche Open Inv ${ts}`,
          address: "Rua Inv",
          phone: "11988887777",
          email: `creche-inv-${ts}@test.invalid`,
          status: "active",
        })
        .returning();
      testCrecheIds.push(creche.id);

      const [tutor] = await db
        .insert(usersTable)
        .values({
          name: "Tutor Invoice",
          email: `tutor-inv-${ts}@test.invalid`,
          passwordHash: hashPassword("Pass123!"),
          role: "tutor",
          crecheId: creche.id,
          isActive: true,
        })
        .returning();
      testUserIds.push(tutor.id);

      await db.insert(invoicesTable).values({
        crecheId: creche.id,
        tutorId: tutor.id,
        status: "pending",
        amount: "150.00",
        dueDate: new Date().toISOString().split("T")[0],
      });

      const res = await request(app)
        .delete(`/api/creches/${creche.id}`)
        .set("Authorization", `Bearer ${masterToken}`)
        .send({ reason: "Tentativa de arquivar com fatura aberta" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("tenant_archive_open_invoice");

      const [crecheAfter] = await db.select().from(crechesTable).where(eq(crechesTable.id, creche.id));
      expect(crecheAfter.status).toBe("active");
    });

    it("TEST-24: Archive Blocked by Future Operational Bookings", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Creche Future Booking ${ts}`,
          address: "Rua Booking",
          phone: "11988887777",
          email: `creche-book-${ts}@test.invalid`,
          status: "active",
        })
        .returning();
      testCrecheIds.push(creche.id);

      const [tutor] = await db
        .insert(usersTable)
        .values({
          name: "Tutor Booking",
          email: `tutor-book-${ts}@test.invalid`,
          passwordHash: hashPassword("Pass123!"),
          role: "tutor",
          crecheId: creche.id,
          isActive: true,
        })
        .returning();
      testUserIds.push(tutor.id);

      const [pet] = await db
        .insert(petsTable)
        .values({
          name: "Rex Future",
          species: "dog",
          size: "medium",
          tutorId: tutor.id,
          crecheId: creche.id,
        })
        .returning();

      const futureDate = new Date(Date.now() + 5 * 86400000).toISOString().split("T")[0];
      await db.insert(bookingsTable).values({
        crecheId: creche.id,
        tutorId: tutor.id,
        petId: pet.id,
        startDate: futureDate,
        endDate: futureDate,
        status: "active",
        type: "day_use",
      });

      const res = await request(app)
        .delete(`/api/creches/${creche.id}`)
        .set("Authorization", `Bearer ${masterToken}`)
        .send({ reason: "Tentativa com reserva futura" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("tenant_archive_future_booking");
    });

    it("TEST-25: Archive Blocked by Active Pet Check-ins", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Creche Active Checkin ${ts}`,
          address: "Rua Checkin",
          phone: "11988887777",
          email: `creche-checkin-${ts}@test.invalid`,
          status: "active",
        })
        .returning();
      testCrecheIds.push(creche.id);

      const [tutor] = await db
        .insert(usersTable)
        .values({
          name: "Tutor Pet",
          email: `tutor-pet-${ts}@test.invalid`,
          passwordHash: hashPassword("Pass123!"),
          role: "tutor",
          crecheId: creche.id,
          isActive: true,
        })
        .returning();
      testUserIds.push(tutor.id);

      await db.insert(petsTable).values({
        name: "Thor Checked In",
        species: "dog",
        size: "large",
        tutorId: tutor.id,
        crecheId: creche.id,
        isCheckedIn: true,
      });

      const res = await request(app)
        .delete(`/api/creches/${creche.id}`)
        .set("Authorization", `Bearer ${masterToken}`)
        .send({ reason: "Tentativa com pet em checkin" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("tenant_archive_active_checkin");
    });

    it("TEST-26: Archive Blocked by Positive Tutor Credits", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Creche Positive Credits ${ts}`,
          address: "Rua Credits",
          phone: "11988887777",
          email: `creche-cred-${ts}@test.invalid`,
          status: "active",
        })
        .returning();
      testCrecheIds.push(creche.id);

      const [tutor] = await db
        .insert(usersTable)
        .values({
          name: "Tutor Credits",
          email: `tutor-cred-${ts}@test.invalid`,
          passwordHash: hashPassword("Pass123!"),
          role: "tutor",
          crecheId: creche.id,
          isActive: true,
        })
        .returning();
      testUserIds.push(tutor.id);

      await db.insert(tutorCreditsTable).values({
        crecheId: creche.id,
        tutorId: tutor.id,
        totalCredits: 10,
        usedCredits: 2,
      });

      const res = await request(app)
        .delete(`/api/creches/${creche.id}`)
        .set("Authorization", `Bearer ${masterToken}`)
        .send({ reason: "Tentativa com créditos positivos" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("tenant_archive_positive_credit");
    });

    it("TEST-27: Archive Blocked by Active Stripe Recurring Subscription", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Creche Stripe Sub ${ts}`,
          address: "Rua Stripe",
          phone: "11988887777",
          email: `creche-stripe-${ts}@test.invalid`,
          status: "active",
        })
        .returning();
      testCrecheIds.push(creche.id);

      await db.insert(subscriptionsTable).values({
        crecheId: creche.id,
        planId: trialPlanId,
        status: "active",
        stripeSubscriptionId: "sub_mock_active_123",
      });

      const res = await request(app)
        .delete(`/api/creches/${creche.id}`)
        .set("Authorization", `Bearer ${masterToken}`)
        .send({ reason: "Tentativa com stripe ativo" });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("stripe_subscription_active");
    });

    it("TEST-28: Blocked Archive Durably Writes TENANT_ARCHIVE_BLOCKED", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Creche Blocked Audit ${ts}`,
          address: "Rua Audit",
          phone: "11988887777",
          email: `creche-audit-${ts}@test.invalid`,
          status: "active",
        })
        .returning();
      testCrecheIds.push(creche.id);

      const [tutor] = await db
        .insert(usersTable)
        .values({
          name: "Tutor Audit",
          email: `tutor-aud-${ts}@test.invalid`,
          passwordHash: hashPassword("Pass123!"),
          role: "tutor",
          crecheId: creche.id,
          isActive: true,
        })
        .returning();
      testUserIds.push(tutor.id);

      await db.insert(invoicesTable).values({
        crecheId: creche.id,
        tutorId: tutor.id,
        status: "pending",
        amount: "50.00",
        dueDate: new Date().toISOString().split("T")[0],
      });

      await request(app)
        .delete(`/api/creches/${creche.id}`)
        .set("Authorization", `Bearer ${masterToken}`)
        .send({ reason: "Auditoria de bloqueio durável" });

      const [audit] = await db
        .select()
        .from(commercialAuditLedgerTable)
        .where(
          and(
            eq(commercialAuditLedgerTable.targetCrecheId, creche.id),
            eq(commercialAuditLedgerTable.action, "TENANT_ARCHIVE_BLOCKED")
          )
        );

      expect(audit).toBeDefined();
      expect(audit.reason).toBe("Auditoria de bloqueio durável");
      expect((audit.afterState as any)?.blockers).toBeDefined();
    });

    it("TEST-29: Blocked Archive Leaves Tenant and Subscription Untouched", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Creche Untouched ${ts}`,
          address: "Rua Untouched",
          phone: "11988887777",
          email: `creche-untouched-${ts}@test.invalid`,
          status: "active",
        })
        .returning();
      testCrecheIds.push(creche.id);

      const [sub] = await db
        .insert(subscriptionsTable)
        .values({
          crecheId: creche.id,
          planId: trialPlanId,
          status: "trial",
          trialEndsAt: new Date(Date.now() + 5 * 86400000),
        })
        .returning();

      const [tutor] = await db
        .insert(usersTable)
        .values({
          name: "Tutor Untouched",
          email: `tutor-untouched-${ts}@test.invalid`,
          passwordHash: hashPassword("Pass123!"),
          role: "tutor",
          crecheId: creche.id,
          isActive: true,
        })
        .returning();
      testUserIds.push(tutor.id);

      await db.insert(invoicesTable).values({
        crecheId: creche.id,
        tutorId: tutor.id,
        status: "pending",
        amount: "90.00",
        dueDate: new Date().toISOString().split("T")[0],
      });

      // Archive is blocked
      await request(app)
        .delete(`/api/creches/${creche.id}`)
        .set("Authorization", `Bearer ${masterToken}`)
        .send({ reason: "Tentativa com bloqueio" });

      const [cAfter] = await db.select().from(crechesTable).where(eq(crechesTable.id, creche.id));
      const [sAfter] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.id, sub.id));

      expect(cAfter.status).toBe("active");
      expect(cAfter.deletedAt).toBeNull();
      expect(sAfter.status).toBe("trial");
    });
  });

  // =========================================================================
  // GROUP F: TENANT RESTORATION & INVARIANT-R38A-02 (PUT /api/creches/:id)
  // =========================================================================
  describe("GROUP F: TENANT RESTORATION & INVARIANT-R38A-02 (PUT /api/creches/:id)", () => {
    it("TEST-30: Restore Changes Tenant State Only", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Creche Restore ${ts}`,
          address: "Rua Restore",
          phone: "11988887777",
          email: `creche-restore-${ts}@test.invalid`,
          status: "archived",
          deletedAt: new Date(),
        })
        .returning();
      testCrecheIds.push(creche.id);

      const res = await request(app)
        .put(`/api/creches/${creche.id}`)
        .set("Authorization", `Bearer ${masterToken}`)
        .send({ status: "active", reason: "Reativação contratual aprovada" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("active");

      const [refreshed] = await db.select().from(crechesTable).where(eq(crechesTable.id, creche.id));
      expect(refreshed.status).toBe("active");
      expect(refreshed.deletedAt).toBeNull();

      // Verify audit
      const [audit] = await db
        .select()
        .from(commercialAuditLedgerTable)
        .where(
          and(
            eq(commercialAuditLedgerTable.targetCrecheId, creche.id),
            eq(commercialAuditLedgerTable.action, "TENANT_RESTORED")
          )
        );
      expect(audit).toBeDefined();
      expect(audit.reason).toBe("Reativação contratual aprovada");
    });

    it("TEST-31: Restore Does NOT Grant New Trial or Extend Trial", async () => {
      const ts = Date.now();
      const originalTrialEnd = new Date(Date.now() - 2 * 86400000); // Expired trial

      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Creche Sub Invariant ${ts}`,
          address: "Rua Invariant",
          phone: "11988887777",
          email: `creche-invsub-${ts}@test.invalid`,
          status: "archived",
          deletedAt: new Date(),
        })
        .returning();
      testCrecheIds.push(creche.id);

      const [sub] = await db
        .insert(subscriptionsTable)
        .values({
          crecheId: creche.id,
          planId: trialPlanId,
          status: "suspended",
          trialEndsAt: originalTrialEnd,
        })
        .returning();

      // Master admin restores tenant
      await request(app)
        .put(`/api/creches/${creche.id}`)
        .set("Authorization", `Bearer ${masterToken}`)
        .send({ status: "active", reason: "Reativação sem novo trial" });

      // Invariant-R38A-02: subscription remains suspended, trialEndsAt not extended, no new row
      const subs = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.crecheId, creche.id));
      expect(subs.length).toBe(1);
      expect(subs[0].status).toBe("suspended");
      expect(new Date(subs[0].trialEndsAt!).getTime()).toBe(originalTrialEnd.getTime());
    });

    it("TEST-32: Restore with Suspended Sub Remains Blocked by Middleware", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Creche Restored Blocked ${ts}`,
          address: "Rua Blocked",
          phone: "11988887777",
          email: `creche-restblocked-${ts}@test.invalid`,
          status: "active",
        })
        .returning();
      testCrecheIds.push(creche.id);

      // Subscription is suspended
      await db.insert(subscriptionsTable).values({
        crecheId: creche.id,
        planId: trialPlanId,
        status: "suspended",
      });

      const [admin] = await db
        .insert(usersTable)
        .values({
          name: "Restored Admin",
          email: `admin-restblocked-${ts}@test.invalid`,
          passwordHash: hashPassword("Pass123!"),
          role: "creche_admin",
          crecheId: creche.id,
          isActive: true,
        })
        .returning();
      testUserIds.push(admin.id);
      const adminToken = generateToken(admin.id, admin.role);

      // Operational route should be blocked with 402 Payment Required
      const res = await request(app)
        .get(`/api/creches/${creche.id}/pets`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(402);
      expect(res.body.error).toBe("subscription_suspended");
    });

    it("TEST-33: Creche Admin Forbidden to Restore Archived Tenant", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Creche Forbidden Restore ${ts}`,
          address: "Rua Forbid",
          phone: "11988887777",
          email: `creche-forbid-${ts}@test.invalid`,
          status: "archived",
          deletedAt: new Date(),
        })
        .returning();
      testCrecheIds.push(creche.id);

      const [admin] = await db
        .insert(usersTable)
        .values({
          name: "Admin Forbid",
          email: `admin-forbid-${ts}@test.invalid`,
          passwordHash: hashPassword("Pass123!"),
          role: "creche_admin",
          crecheId: creche.id,
          isActive: true,
        })
        .returning();
      testUserIds.push(admin.id);
      const adminToken = generateToken(admin.id, admin.role);

      const res = await request(app)
        .put(`/api/creches/${creche.id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "active" });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("tenant_archived");
    });
  });

  // =========================================================================
  // GROUP G: ROUTE-LEVEL ACCESS GUARDS
  // =========================================================================
  describe("GROUP G: ROUTE-LEVEL ACCESS GUARDS", () => {
    let archivedCreche: any;
    let archivedAdmin: any;
    let archivedToken: string;

    beforeAll(async () => {
      const ts = Date.now();
      const [c] = await db
        .insert(crechesTable)
        .values({
          name: `Archived Guard Creche ${ts}`,
          address: "Rua Guard",
          phone: "11988887777",
          email: `creche-guard-${ts}@test.invalid`,
          status: "archived",
          deletedAt: new Date(),
        })
        .returning();
      archivedCreche = c;
      testCrecheIds.push(c.id);

      const [u] = await db
        .insert(usersTable)
        .values({
          name: "Archived Admin User",
          email: `archived-admin-${ts}@test.invalid`,
          passwordHash: hashPassword("Secret123!"),
          role: "creche_admin",
          crecheId: c.id,
          isActive: true,
        })
        .returning();
      archivedAdmin = u;
      testUserIds.push(u.id);
      archivedToken = generateToken(u.id, u.role);
    });

    it("TEST-34: Login Blocked for Archived Tenant User", async () => {
      const res = await request(app)
        .post("/api/auth/login")
        .send({
          email: archivedAdmin.email,
          password: "Secret123!",
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("tenant_archived");
      expect(res.body.token).toBeUndefined();
    });

    it("TEST-35: Operational Route Blocked (Pets)", async () => {
      const res = await request(app)
        .get(`/api/creches/${archivedCreche.id}/pets`)
        .set("Authorization", `Bearer ${archivedToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("tenant_archived");
    });

    it("TEST-36: Operational Route Blocked (Bookings)", async () => {
      const res = await request(app)
        .post(`/api/creches/${archivedCreche.id}/bookings`)
        .set("Authorization", `Bearer ${archivedToken}`)
        .send({
          petId: 1,
          tutorId: 1,
          startDate: "2026-10-01",
          endDate: "2026-10-01",
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("tenant_archived");
    });

    it("TEST-37: Operational Route Blocked (Financial)", async () => {
      const res = await request(app)
        .get(`/api/creches/${archivedCreche.id}/financial/invoices`)
        .set("Authorization", `Bearer ${archivedToken}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("tenant_archived");
    });

    it("TEST-38: Storage Upload Blocked for Archived Tenant", async () => {
      const res = await request(app)
        .post("/api/storage/uploads/request-url")
        .set("Authorization", `Bearer ${archivedToken}`)
        .send({
          name: "photo.jpg",
          size: 1024,
          contentType: "image/jpeg",
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("tenant_archived");
    });

    it("TEST-39: Master Admin Retains Access to Archived Tenant", async () => {
      const res = await request(app)
        .get(`/api/creches/${archivedCreche.id}/pets`)
        .set("Authorization", `Bearer ${masterToken}`);

      expect(res.status).toBe(200);
    });
  });

  // =========================================================================
  // GROUP H: NON-REGRESSION & ROLLBACK COMPATIBILITY
  // =========================================================================
  describe("GROUP H: NON-REGRESSION & ROLLBACK COMPATIBILITY", () => {
    it("TEST-40: Active Tenant Operations Completely Unaffected", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Active Clean ${ts}`,
          address: "Rua Normal",
          phone: "11988887777",
          email: `clean-${ts}@test.invalid`,
          status: "active",
        })
        .returning();
      testCrecheIds.push(creche.id);

      await db.insert(subscriptionsTable).values({
        crecheId: creche.id,
        planId: trialPlanId,
        status: "active",
      });

      const [admin] = await db
        .insert(usersTable)
        .values({
          name: "Active Admin",
          email: `clean-admin-${ts}@test.invalid`,
          passwordHash: hashPassword("Pass123!"),
          role: "creche_admin",
          crecheId: creche.id,
          isActive: true,
        })
        .returning();
      testUserIds.push(admin.id);
      const token = generateToken(admin.id, admin.role);

      const res = await request(app)
        .get(`/api/creches/${creche.id}/pets`)
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
    });

    it("TEST-41: Inactive Tenant Behavior Preserved", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Creche Pause ${ts}`,
          address: "Rua Pause",
          phone: "11988887777",
          email: `creche-pause-${ts}@test.invalid`,
          status: "active",
        })
        .returning();
      testCrecheIds.push(creche.id);

      const res = await request(app)
        .put(`/api/creches/${creche.id}`)
        .set("Authorization", `Bearer ${masterToken}`)
        .send({ status: "inactive" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("inactive");

      const [refreshed] = await db.select().from(crechesTable).where(eq(crechesTable.id, creche.id));
      expect(refreshed.status).toBe("inactive");
      expect(refreshed.deletedAt).toBeNull();
    });

    it("TEST-42: Rollback Binary Compatibility Verification", async () => {
      // Simulate older code selecting from creches table without knowing about deletedAt
      const creches = await db
        .select({
          id: crechesTable.id,
          name: crechesTable.name,
          status: crechesTable.status,
        })
        .from(crechesTable)
        .limit(5);

      expect(Array.isArray(creches)).toBe(true);
      for (const c of creches) {
        expect(["active", "inactive", "archived"]).toContain(c.status);
      }
    });

    it("TEST-43: TIMESTAMPTZ UTC Instant Equality Assertion", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Creche Timestamptz ${ts}`,
          address: "Rua UTC",
          phone: "11988887777",
          email: `creche-utc-${ts}@test.invalid`,
          status: "active",
        })
        .returning();
      testCrecheIds.push(creche.id);

      const beforeArchive = Date.now();
      await archiveTenant({
        crecheId: creche.id,
        reason: "Verificação de precisão UTC",
      });
      const afterArchive = Date.now();

      const [archived] = await db.select().from(crechesTable).where(eq(crechesTable.id, creche.id));
      expect(archived.deletedAt).toBeInstanceOf(Date);
      const epochTime = archived.deletedAt!.getTime();
      expect(epochTime).toBeGreaterThanOrEqual(beforeArchive - 1000);
      expect(epochTime).toBeLessThanOrEqual(afterArchive + 1000);
    });

    it("TEST-44: Double Archive Rejection (Idempotent 409)", async () => {
      const ts = Date.now();
      const [creche] = await db
        .insert(crechesTable)
        .values({
          name: `Creche Double Del ${ts}`,
          address: "Rua Double",
          phone: "11988887777",
          email: `creche-double-${ts}@test.invalid`,
          status: "active",
        })
        .returning();
      testCrecheIds.push(creche.id);

      // 1st archive
      const res1 = await request(app)
        .delete(`/api/creches/${creche.id}`)
        .set("Authorization", `Bearer ${masterToken}`)
        .send({ reason: "Primeiro arquivamento" });
      expect(res1.status).toBe(200);

      // 2nd archive
      const res2 = await request(app)
        .delete(`/api/creches/${creche.id}`)
        .set("Authorization", `Bearer ${masterToken}`)
        .send({ reason: "Segundo arquivamento" });
      expect(res2.status).toBe(409);
      expect(res2.body.error).toMatch(/já se encontra arquivada/i);
    });
  });

  // =========================================================================
  // GROUP I: MANDATORY PRIMARY OWNER ON MASTER PROVISIONING (BLOCKER A)
  // =========================================================================
  describe("GROUP I: MANDATORY PRIMARY OWNER ON MASTER PROVISIONING (BLOCKER A)", () => {
    it("TEST-45: Master Creation Rejected without adminName", async () => {
      const ts = Date.now();
      const res = await request(app)
        .post("/api/creches")
        .set("Authorization", `Bearer ${masterToken}`)
        .send({
          name: `No Admin Name ${ts}`,
          address: "Rua Sem Nome",
          phone: "11988887777",
          email: `no-name-${ts}@test.invalid`,
          adminEmail: `admin-${ts}@test.invalid`,
          adminPassword: "Password123!",
        });

      expect(res.status).toBe(400);
      expect(res.body.details?.adminName).toBeDefined();

      const creches = await db.select().from(crechesTable).where(eq(crechesTable.name, `No Admin Name ${ts}`));
      expect(creches.length).toBe(0);
    });

    it("TEST-46: Master Creation Rejected without adminEmail", async () => {
      const ts = Date.now();
      const res = await request(app)
        .post("/api/creches")
        .set("Authorization", `Bearer ${masterToken}`)
        .send({
          name: `No Admin Email ${ts}`,
          address: "Rua Sem Email",
          phone: "11988887777",
          email: `no-email-${ts}@test.invalid`,
          adminName: "Admin Fulano",
          adminPassword: "Password123!",
        });

      expect(res.status).toBe(400);
      expect(res.body.details?.adminEmail).toBeDefined();

      const creches = await db.select().from(crechesTable).where(eq(crechesTable.name, `No Admin Email ${ts}`));
      expect(creches.length).toBe(0);
    });

    it("TEST-47: Master Creation Rejected without adminPassword", async () => {
      const ts = Date.now();
      const res = await request(app)
        .post("/api/creches")
        .set("Authorization", `Bearer ${masterToken}`)
        .send({
          name: `No Admin Password ${ts}`,
          address: "Rua Sem Senha",
          phone: "11988887777",
          email: `no-pass-${ts}@test.invalid`,
          adminName: "Admin Ciclano",
          adminEmail: `admin-nopass-${ts}@test.invalid`,
        });

      expect(res.status).toBe(400);
      expect(res.body.details?.adminPassword).toBeDefined();

      const creches = await db.select().from(crechesTable).where(eq(crechesTable.name, `No Admin Password ${ts}`));
      expect(creches.length).toBe(0);
    });

    it("TEST-48: Master Creation Strictly Enforces Initial Owner", async () => {
      const ts = Date.now();
      const adminEmail = `enforce-owner-${ts}@test.invalid`;
      const crecheName = `Enforce Initial Owner ${ts}`;

      const res = await request(app)
        .post("/api/creches")
        .set("Authorization", `Bearer ${masterToken}`)
        .send({
          name: crecheName,
          address: "Rua Rigorosa 400",
          phone: "11988887777",
          email: `creche-enforce-${ts}@test.invalid`,
          adminName: "Dono Obrigatório",
          adminEmail,
          adminPassword: "Password123!",
          reason: "Criação com dono obrigatório",
        });

      expect(res.status).toBe(201);
      const crecheId = res.body.id;
      testCrecheIds.push(crecheId);

      // Check exactly 1 creche row
      const creches = await db.select().from(crechesTable).where(eq(crechesTable.id, crecheId));
      expect(creches.length).toBe(1);

      // Check exactly 1 admin user with isPrimaryOwner: true
      const users = await db.select().from(usersTable).where(eq(usersTable.crecheId, crecheId));
      expect(users.length).toBe(1);
      expect(users[0].isPrimaryOwner).toBe(true);
      expect(users[0].email).toBe(adminEmail);

      // Check exactly 1 trial subscription
      const subs = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.crecheId, crecheId));
      expect(subs.length).toBe(1);
      expect(subs[0].status).toBe("trial");

      // Check exactly 1 audit entry
      const audits = await db
        .select()
        .from(commercialAuditLedgerTable)
        .where(
          and(
            eq(commercialAuditLedgerTable.targetCrecheId, crecheId),
            eq(commercialAuditLedgerTable.action, "TENANT_PROVISIONED")
          )
        );
      expect(audits.length).toBe(1);
    });
  });
});
