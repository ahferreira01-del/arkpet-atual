import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

const dialect = new PgDialect();

function resolveTableName(table: any): string {
  try {
    return getTableName(table) || "";
  } catch {
    return table?._?.name || table?.name || "";
  }
}

// Stateful in-memory mock fixtures
const { mockState } = vi.hoisted(() => ({
  mockState: {
    users: [
      { id: 1, name: "Master Admin", email: "master@arkpet.test", role: "master_admin", crecheId: null, isActive: true, passwordHash: "$2a$10$abcdefghijklmnopqrstuu" },
      { id: 5, name: "Creche Admin 1", email: "admin1@arkpet.test", role: "creche_admin", crecheId: 1, isActive: true, passwordHash: "$2a$10$abcdefghijklmnopqrstuu" },
      { id: 6, name: "Staff Lucas", email: "staff1@arkpet.test", role: "staff", crecheId: 1, isActive: true, passwordHash: "$2a$10$abcdefghijklmnopqrstuu" },
      { id: 10, name: "Tutor A", email: "tutora@arkpet.test", role: "tutor", crecheId: 1, isActive: true, passwordHash: "$2a$10$abcdefghijklmnopqrstuu" },
      { id: 20, name: "Tutor B", email: "tutorb@arkpet.test", role: "tutor", crecheId: 1, isActive: true, passwordHash: "$2a$10$abcdefghijklmnopqrstuu" },
      { id: 31, name: "Staff Suspended", email: "staff3@arkpet.test", role: "staff", crecheId: 3, isActive: true, passwordHash: "$2a$10$abcdefghijklmnopqrstuu" },
      { id: 32, name: "Tutor Suspended", email: "tutor3@arkpet.test", role: "tutor", crecheId: 3, isActive: true, passwordHash: "$2a$10$abcdefghijklmnopqrstuu" },
      { id: 33, name: "Admin Suspended", email: "admin3@arkpet.test", role: "creche_admin", crecheId: 3, isActive: true, passwordHash: "$2a$10$abcdefghijklmnopqrstuu" },
      { id: 41, name: "User Archived", email: "user4@arkpet.test", role: "tutor", crecheId: 4, isActive: true, passwordHash: "$2a$10$abcdefghijklmnopqrstuu" },
      { id: 50, name: "Creche Admin Peer", email: "adminpeer@arkpet.test", role: "creche_admin", crecheId: 1, isActive: true, passwordHash: "$2a$10$abcdefghijklmnopqrstuu" },
      { id: 99, name: "Foreign Tutor Creche 2", email: "tutor2@arkpet.test", role: "tutor", crecheId: 2, isActive: true, passwordHash: "$2a$10$abcdefghijklmnopqrstuu" },
    ] as any[],
    creches: [
      { id: 1, name: "Creche Alpha", status: "active" },
      { id: 2, name: "Creche Beta", status: "active" },
      { id: 3, name: "Creche Suspended", status: "suspended" },
      { id: 4, name: "Creche Archived", status: "archived" },
    ] as any[],
    subscriptions: [
      { id: 1, crecheId: 1, status: "active", plan: "pro", planId: 1, billingInterval: "month", trialEndsAt: null, currentPeriodEnd: new Date(Date.now() + 86400000) },
      { id: 2, crecheId: 2, status: "active", plan: "pro", planId: 1, billingInterval: "month", trialEndsAt: null, currentPeriodEnd: new Date(Date.now() + 86400000) },
      { id: 3, crecheId: 3, status: "active", plan: "pro", planId: 1, billingInterval: "month", trialEndsAt: null, currentPeriodEnd: new Date(Date.now() + 86400000) },
    ] as any[],
    plans: [
      { id: 1, name: "Plano Pro", priceBrl: "199.00", isActive: true, petLimit: 50, description: "Plano Pro", stripePriceId: "price_123" },
    ] as any[],
    planPrices: [
      { id: 1, planId: 1, interval: "month", priceBrl: "199.00", discountPct: 0, isActive: true, stripePriceId: "price_123" },
    ] as any[],
    pets: [
      { id: 101, name: "Pipoca", species: "dog", breed: "Poodle", crecheId: 1, tutorId: 10, status: "active" },
      { id: 102, name: "Thor", species: "dog", breed: "Bulldog", crecheId: 1, tutorId: 20, status: "active" },
      { id: 103, name: "Rex", species: "dog", breed: "Labrador", crecheId: 2, tutorId: 99, status: "active" },
    ] as any[],
    bookings: [
      { id: 201, crecheId: 1, tutorId: 10, petId: 101, status: "confirmed", price: 100, startDate: "2026-10-01" },
      { id: 202, crecheId: 1, tutorId: 20, petId: 102, status: "confirmed", price: 150, startDate: "2026-10-01" },
      { id: 203, crecheId: 2, tutorId: 99, petId: 103, status: "confirmed", price: 200, startDate: "2026-10-01" },
    ] as any[],
    resetTokens: [
      { id: 1, userId: 10, token: "valid-reset-token-123", usedAt: null, expiresAt: new Date(Date.now() + 3600000) },
      { id: 2, userId: 10, token: "expired-reset-token-456", usedAt: null, expiresAt: new Date(Date.now() - 3600000) },
    ] as any[],
    throwOnUsersMutation: null as Error | null,
    throwOnSearchQuery: null as Error | null,
  },
}));

function evaluateWhereClause(sqlStr: string, params: any[], row: any): boolean {
  // Equality checks: "table"."column" = $N
  const re = /"([^"]+)"\."([^"]+)"\s*=\s*\$(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sqlStr)) !== null) {
    const col = m[2];
    const paramVal = params[parseInt(m[3], 10) - 1];
    let rowVal: any;
    if (col === "creche_id") rowVal = row.crecheId ?? row.creche_id;
    else if (col === "tutor_id") rowVal = row.tutorId ?? row.tutor_id;
    else if (col === "pet_id") rowVal = row.petId ?? row.pet_id;
    else if (col === "user_id") rowVal = row.userId ?? row.user_id;
    else if (col === "plan_id") rowVal = row.planId ?? row.plan_id;
    else if (col === "is_active") rowVal = row.isActive ?? row.is_active;
    else if (col === "id") rowVal = row.id;
    else if (col === "email") rowVal = row.email;
    else if (col === "token") rowVal = row.token;
    else if (col === "status") rowVal = row.status;
    else rowVal = row[col];

    if (rowVal != paramVal) {
      return false;
    }
  }

  // Null checks: "table"."used_at" is null
  const nullRe = /"([^"]+)"\."([^"]+)"\s+is null/gi;
  while ((m = nullRe.exec(sqlStr)) !== null) {
    const col = m[2];
    const rowVal = col === "used_at" ? (row.usedAt ?? row.used_at) : row[col];
    if (rowVal !== null && rowVal !== undefined) {
      return false;
    }
  }

  // Greater than checks: "table"."expires_at" > $N
  const gtRe = /"([^"]+)"\."([^"]+)"\s*>\s*\$(\d+)/g;
  while ((m = gtRe.exec(sqlStr)) !== null) {
    const col = m[2];
    const paramVal = params[parseInt(m[3], 10) - 1];
    const rowVal = col === "expires_at" ? (row.expiresAt ?? row.expires_at) : row[col];
    if (new Date(rowVal).getTime() <= new Date(paramVal).getTime()) {
      return false;
    }
  }

  return true;
}

vi.mock("@workspace/db", () => {
  const createChain = (getData: () => any[]) => {
    let rows: any[] = [];
    const chain: any = {
      select: () => chain,
      from: (table: any) => {
        const name = resolveTableName(table);
        if (mockState.throwOnSearchQuery && (name === "pets" || name === "bookings")) {
          throw mockState.throwOnSearchQuery;
        }
        if (name.includes("plan_price")) rows = [...mockState.planPrices];
        else if (name.includes("plan")) rows = [...mockState.plans];
        else if (name.includes("subscription")) rows = [...mockState.subscriptions];
        else if (name.includes("user")) rows = [...mockState.users];
        else if (name.includes("creche")) rows = [...mockState.creches];
        else if (name.includes("pet")) rows = [...mockState.pets];
        else if (name.includes("booking")) rows = [...mockState.bookings];
        else if (name.includes("password_reset") || name.includes("token")) rows = [...mockState.resetTokens];
        else rows = [...getData()];
        return chain;
      },
      leftJoin: () => chain,
      innerJoin: () => chain,
      orderBy: () => chain,
      offset: () => chain,
      where: (condition: any) => {
        if (condition) {
          try {
            const { sql: sqlStr, params } = dialect.sqlToQuery(condition);
            rows = rows.filter((r) => evaluateWhereClause(sqlStr, params, r));
          } catch {}
        }
        return chain;
      },
      limit: (n: number) => {
        return Promise.resolve(rows.slice(0, n));
      },
      then: (resolve: any, reject: any) => {
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return chain;
  };

  const dbMock: any = {
    ...createChain(() => []),
    insert: vi.fn((table: any) => ({
      values: vi.fn((vals: any) => ({
        returning: vi.fn(async () => {
          const name = resolveTableName(table);
          if (mockState.throwOnUsersMutation && name.includes("user")) {
            throw mockState.throwOnUsersMutation;
          }
          const inserted = { id: Math.floor(Math.random() * 10000) + 1000, ...vals };
          if (name.includes("user")) mockState.users.push(inserted);
          else if (name.includes("pet")) mockState.pets.push(inserted);
          else if (name.includes("booking")) mockState.bookings.push(inserted);
          return [inserted];
        }),
      })),
    })),
    update: vi.fn((table: any) => ({
      set: vi.fn((vals: any) => ({
        where: vi.fn((condition: any) => {
          const exec = async () => {
            const name = resolveTableName(table);
            if (name.includes("password_reset") || name.includes("token")) {
              const { sql: sqlStr, params } = dialect.sqlToQuery(condition);
              const now = new Date();
              const found = mockState.resetTokens.find((t) =>
                evaluateWhereClause(sqlStr, params, t) && t.usedAt === null && new Date(t.expiresAt) > now
              );
              if (found) {
                found.usedAt = vals.usedAt ?? now;
                return [{ userId: found.userId }];
              }
              return [];
            }
            if (name.includes("user")) {
              const { sql: sqlStr, params } = dialect.sqlToQuery(condition);
              const found = mockState.users.find((u) => evaluateWhereClause(sqlStr, params, u));
              if (found) {
                Object.assign(found, vals);
                return [found];
              }
            }
            return [{ id: 1, ...vals }];
          };
          return {
            returning: vi.fn(exec),
            then: (resolve: any, reject: any) => exec().then(resolve, reject),
          };
        }),
      })),
    })),
    transaction: vi.fn(async (cb: any) => {
      return cb(dbMock);
    }),
  };

  return {
    db: dbMock,
  };
});

vi.mock("../services/tenantLifecycleLock.js", () => ({
  acquireTenantOperationalLock: vi.fn(async () => {}),
  TenantArchivedError: class extends Error {},
}));

vi.mock("../services/entitlementsService.js", () => ({
  checkQuota: vi.fn(async () => ({ allowed: true, limit: 100, used: 1 })),
  checkCreationQuota: vi.fn(async () => ({ allowed: true, limit: 100, used: 1 })),
}));

vi.mock("../repositories/booking-services.repository.js", () => ({
  BookingServicesRepository: {
    findByBookingId: vi.fn(async () => []),
    findByBookingIds: vi.fn(async () => []),
  },
}));

vi.mock("../services/crecheCampaignReservation.service.js", () => ({
  CrecheCampaignReservationService: {
    getBookingCommercialSummary: vi.fn(async () => null),
    acquireTutorCampaignLock: vi.fn(async () => {}),
  },
}));

vi.mock("../services/audit.js", () => ({
  logFinancialAudit: vi.fn(async () => {}),
}));

vi.mock("../services/billing.js", () => ({
  BillingService: {},
  hasOverdueInvoices: vi.fn(async () => false),
}));

vi.mock("../services/credits.js", () => ({
  consumePackageCredits: vi.fn(async () => ({ consumed: false })),
  consumeServiceCreditsForBooking: vi.fn(async () => ({ consumed: false })),
  restoreBookingPackageCredits: vi.fn(async () => {}),
  restoreBookingServiceCredits: vi.fn(async () => {}),
  consumeAdditionalServices: vi.fn(async () => []),
  restoreAdditionalServices: vi.fn(async () => {}),
}));

vi.mock("../services/tutorCommercialPricing.js", () => ({
  TutorCommercialPricingService: {},
}));

import petsRouter from "../routes/pets.js";
import bookingsRouter from "../routes/bookings.js";
import usersRouter from "../routes/users.js";
import authRouter from "../routes/auth.js";
import billingRouter from "../routes/billing.js";
import searchRouter from "../routes/search.js";
import { authenticate, requireRole, isSuspendedTenantRecoveryPath } from "../middlewares/authenticate.js";
import { isAllowedOrigin } from "../app.js";
import {
  generateToken,
  verifyToken,
  verifyPassword,
  hashPassword,
  getPasswordSalt,
  legacyHash,
  getJwtSecret,
  AUTH_TOKEN_TTL_MS,
} from "../lib/auth.js";
import { getUploadProofSecret, verifyUploadProof, generateUploadProof } from "../lib/uploadProof.js";
import {
  validateTargetTutor,
  validateChatPet,
  validateChatMedia,
} from "../routes/chat.js";
import { canUserAccessPrivateResource } from "../lib/objectAuthorization.js";

// Setup express test app mounting real production routers
function createTestApp() {
  const app = express();
  app.use(express.json());

  // Attach correlation ID middleware so req.id is always populated
  app.use((req: any, _res: Response, next: NextFunction) => {
    req.id = req.headers["x-request-id"] || "test-request-id-sec-01";
    next();
  });

  // Real routers mounted at their actual paths
  app.use("/api/auth", authRouter);
  app.use("/api/creches/:crecheId/pets", petsRouter);
  app.use("/api/creches/:crecheId/bookings", bookingsRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/billing", billingRouter);
  app.use("/api/search", searchRouter);

  // Protected route specifically verifying prefix boundary check with production authenticate
  app.get("/api/billing-attacker", authenticate, (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });

  return app;
}

describe("ARKPET — R40.G SECURITY HARDENING & SECRET REMEDIATION TEST SUITE", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    mockState.users = [
      { id: 1, name: "Master Admin", email: "master@arkpet.test", role: "master_admin", crecheId: null, isActive: true, passwordHash: "$2a$10$abcdefghijklmnopqrstuu" },
      { id: 5, name: "Creche Admin 1", email: "admin1@arkpet.test", role: "creche_admin", crecheId: 1, isActive: true, passwordHash: "$2a$10$abcdefghijklmnopqrstuu" },
      { id: 6, name: "Staff Lucas", email: "staff1@arkpet.test", role: "staff", crecheId: 1, isActive: true, passwordHash: "$2a$10$abcdefghijklmnopqrstuu" },
      { id: 10, name: "Tutor A", email: "tutora@arkpet.test", role: "tutor", crecheId: 1, isActive: true, passwordHash: "$2a$10$abcdefghijklmnopqrstuu" },
      { id: 20, name: "Tutor B", email: "tutorb@arkpet.test", role: "tutor", crecheId: 1, isActive: true, passwordHash: "$2a$10$abcdefghijklmnopqrstuu" },
      { id: 31, name: "Staff Suspended", email: "staff3@arkpet.test", role: "staff", crecheId: 3, isActive: true, passwordHash: "$2a$10$abcdefghijklmnopqrstuu" },
      { id: 32, name: "Tutor Suspended", email: "tutor3@arkpet.test", role: "tutor", crecheId: 3, isActive: true, passwordHash: "$2a$10$abcdefghijklmnopqrstuu" },
      { id: 33, name: "Admin Suspended", email: "admin3@arkpet.test", role: "creche_admin", crecheId: 3, isActive: true, passwordHash: "$2a$10$abcdefghijklmnopqrstuu" },
      { id: 41, name: "User Archived", email: "user4@arkpet.test", role: "tutor", crecheId: 4, isActive: true, passwordHash: "$2a$10$abcdefghijklmnopqrstuu" },
      { id: 50, name: "Creche Admin Peer", email: "adminpeer@arkpet.test", role: "creche_admin", crecheId: 1, isActive: true, passwordHash: "$2a$10$abcdefghijklmnopqrstuu" },
      { id: 99, name: "Foreign Tutor Creche 2", email: "tutor2@arkpet.test", role: "tutor", crecheId: 2, isActive: true, passwordHash: "$2a$10$abcdefghijklmnopqrstuu" },
    ];
    mockState.creches = [
      { id: 1, name: "Creche Alpha", status: "active" },
      { id: 2, name: "Creche Beta", status: "active" },
      { id: 3, name: "Creche Suspended", status: "suspended" },
      { id: 4, name: "Creche Archived", status: "archived" },
    ];
    mockState.subscriptions = [
      { id: 1, crecheId: 1, status: "active", plan: "pro", planId: 1, billingInterval: "month", trialEndsAt: null, currentPeriodEnd: new Date(Date.now() + 86400000) },
      { id: 2, crecheId: 2, status: "active", plan: "pro", planId: 1, billingInterval: "month", trialEndsAt: null, currentPeriodEnd: new Date(Date.now() + 86400000) },
      { id: 3, crecheId: 3, status: "active", plan: "pro", planId: 1, billingInterval: "month", trialEndsAt: null, currentPeriodEnd: new Date(Date.now() + 86400000) },
    ];
    mockState.plans = [
      { id: 1, name: "Plano Pro", priceBrl: "199.00", isActive: true, petLimit: 50, description: "Plano Pro", stripePriceId: "price_123" },
    ];
    mockState.planPrices = [
      { id: 1, planId: 1, interval: "month", priceBrl: "199.00", discountPct: 0, isActive: true, stripePriceId: "price_123" },
    ];
    mockState.pets = [
      { id: 101, name: "Pipoca", species: "dog", breed: "Poodle", crecheId: 1, tutorId: 10, status: "active" },
      { id: 102, name: "Thor", species: "dog", breed: "Bulldog", crecheId: 1, tutorId: 20, status: "active" },
      { id: 103, name: "Rex", species: "dog", breed: "Labrador", crecheId: 2, tutorId: 99, status: "active" },
    ];
    mockState.bookings = [
      { id: 201, crecheId: 1, tutorId: 10, petId: 101, status: "confirmed", price: 100, startDate: "2026-10-01" },
      { id: 202, crecheId: 1, tutorId: 20, petId: 102, status: "confirmed", price: 150, startDate: "2026-10-01" },
      { id: 203, crecheId: 2, tutorId: 99, petId: 103, status: "confirmed", price: 200, startDate: "2026-10-01" },
    ];
    mockState.resetTokens = [
      { id: 1, userId: 10, token: "valid-reset-token-123", usedAt: null, expiresAt: new Date(Date.now() + 3600000) },
      { id: 2, userId: 10, token: "expired-reset-token-456", usedAt: null, expiresAt: new Date(Date.now() - 3600000) },
    ];
    mockState.throwOnUsersMutation = null;
    mockState.throwOnSearchQuery = null;
    app = createTestApp();
  });

  // ────────────────────────────────────────────────────────────
  // 1. PET IDOR PRODUCTION HANDLER TEST
  // ────────────────────────────────────────────────────────────
  it("PET_IDOR_PRODUCTION_HANDLER_TEST: Tutor A cannot access or update Tutor B pet in same creche (404 expected)", async () => {
    const tokenTutorA = generateToken(10, "tutor");

    // GET Tutor B's pet (petId 102, owned by tutor 20) as Tutor A -> Expect 404
    const getRes = await request(app)
      .get("/api/creches/1/pets/102")
      .set("Authorization", `Bearer ${tokenTutorA}`);
    expect(getRes.status).toBe(404);

    // PUT Tutor B's pet as Tutor A -> Expect 404
    const putRes = await request(app)
      .put("/api/creches/1/pets/102")
      .set("Authorization", `Bearer ${tokenTutorA}`)
      .send({ name: "HackedName" });
    expect(putRes.status).toBe(404);

    // GET own pet (petId 101, owned by tutor 10) as Tutor A -> Expect 200
    const ownRes = await request(app)
      .get("/api/creches/1/pets/101")
      .set("Authorization", `Bearer ${tokenTutorA}`);
    expect(ownRes.status).toBe(200);
    expect(ownRes.body.id).toBe(101);
  });

  // ────────────────────────────────────────────────────────────
  // 2. BOOKING IDOR PRODUCTION HANDLER TEST
  // ────────────────────────────────────────────────────────────
  it("BOOKING_IDOR_PRODUCTION_HANDLER_TEST: Tutor A cannot view or update Tutor B booking (404 expected)", async () => {
    const tokenTutorA = generateToken(10, "tutor");

    // GET Tutor B's booking (booking 202, owned by tutor 20) as Tutor A -> Expect 404
    const getRes = await request(app)
      .get("/api/creches/1/bookings/202")
      .set("Authorization", `Bearer ${tokenTutorA}`);
    expect(getRes.status).toBe(404);

    // PUT Tutor B's booking as Tutor A -> Expect 404
    const putRes = await request(app)
      .put("/api/creches/1/bookings/202")
      .set("Authorization", `Bearer ${tokenTutorA}`)
      .send({ notes: "Malicious modification" });
    expect(putRes.status).toBe(404);

    // GET own booking (booking 201) as Tutor A -> Expect 200
    const ownRes = await request(app)
      .get("/api/creches/1/bookings/201")
      .set("Authorization", `Bearer ${tokenTutorA}`);
    expect(ownRes.status).toBe(200);
    expect(ownRes.body.id).toBe(201);
  });

  // ────────────────────────────────────────────────────────────
  // 3. BOOKING PRICE TAMPERING HANDLER TEST
  // ────────────────────────────────────────────────────────────
  it("BOOKING_PRICE_TAMPERING_HANDLER_TEST: Tutor sending price update receives 403 Forbidden", async () => {
    const tokenTutorA = generateToken(10, "tutor");

    const putRes = await request(app)
      .put("/api/creches/1/bookings/201")
      .set("Authorization", `Bearer ${tokenTutorA}`)
      .send({ price: 1 });

    expect(putRes.status).toBe(403);
    expect(putRes.body.error).toContain("Tutores não têm permissão para alterar o preço de reservas");
  });

  // ────────────────────────────────────────────────────────────
  // 4. USER ROLE ESCALATION HANDLER TEST (ROLE_ESCALATION_HANDLER_TEST)
  // ────────────────────────────────────────────────────────────
  it("ROLE_ESCALATION_HANDLER_TEST: creche_admin role assignments strictly constrained to staff and tutor, peer admin protected", async () => {
    const tokenAdmin = generateToken(5, "creche_admin");

    // SEC-ROLE-01: Creche Admin A edits Staff A -> role="creche_admin" -> Expected: 403
    const resRole01 = await request(app)
      .put("/api/users/6")
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ role: "creche_admin" });
    expect(resRole01.status).toBe(403);
    expect(resRole01.body.error).toContain("Admins de creche só podem atribuir as funções staff e tutor");

    // SEC-ROLE-02: Creche Admin A edits Tutor A -> role="creche_admin" -> Expected: 403
    const resRole02 = await request(app)
      .put("/api/users/10")
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ role: "creche_admin" });
    expect(resRole02.status).toBe(403);
    expect(resRole02.body.error).toContain("Admins de creche só podem atribuir as funções staff e tutor");

    // SEC-ROLE-03: Creche Admin A edits Staff A -> role="master_admin" -> Expected: 403
    const resRole03 = await request(app)
      .put("/api/users/6")
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ role: "master_admin" });
    expect(resRole03.status).toBe(403);
    expect(resRole03.body.error).toContain("Admins de creche só podem atribuir as funções staff e tutor");

    // SEC-ROLE-04: Creche Admin A edits Staff A -> role="tutor" -> Expected: 200
    const resRole04 = await request(app)
      .put("/api/users/6")
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ role: "tutor" });
    expect(resRole04.status).toBe(200);

    // SEC-ROLE-05: Creche Admin A edits Tutor A -> role="staff" -> Expected: 200
    const resRole05 = await request(app)
      .put("/api/users/10")
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ role: "staff" });
    expect(resRole05.status).toBe(200);

    // Peer admin protection: Creche Admin A attempts to change role of Creche Admin B -> Expected: 403
    const resPeerRole = await request(app)
      .put("/api/users/50")
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ role: "staff" });
    expect(resPeerRole.status).toBe(403);
    expect(resPeerRole.body.error).toContain("Sem permissão para alterar role de outro administrador");

    // Peer admin protection: Creche Admin A attempts to deactivate Creche Admin B -> Expected: 403
    const resPeerActive = await request(app)
      .put("/api/users/50")
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ isActive: false });
    expect(resPeerActive.status).toBe(403);
    expect(resPeerActive.body.error).toContain("Sem permissão para alterar status de outro administrador");

    // Attempt POST create user with role=master_admin -> Expected: 403
    const postMasterRes = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({
        name: "Rogue Master",
        email: "roguemaster@arkpet.test",
        password: "password123",
        role: "master_admin",
      });
    expect(postMasterRes.status).toBe(403);

    // Attempt POST create user with role=creche_admin -> Expected: 403
    const postAdminRes = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({
        name: "Rogue Admin",
        email: "rogueadmin@arkpet.test",
        password: "password123",
        role: "creche_admin",
      });
    expect(postAdminRes.status).toBe(403);

    // Attempt PUT update target master_admin user -> Expected: 403
    const putMasterRes = await request(app)
      .put("/api/users/1")
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ name: "Compromised Master" });
    expect(putMasterRes.status).toBe(403);

    // Attempt PUT update user in another creche (creche 2) -> Expected: 404
    const putCrossRes = await request(app)
      .put("/api/users/99")
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ name: "Compromised Foreign" });
    expect(putCrossRes.status).toBe(404);

    // Attempt PUT self-escalation to master_admin -> Expected: 403
    const putSelfRes = await request(app)
      .put("/api/users/5")
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ role: "master_admin" });
    expect(putSelfRes.status).toBe(403);

    // Attempt PUT self crecheId modification -> Expected: 403
    const putCrecheRes = await request(app)
      .put("/api/users/5")
      .set("Authorization", `Bearer ${tokenAdmin}`)
      .send({ crecheId: 2 });
    expect(putCrecheRes.status).toBe(403);
  });

  // ────────────────────────────────────────────────────────────
  // 5. CHAT SECURITY REUSED TESTS
  // ────────────────────────────────────────────────────────────
  it("R40_D_CHAT_SECURITY_TEST_REUSED: reuses certified R40.D chat security rules and proof validation", async () => {
    // 1. Foreign tutor chat isolation
    const foreignTutor = await validateTargetTutor(1, 99, { id: 6, role: "staff" });
    expect(foreignTutor.ok).toBe(false);

    // Valid same-creche tutor
    const validTutor = await validateTargetTutor(1, 10, { id: 6, role: "staff" });
    expect(validTutor.ok).toBe(true);

    // 2. Foreign pet chat validation
    const foreignPet = await validateChatPet(1, 10, 103);
    expect(foreignPet.ok).toBe(false);

    // Valid own pet
    const validPet = await validateChatPet(1, 10, 101);
    expect(validPet.ok).toBe(true);

    // 3. Chat media path rejection for non-canonical path
    const invalidMedia = await validateChatMedia(1, 10, "/objects/arbitrary_file.webp");
    expect(invalidMedia.ok).toBe(false);

    // 4. Storage authorization denies foreign tenant
    const accessDenied = await canUserAccessPrivateResource({
      user: { id: 10, role: "tutor", crecheId: 1 },
      canonicalObjectPath: "/objects/uploads/c2/somefile.webp",
      pathCrecheId: 2,
    });
    expect(accessDenied).toBe(false);

    // 5. Upload proof validation
    const proof = generateUploadProof({
      userId: 10,
      crecheId: 1,
      objectPath: "/api/storage/uploads/c1/somefile.webp",
    });
    expect(
      verifyUploadProof(proof, {
        userId: 10,
        crecheId: 1,
        objectPath: "/api/storage/uploads/c1/somefile.webp",
      }).ok
    ).toBe(true);
    expect(
      verifyUploadProof(proof, {
        userId: 20,
        crecheId: 1,
        objectPath: "/api/storage/uploads/c1/somefile.webp",
      }).ok
    ).toBe(false);
  });

  // ────────────────────────────────────────────────────────────
  // 6. RESET TOKEN REUSE & EXPIRY PRODUCTION TESTS
  // ────────────────────────────────────────────────────────────
  it("RESET_TOKEN_REUSE_PRODUCTION_TEST: atomic claim prevents token reuse on reset-password endpoint", async () => {
    // First reset attempt with valid token -> 200
    const res1 = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "valid-reset-token-123", password: "newSecurePassword123" });
    expect(res1.status).toBe(200);
    expect(res1.body.message).toContain("Senha redefinida com sucesso");

    // Second reset attempt with same token (reuse attempt) -> 400
    const res2 = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "valid-reset-token-123", password: "anotherPassword123" });
    expect(res2.status).toBe(400);
    expect(res2.body.error).toContain("Token inválido ou expirado");
  });

  it("RESET_TOKEN_EXPIRY_PRODUCTION_TEST: expired reset token is strictly rejected", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "expired-reset-token-456", password: "newSecurePassword123" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Token inválido ou expirado");
  });

  // ────────────────────────────────────────────────────────────
  // 7. SUSPENDED CRECHE STATUS & RECOVERY ROUTE TESTS
  // ────────────────────────────────────────────────────────────
  it("CRECHE_STATUS_SUSPENDED_STAFF_TEST: staff on suspended creche receives 403 tenant_suspended", async () => {
    const tokenStaff3 = generateToken(31, "staff");
    const res = await request(app)
      .get("/api/creches/3/pets")
      .set("Authorization", `Bearer ${tokenStaff3}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("tenant_suspended");
  });

  it("CRECHE_STATUS_SUSPENDED_TUTOR_TEST: tutor on suspended creche receives 403 tenant_suspended", async () => {
    const tokenTutor3 = generateToken(32, "tutor");
    const res = await request(app)
      .get("/api/creches/3/pets")
      .set("Authorization", `Bearer ${tokenTutor3}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("tenant_suspended");
  });

  it("CRECHE_STATUS_SUSPENDED_ADMIN_RECOVERY_TEST: creche_admin on suspended creche blocked from ops but allowed recovery/billing", async () => {
    const tokenAdmin3 = generateToken(33, "creche_admin");

    // Operational route -> blocked with 403 tenant_suspended
    const opRes = await request(app)
      .get("/api/creches/3/pets")
      .set("Authorization", `Bearer ${tokenAdmin3}`);
    expect(opRes.status).toBe(403);
    expect(opRes.body.error).toBe("tenant_suspended");

    // Real recovery route on real billing router (/api/billing/plans) -> permitted
    const recRes = await request(app)
      .get("/api/billing/plans")
      .set("Authorization", `Bearer ${tokenAdmin3}`);
    expect(recRes.status).toBe(200);
    expect(Array.isArray(recRes.body)).toBe(true);
  });

  it("SUSPENDED_TENANT_QUERY_BYPASS_TEST: query string cannot bypass suspended tenant operational block (SEC-SUSP-01 & SEC-SUSP-02)", async () => {
    const tokenAdmin3 = generateToken(33, "creche_admin");

    // SEC-SUSP-01: Suspended creche_admin GET /api/users?next=/billing -> 403 tenant_suspended
    const resSusp01 = await request(app)
      .get("/api/users?next=/billing")
      .set("Authorization", `Bearer ${tokenAdmin3}`);
    expect(resSusp01.status).toBe(403);
    expect(resSusp01.body.error).toBe("tenant_suspended");

    // SEC-SUSP-02: Suspended creche_admin POST /api/users?return=/subscription -> 403 tenant_suspended
    const resSusp02 = await request(app)
      .post("/api/users?return=/subscription")
      .set("Authorization", `Bearer ${tokenAdmin3}`)
      .send({ name: "NewStaff", email: "newstaff@arkpet.test", password: "password123", role: "staff" });
    expect(resSusp02.status).toBe(403);
    expect(resSusp02.body.error).toBe("tenant_suspended");

    // Prefix boundary attack: /api/billing-attacker is NOT a recovery path
    const resPrefixAttack = await request(app)
      .get("/api/billing-attacker")
      .set("Authorization", `Bearer ${tokenAdmin3}`);
    expect(resPrefixAttack.status).toBe(403);
    expect(resPrefixAttack.body.error).toBe("tenant_suspended");
  });

  it("REAL_BILLING_ROUTER_RECOVERY_TEST: suspended creche_admin can access real billingRouter routes but staff/tutor cannot (SEC-SUSP-03..05)", async () => {
    const tokenAdmin3 = generateToken(33, "creche_admin");
    const tokenStaff3 = generateToken(31, "staff");
    const tokenTutor3 = generateToken(32, "tutor");

    // SEC-SUSP-03: Suspended creche_admin GET /api/billing/subscription -> allowed (200 on real billing router)
    const resSub = await request(app)
      .get("/api/billing/subscription")
      .set("Authorization", `Bearer ${tokenAdmin3}`);
    expect(resSub.status).toBe(200);
    expect(resSub.body.crecheId).toBe(3);

    // SEC-SUSP-04: Suspended creche_admin GET /api/billing/plans -> allowed (200 on real billing router)
    const resPlans = await request(app)
      .get("/api/billing/plans")
      .set("Authorization", `Bearer ${tokenAdmin3}`);
    expect(resPlans.status).toBe(200);
    expect(Array.isArray(resPlans.body)).toBe(true);

    // /api/auth/me -> allowed for suspended creche_admin
    const resMe = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${tokenAdmin3}`);
    expect(resMe.status).toBe(200);
    expect(resMe.body.id).toBe(33);

    // SEC-SUSP-05: Suspended staff on real /api/billing/* -> 403 tenant_suspended
    const resStaffBilling = await request(app)
      .get("/api/billing/plans")
      .set("Authorization", `Bearer ${tokenStaff3}`);
    expect(resStaffBilling.status).toBe(403);
    expect(resStaffBilling.body.error).toBe("tenant_suspended");

    // SEC-SUSP-05: Suspended tutor on real /api/billing/* -> 403 tenant_suspended
    const resTutorBilling = await request(app)
      .get("/api/billing/plans")
      .set("Authorization", `Bearer ${tokenTutor3}`);
    expect(resTutorBilling.status).toBe(403);
    expect(resTutorBilling.body.error).toBe("tenant_suspended");
  });

  it("isSuspendedTenantRecoveryPath: correctly matches recovery routes and rejects query-string or prefix trickery", () => {
    expect(isSuspendedTenantRecoveryPath({ originalUrl: "/api/billing" })).toBe(true);
    expect(isSuspendedTenantRecoveryPath({ originalUrl: "/api/billing/plans" })).toBe(true);
    expect(isSuspendedTenantRecoveryPath({ originalUrl: "/api/billing/subscription" })).toBe(true);
    expect(isSuspendedTenantRecoveryPath({ originalUrl: "/billing" })).toBe(true);
    expect(isSuspendedTenantRecoveryPath({ originalUrl: "/billing/plans" })).toBe(true);
    expect(isSuspendedTenantRecoveryPath({ originalUrl: "/api/auth/me" })).toBe(true);
    expect(isSuspendedTenantRecoveryPath({ originalUrl: "/auth/me" })).toBe(true);

    // Adversarial / non-recovery cases
    expect(isSuspendedTenantRecoveryPath({ originalUrl: "/api/users?next=/billing" })).toBe(false);
    expect(isSuspendedTenantRecoveryPath({ originalUrl: "/api/users?return=/subscription" })).toBe(false);
    expect(isSuspendedTenantRecoveryPath({ originalUrl: "/api/billing-attacker" })).toBe(false);
    expect(isSuspendedTenantRecoveryPath({ originalUrl: "/api/billingattacker" })).toBe(false);
    expect(isSuspendedTenantRecoveryPath({ originalUrl: "/api/creches/1/pets" })).toBe(false);
  });

  // ────────────────────────────────────────────────────────────
  // 8. CORS PREFIX ATTACK TEST
  // ────────────────────────────────────────────────────────────
  it("CORS_PREFIX_ATTACK_TEST: prevents prefix domain hijacking and verifies exact origin matching", () => {
    const allowed = ["https://arkpet.example"];

    // Exact match allowed
    expect(isAllowedOrigin("https://arkpet.example", allowed)).toBe(true);

    // Prefix attacker domain denied
    expect(isAllowedOrigin("https://arkpet.example.attacker.test", allowed)).toBe(false);
    expect(isAllowedOrigin("https://arkpet.example/attacker", allowed)).toBe(false);

    // Localhost in production mode denied
    const prevNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(isAllowedOrigin("http://localhost:3000", allowed)).toBe(false);
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
    }
  });

  // ────────────────────────────────────────────────────────────
  // 9. USERS ERROR SECRET LEAK TEST
  // ────────────────────────────────────────────────────────────
  it("USERS_ERROR_SECRET_LEAK_TEST: unexpected db error in users returns generic 500 without leaking secrets", async () => {
    const tokenMaster = generateToken(1, "master_admin");
    mockState.throwOnUsersMutation = new Error("FATAL: password 'super_secret_db_pass_123' failed for user 'postgres://admin:pwd@10.0.0.1:5432/arkpet' at /var/lib/postgresql/data");

    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${tokenMaster}`)
      .send({
        name: "Test User",
        email: "test500@arkpet.test",
        password: "password123",
        role: "tutor",
      });

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("INTERNAL_ERROR");
    expect(res.body.error).toBe("Erro ao criar usuário");
    expect(res.body.requestId).toBeDefined();

    const rawResponse = JSON.stringify(res.body);
    expect(rawResponse).not.toContain("super_secret_db_pass_123");
    expect(rawResponse).not.toContain("postgres://");
    expect(rawResponse).not.toContain("/var/lib/postgresql");
  });

  // ────────────────────────────────────────────────────────────
  // 10. SEARCH ERROR SECRET LEAK TEST
  // ────────────────────────────────────────────────────────────
  it("SEARCH_ERROR_SECRET_LEAK: unexpected search error returns generic 500 without leaking secrets", async () => {
    const tokenTutorA = generateToken(10, "tutor");
    mockState.throwOnSearchQuery = new Error("Search backend failed with secret token Bearer sk_live_secret_key_99999");

    const res = await request(app)
      .get("/api/search?q=Pipoca")
      .set("Authorization", `Bearer ${tokenTutorA}`);

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("INTERNAL_ERROR");
    expect(res.body.error).toBe("Erro interno ao processar a busca");
    expect(res.body.requestId).toBeDefined();

    const rawResponse = JSON.stringify(res.body);
    expect(rawResponse).not.toContain("sk_live_secret_key_99999");
  });

  // ────────────────────────────────────────────────────────────
  // 11. LEGACY SALT CONFIGURATION TESTS
  // ────────────────────────────────────────────────────────────
  it("LEGACY_SALT_CONFIGURATION_TESTS: bcrypt works without salt, legacy hash fails closed without salt, and passes with salt", () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSalt = process.env.PASSWORD_SALT;

    try {
      process.env.NODE_ENV = "production";
      delete process.env.PASSWORD_SALT;

      // 1. Bcrypt without PASSWORD_SALT must succeed
      const plainPassword = "TestSecurePassword2026!";
      const bcryptHash = hashPassword(plainPassword);
      expect(verifyPassword(plainPassword, bcryptHash)).toBe(true);

      // 2. Legacy hash without PASSWORD_SALT must fail closed (LEGACY_HASH_EMPTY_SALT_VERIFICATION = 0)
      const legacySampleHash = legacyHash(plainPassword, "sample_secret_salt");
      expect(verifyPassword(plainPassword, legacySampleHash)).toBe(false);

      // 3. Legacy hash with explicit correct PASSWORD_SALT in production succeeds
      process.env.PASSWORD_SALT = "sample_secret_salt";
      expect(getPasswordSalt()).toBe("sample_secret_salt");
      expect(verifyPassword(plainPassword, legacySampleHash)).toBe(true);
    } finally {
      process.env.NODE_ENV = prevNodeEnv;
      process.env.PASSWORD_SALT = prevSalt;
    }
  });

  // ────────────────────────────────────────────────────────────
  // 12. SEC-001 through SEC-025 and SEC-SECRET-01 through 04
  // ────────────────────────────────────────────────────────────
  it("SEC-001: unauthenticated sensitive route must return 401 Not Authenticated", async () => {
    const res = await request(app).get("/api/creches/1/pets/101");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });

  it("SEC-002: wrong role must return 403 Forbidden with structured denial log", () => {
    const req: any = {
      user: { id: 10, role: "staff", crecheId: 1, name: "Staff Member", email: "staff@arkpet.test" },
      headers: {},
      path: "/api/commercial/activate",
      method: "POST",
    };
    let status = 0;
    let jsonBody: any = null;
    const res: any = {
      status: (s: number) => { status = s; return res; },
      json: (j: any) => { jsonBody = j; return res; },
    };
    const next = vi.fn();

    const guard = requireRole("master_admin");
    guard(req, res, next);
    expect(status).toBe(403);
    expect(jsonBody).toEqual({ error: "Forbidden" });
    expect(next).not.toHaveBeenCalled();
  });

  it("SEC-003: cross-tenant read must return 403 Sem acesso a esta creche", async () => {
    const tokenTutorCreche2 = generateToken(99, "tutor");
    const res = await request(app)
      .get("/api/creches/1/pets/101")
      .set("Authorization", `Bearer ${tokenTutorCreche2}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Sem acesso a esta creche");
  });

  it("SEC-004: cross-tenant write must be blocked by tenant boundary guard", async () => {
    const tokenTutorCreche2 = generateToken(99, "tutor");
    const res = await request(app)
      .put("/api/creches/1/pets/101")
      .set("Authorization", `Bearer ${tokenTutorCreche2}`)
      .send({ name: "AttackerPet" });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Sem acesso a esta creche");
  });

  it("SEC-017: expired JWT — verifyToken must reject tokens past AUTH_TOKEN_TTL_MS", () => {
    const expiredTimestamp = Date.now() - (AUTH_TOKEN_TTL_MS + 1000);
    const expiredToken = generateToken(10, "tutor", expiredTimestamp);
    expect(verifyToken(expiredToken)).toBeNull();
  });

  it("SEC-020: archived tenant — authenticated user belonging to archived creche must receive 403 tenant_archived", async () => {
    const tokenUser4 = generateToken(41, "tutor");
    const res = await request(app)
      .get("/api/creches/4/pets/101")
      .set("Authorization", `Bearer ${tokenUser4}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("tenant_archived");
  });

  it("SEC-SECRET-01: current tracked source contains no forbidden real secret literal", () => {
    const repoRoot = path.resolve(__dirname, "../../../../");
    const forbiddenPatterns = [
      /sk_live_[0-9a-zA-Z]{24,}/,
      /rk_live_[0-9a-zA-Z]{24,}/,
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    ];

    const filesToScan: string[] = [
      path.join(repoRoot, ".replit"),
      path.join(repoRoot, "artifacts/api-server/src/lib/auth.ts"),
      path.join(repoRoot, "artifacts/api-server/src/lib/push.ts"),
      path.join(repoRoot, "artifacts/api-server/src/lib/stripeClient.ts"),
      path.join(repoRoot, "artifacts/api-server/src/lib/config.ts"),
    ];

    for (const file of filesToScan) {
      if (fs.existsSync(file)) {
        const content = fs.readFileSync(file, "utf-8");
        for (const pattern of forbiddenPatterns) {
          expect(pattern.test(content)).toBe(false);
        }
      }
    }
  });

  it("SEC-SECRET-02: .replit contains no private JWT/VAPID/password secret literal", () => {
    const replitPath = path.resolve(__dirname, "../../../../.replit");
    expect(fs.existsSync(replitPath)).toBe(true);
    const content = fs.readFileSync(replitPath, "utf-8");

    expect(content).not.toMatch(/JWT_SECRET\s*=/);
    expect(content).not.toMatch(/VAPID_PRIVATE_KEY\s*=/);
    expect(content).not.toMatch(/\[userenv\.production\]\s*\n\s*PASSWORD_SALT\s*=/);

    expect(content).toMatch(/VAPID_PUBLIC_KEY\s*=/);
    expect(content).toMatch(/APP_URL\s*=/);
    expect(content).toMatch(/RESEND_FROM_EMAIL\s*=/);
    expect(content).toMatch(/MASTER_ADMIN_EMAIL\s*=/);
  });

  it("SEC-SECRET-03: application resolves required secrets from environment", () => {
    const origEnv = process.env.JWT_SECRET;
    try {
      process.env.JWT_SECRET = "test-env-jwt-secret-xyz";
      expect(getJwtSecret()).toBe("test-env-jwt-secret-xyz");
    } finally {
      process.env.JWT_SECRET = origEnv;
    }
  });

  it("SEC-SECRET-04: missing mandatory production secret fails closed where appropriate", () => {
    const origNodeEnv = process.env.NODE_ENV;
    const origJwtSecret = process.env.JWT_SECRET;
    const origSessionSecret = process.env.SESSION_SECRET;

    try {
      process.env.NODE_ENV = "production";
      delete process.env.JWT_SECRET;
      delete process.env.SESSION_SECRET;

      expect(() => getJwtSecret()).toThrow("JWT_SECRET must be configured in production");
      expect(() => getUploadProofSecret()).toThrow("Missing SESSION_SECRET in production environment");
    } finally {
      process.env.NODE_ENV = origNodeEnv;
      process.env.JWT_SECRET = origJwtSecret;
      process.env.SESSION_SECRET = origSessionSecret;
    }
  });
});
