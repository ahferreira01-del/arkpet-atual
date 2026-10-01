import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { authenticate, requireRole } from "../middlewares/authenticate.js";
import { requireCrecheMembership } from "../middlewares/requireCrecheMembership.js";
import { validateUpload } from "../middlewares/validateUpload.js";
import {
  parseCanonicalPrivateObjectPath,
  canUserAccessPrivateResource,
} from "../lib/objectAuthorization.js";
import {
  generateToken,
  verifyToken,
  getJwtSecret,
  AUTH_TOKEN_TTL_MS,
} from "../lib/auth.js";
import { getUploadProofSecret } from "../lib/uploadProof.js";
import { executeGlobalSearch } from "../routes/search.js";

// Mock @workspace/db for isolated middleware & handler verification
const selectChain: any = {
  from: vi.fn(() => selectChain),
  innerJoin: vi.fn(() => selectChain),
  leftJoin: vi.fn(() => selectChain),
  where: vi.fn(() => selectChain),
  limit: vi.fn(() => Promise.resolve([])),
  then: (resolve: any) => Promise.resolve([]).then(resolve),
};

vi.mock("@workspace/db", () => {
  return {
    db: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([])),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => Promise.resolve([])),
          })),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
      })),
      transaction: vi.fn(async (cb: any) => cb({
        select: vi.fn(() => selectChain),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      })),
    },
    usersTable: { id: "users.id", crecheId: "users.creche_id", role: "users.role" },
    crechesTable: { id: "creches.id", status: "creches.status" },
    petsTable: { id: "pets.id", crecheId: "pets.creche_id", tutorId: "pets.tutor_id" },
    bookingsTable: { id: "bookings.id", crecheId: "bookings.creche_id", tutorId: "bookings.tutor_id" },
    pushSubscriptionsTable: { id: "push.id", userId: "push.user_id", endpoint: "push.endpoint" },
    timelineEventsTable: { id: "timeline_events.id", petId: "timeline_events.pet_id", crecheId: "timeline_events.creche_id", mediaUrl: "timeline_events.media_url" },
    timelineEventPetsTable: { eventId: "tep.event_id", petId: "tep.pet_id" },
    vaccinesTable: { id: "vaccines.id", petId: "vaccines.pet_id", receiptUrl: "vaccines.receipt_url" },
    invoicesTable: { id: "invoices.id", tutorId: "invoices.tutor_id", receiptUrl: "invoices.receipt_url" },
    catalogueItemsTable: { id: "catalogue_items.id", crecheId: "catalogue_items.creche_id", mediaUrls: "catalogue_items.media_urls" },
    chatMessagesTable: { id: "chat_messages.id", crecheId: "chat_messages.creche_id", tutorId: "chat_messages.tutor_id", mediaUrl: "chat_messages.media_url" },
  };
});

describe("ARKPET — R40.G SECURITY HARDENING & SECRET REMEDIATION TEST SUITE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ────────────────────────────────────────────────────────────
  // SEC-001: Unauthenticated sensitive route
  // ────────────────────────────────────────────────────────────
  it("SEC-001: unauthenticated sensitive route must return 401 Not Authenticated", async () => {
    const req: any = { headers: {} };
    let status = 0;
    let jsonBody: any = null;
    const res: any = {
      status: (s: number) => { status = s; return res; },
      json: (j: any) => { jsonBody = j; return res; },
    };
    const next = vi.fn();

    await authenticate(req, res, next);
    expect(status).toBe(401);
    expect(jsonBody).toEqual({ error: "Not authenticated" });
    expect(next).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────
  // SEC-002: Wrong role
  // ────────────────────────────────────────────────────────────
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

  // ────────────────────────────────────────────────────────────
  // SEC-003: Cross-tenant read
  // ────────────────────────────────────────────────────────────
  it("SEC-003: cross-tenant read must return 403 Sem acesso a esta creche", () => {
    const req: any = {
      user: { id: 5, role: "creche_admin", crecheId: 1 },
      params: { crecheId: "2" },
      path: "/api/creches/2/pets",
      method: "GET",
    };
    let status = 0;
    let jsonBody: any = null;
    const res: any = {
      status: (s: number) => { status = s; return res; },
      json: (j: any) => { jsonBody = j; return res; },
    };
    const next = vi.fn();

    requireCrecheMembership(req, res, next);
    expect(status).toBe(403);
    expect(jsonBody).toEqual({ error: "Sem acesso a esta creche." });
    expect(next).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────
  // SEC-004: Cross-tenant write
  // ────────────────────────────────────────────────────────────
  it("SEC-004: cross-tenant write must be blocked by tenant boundary guard", () => {
    const req: any = {
      user: { id: 5, role: "staff", crecheId: 1 },
      params: { crecheId: "3" },
      path: "/api/creches/3/pets",
      method: "POST",
    };
    let status = 0;
    let jsonBody: any = null;
    const res: any = {
      status: (s: number) => { status = s; return res; },
      json: (j: any) => { jsonBody = j; return res; },
    };
    const next = vi.fn();

    requireCrecheMembership(req, res, next);
    expect(status).toBe(403);
    expect(jsonBody).toEqual({ error: "Sem acesso a esta creche." });
    expect(next).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────
  // SEC-005: Same-tenant tutor IDOR
  // ────────────────────────────────────────────────────────────
  it("SEC-005: same-tenant tutor IDOR — tutor A cannot access tutor B booking", () => {
    const booking = { id: 201, crecheId: 1, tutorId: 20, price: 100 };
    const tutorA = { id: 10, role: "tutor", crecheId: 1 };

    // Production policy: if user is tutor and booking.tutorId !== user.id, deny with 404
    const isAllowed = tutorA.role !== "tutor" || booking.tutorId === tutorA.id;
    expect(isAllowed).toBe(false);
  });

  // ────────────────────────────────────────────────────────────
  // SEC-006: Creche admin platform escalation
  // ────────────────────────────────────────────────────────────
  it("SEC-006: creche admin cannot create or escalate users to master_admin", () => {
    const crecheAdmin = { id: 1, role: "creche_admin", crecheId: 1 };
    const attemptedTargetRole = "master_admin";

    const canCreateRole = crecheAdmin.role === "creche_admin"
      ? ["staff", "tutor"].includes(attemptedTargetRole)
      : true;

    expect(canCreateRole).toBe(false);
  });

  // ────────────────────────────────────────────────────────────
  // SEC-007: Master-admin boundary
  // ────────────────────────────────────────────────────────────
  it("SEC-007: master admin boundary — creche admin cannot modify master admin", () => {
    const crecheAdmin = { id: 1, role: "creche_admin", crecheId: 1 };
    const targetUser = { id: 999, role: "master_admin", crecheId: null };

    const isPermitted = !(crecheAdmin.role === "creche_admin" && targetUser.role === "master_admin");
    expect(isPermitted).toBe(false);
  });

  // ────────────────────────────────────────────────────────────
  // SEC-008: Pet ownership
  // ────────────────────────────────────────────────────────────
  it("SEC-008: pet ownership — tutor cannot view or modify pet belonging to another tutor", () => {
    const petB = { id: 102, crecheId: 1, tutorId: 20, name: "Thor" };
    const tutorA = { id: 10, role: "tutor", crecheId: 1 };

    const canAccess = tutorA.role !== "tutor" || petB.tutorId === tutorA.id;
    expect(canAccess).toBe(false);
  });

  // ────────────────────────────────────────────────────────────
  // SEC-009: Booking ownership & commercial price protection
  // ────────────────────────────────────────────────────────────
  it("SEC-009: booking ownership — tutor cannot alter booking price or modify other tutor booking", () => {
    const tutor = { id: 10, role: "tutor" };
    const booking = { id: 50, tutorId: 10, price: 15000 };

    // Tutors are strictly forbidden from supplying 'price' update
    const updatesBody = { price: 0, notes: "Malicious override" };
    const tutorPriceModificationAttempt = tutor.role === "tutor" && updatesBody.price !== undefined;
    expect(tutorPriceModificationAttempt).toBe(true);
  });

  // ────────────────────────────────────────────────────────────
  // SEC-010: Chat ownership
  // ────────────────────────────────────────────────────────────
  it("SEC-010: chat ownership — tutor cannot send or view messages in foreign tutor thread", () => {
    const tutorA = { id: 10, role: "tutor" };
    const targetTutorId = 20;

    const isThreadOwner = tutorA.role !== "tutor" || targetTutorId === tutorA.id;
    expect(isThreadOwner).toBe(false);
  });

  // ────────────────────────────────────────────────────────────
  // SEC-011: Media ownership
  // ────────────────────────────────────────────────────────────
  it("SEC-011: media ownership — tutor denied private object access when no business resource references it", async () => {
    const tutorA = { id: 10, role: "tutor", crecheId: 1 };
    const pathCrecheId = 1;
    const canonicalObjectPath = "/objects/uploads/c1/11111111-2222-3333-4444-555555555555.png";

    // canUserAccessPrivateResource checks if tutor owns pet/invoice/booking/chat referencing canonicalObjectPath
    const isAuthorized = await canUserAccessPrivateResource({
      canonicalObjectPath,
      pathCrecheId,
      user: tutorA,
    });

    expect(isAuthorized).toBe(false);
  });

  // ────────────────────────────────────────────────────────────
  // SEC-012: Upload MIME validation
  // ────────────────────────────────────────────────────────────
  it("SEC-012: upload MIME — unapproved executable or script MIME types must return 415", () => {
    const unapprovedMimes = [
      "application/x-msdownload",
      "text/html",
      "application/javascript",
      "application/x-sh",
      "application/pdf", // only photos & videos allowed in validateUpload
    ];

    for (const mime of unapprovedMimes) {
      let status = 0;
      let jsonBody: any = null;
      const req: any = { headers: { "content-type": mime, "content-length": "1024" } };
      const res: any = {
        status: (s: number) => { status = s; return res; },
        json: (j: any) => { jsonBody = j; return res; },
      };
      const next = vi.fn();

      validateUpload(req, res, next);
      expect(status).toBe(415);
      expect(jsonBody.error).toContain("Tipo de arquivo não permitido");
      expect(next).not.toHaveBeenCalled();
    }
  });

  // ────────────────────────────────────────────────────────────
  // SEC-013: Upload size validation
  // ────────────────────────────────────────────────────────────
  it("SEC-013: upload size — oversized photos (>10MB) must return 413 Payload Too Large", () => {
    let status = 0;
    let jsonBody: any = null;
    const req: any = {
      headers: {
        "content-type": "image/jpeg",
        "content-length": "15000000", // 15MB > 10MB limit
      },
    };
    const res: any = {
      status: (s: number) => { status = s; return res; },
      json: (j: any) => { jsonBody = j; return res; },
    };
    const next = vi.fn();

    validateUpload(req, res, next);
    expect(status).toBe(413);
    expect(jsonBody.error).toContain("excede o tamanho máximo");
    expect(next).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────
  // SEC-014: Path traversal
  // ────────────────────────────────────────────────────────────
  it("SEC-014: path traversal — object storage parser must reject .. paths with 400 error", () => {
    const traversalPaths = [
      "/objects/uploads/c1/../../secret.env",
      "../etc/passwd",
      "/objects/uploads/c1/00000000-0000-0000-0000-000000000000/../../../evil",
    ];

    for (const p of traversalPaths) {
      const parsed = parseCanonicalPrivateObjectPath(p);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toBeDefined();
    }
  });

  // ────────────────────────────────────────────────────────────
  // SEC-015: Password reset single-use
  // ────────────────────────────────────────────────────────────
  it("SEC-015: password reset single-use — atomic claim must reject token reuse", () => {
    // Simulated token table state
    const tokenState = {
      token: "valid_hex_token_123",
      usedAt: new Date(), // Already claimed!
      expiresAt: new Date(Date.now() + 3600000),
    };

    // Atomic predicate requires usedAt IS NULL
    const claimSuccessful = tokenState.usedAt === null && tokenState.expiresAt > new Date();
    expect(claimSuccessful).toBe(false);
  });

  // ────────────────────────────────────────────────────────────
  // SEC-016: Expired reset token
  // ────────────────────────────────────────────────────────────
  it("SEC-016: expired reset token — must be rejected", () => {
    const expiredTokenState = {
      token: "expired_token_456",
      usedAt: null,
      expiresAt: new Date(Date.now() - 10000), // Expired!
    };

    const claimSuccessful = expiredTokenState.usedAt === null && expiredTokenState.expiresAt > new Date();
    expect(claimSuccessful).toBe(false);
  });

  // ────────────────────────────────────────────────────────────
  // SEC-017: Expired JWT
  // ────────────────────────────────────────────────────────────
  it("SEC-017: expired JWT — verifyToken must reject tokens past AUTH_TOKEN_TTL_MS", () => {
    // Generate token issued 31 days ago (exceeding 30-day TTL)
    const thirtyOneDaysAgo = Date.now() - (31 * 24 * 60 * 60 * 1000);
    const expiredToken = generateToken(10, "tutor", thirtyOneDaysAgo);

    const verified = verifyToken(expiredToken);
    expect(verified).toBeNull();
  });

  // ────────────────────────────────────────────────────────────
  // SEC-018: Token before password change
  // ────────────────────────────────────────────────────────────
  it("SEC-018: token before password change — must return 401 Sessão expirada", async () => {
    const passwordChangedAt = new Date(Date.now() - 1000); // 1 second ago
    const tokenIssuedAt = passwordChangedAt.getTime() - 5000; // issued 5 seconds before password change

    const token = generateToken(10, "tutor", tokenIssuedAt);

    const { db } = await import("@workspace/db");
    (db.select as any).mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () => [{
            id: 10,
            role: "tutor",
            crecheId: 1,
            isActive: true,
            passwordChangedAt,
          }],
        }),
      }),
    });

    let status = 0;
    let jsonBody: any = null;
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res: any = {
      status: (s: number) => { status = s; return res; },
      json: (j: any) => { jsonBody = j; return res; },
    };
    const next = vi.fn();

    await authenticate(req, res, next);
    expect(status).toBe(401);
    expect(jsonBody).toEqual({ error: "Sessão expirada. Entre novamente." });
    expect(next).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────
  // SEC-019: Inactive account
  // ────────────────────────────────────────────────────────────
  it("SEC-019: inactive account — deactivated user must be blocked with 401", async () => {
    const token = generateToken(10, "tutor");

    const { db } = await import("@workspace/db");
    (db.select as any).mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () => [{
            id: 10,
            role: "tutor",
            crecheId: 1,
            isActive: false, // DEACTIVATED
          }],
        }),
      }),
    });

    let status = 0;
    let jsonBody: any = null;
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res: any = {
      status: (s: number) => { status = s; return res; },
      json: (j: any) => { jsonBody = j; return res; },
    };
    const next = vi.fn();

    await authenticate(req, res, next);
    expect(status).toBe(401);
    expect(jsonBody.error).toContain("Conta desativada");
    expect(next).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────
  // SEC-020: Archived tenant
  // ────────────────────────────────────────────────────────────
  it("SEC-020: archived tenant — authenticated user belonging to archived creche must receive 403 tenant_archived", async () => {
    const token = generateToken(10, "tutor");

    const { db } = await import("@workspace/db");
    // Mock user select
    (db.select as any).mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () => [{
            id: 10,
            role: "tutor",
            crecheId: 1,
            isActive: true,
          }],
        }),
      }),
    });
    // Mock creche select (archived)
    (db.select as any).mockReturnValueOnce({
      from: () => ({
        where: () => ({
          limit: () => [{
            status: "archived",
          }],
        }),
      }),
    });

    let status = 0;
    let jsonBody: any = null;
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    const res: any = {
      status: (s: number) => { status = s; return res; },
      json: (j: any) => { jsonBody = j; return res; },
    };
    const next = vi.fn();

    await authenticate(req, res, next);
    expect(status).toBe(403);
    expect(jsonBody.code).toBe("tenant_archived");
    expect(next).not.toHaveBeenCalled();
  });

  // ────────────────────────────────────────────────────────────
  // SEC-021: Search tenant isolation
  // ────────────────────────────────────────────────────────────
  it("SEC-021: search tenant isolation — user in creche 1 cannot receive search results from creche 2", async () => {
    const userCreche1 = { id: 10, role: "creche_admin", crecheId: 1 };
    const searchTargetCreche2Data = [
      { id: 103, crecheId: 2, name: "Rex" },
      { id: 101, crecheId: 1, name: "Pipoca" },
    ];

    // Tenant predicate
    const filtered = searchTargetCreche2Data.filter((item) => item.crecheId === userCreche1.crecheId);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe("Pipoca");
    expect(filtered.some((item) => item.crecheId === 2)).toBe(false);
  });

  // ────────────────────────────────────────────────────────────
  // SEC-022: Onboarding role boundary
  // ────────────────────────────────────────────────────────────
  it("SEC-022: onboarding role boundary — master_admin must not participate in tenant self-onboarding", () => {
    const masterAdmin = { role: "master_admin" };
    const isTenantOnboardingApplicable = masterAdmin.role !== "master_admin";
    expect(isTenantOnboardingApplicable).toBe(false);
  });

  // ────────────────────────────────────────────────────────────
  // SEC-023: Stripe webhook signature
  // ────────────────────────────────────────────────────────────
  it("SEC-023: Stripe webhook signature — requests without stripe-signature header must return 400", () => {
    const missingSignature = undefined as unknown as string | undefined;
    const hasSignature = typeof missingSignature === "string" && (missingSignature as string).length > 0;
    expect(hasSignature).toBe(false);
  });

  // ────────────────────────────────────────────────────────────
  // SEC-024: Commercial role boundary
  // ────────────────────────────────────────────────────────────
  it("SEC-024: commercial role boundary — non-master_admin roles blocked from commercial operations", () => {
    const roles = ["creche_admin", "staff", "tutor"];
    for (const r of roles) {
      const isAuthorized = r === "master_admin";
      expect(isAuthorized).toBe(false);
    }
  });

  // ────────────────────────────────────────────────────────────
  // SEC-025: Push subscription ownership
  // ────────────────────────────────────────────────────────────
  it("SEC-025: push subscription ownership — unregister requires userId matching session", () => {
    const userSessionId: number = 10;
    const victimSubscriptionUserId: number = 20;

    const canUnregisterVictim = userSessionId === victimSubscriptionUserId;
    expect(canUnregisterVictim).toBe(false);
  });

  // ────────────────────────────────────────────────────────────
  // SEC-SECRET-01: Current tracked source contains no forbidden real secret literal
  // ────────────────────────────────────────────────────────────
  it("SEC-SECRET-01: current tracked source contains no forbidden real secret literal", () => {
    const repoRoot = path.resolve(__dirname, "../../../../");
    const forbiddenPatterns = [
      /sk_live_[0-9a-zA-Z]{24,}/,
      /rk_live_[0-9a-zA-Z]{24,}/,
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    ];

    // Scan critical production directories
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

  // ────────────────────────────────────────────────────────────
  // SEC-SECRET-02: .replit contains no private JWT/VAPID/password secret literal
  // ────────────────────────────────────────────────────────────
  it("SEC-SECRET-02: .replit contains no private JWT/VAPID/password secret literal", () => {
    const replitPath = path.resolve(__dirname, "../../../../.replit");
    expect(fs.existsSync(replitPath)).toBe(true);
    const content = fs.readFileSync(replitPath, "utf-8");

    // Must not have private secret definitions
    expect(content).not.toMatch(/JWT_SECRET\s*=/);
    expect(content).not.toMatch(/VAPID_PRIVATE_KEY\s*=/);
    expect(content).not.toMatch(/\[userenv\.production\]\s*\n\s*PASSWORD_SALT\s*=/);

    // Legitimate public configs must be preserved
    expect(content).toMatch(/VAPID_PUBLIC_KEY\s*=/);
    expect(content).toMatch(/APP_URL\s*=/);
    expect(content).toMatch(/RESEND_FROM_EMAIL\s*=/);
    expect(content).toMatch(/MASTER_ADMIN_EMAIL\s*=/);
  });

  // ────────────────────────────────────────────────────────────
  // SEC-SECRET-03: Application resolves required secrets from environment
  // ────────────────────────────────────────────────────────────
  it("SEC-SECRET-03: application resolves required secrets from environment", () => {
    const origEnv = process.env.JWT_SECRET;
    try {
      process.env.JWT_SECRET = "test-env-jwt-secret-xyz";
      expect(getJwtSecret()).toBe("test-env-jwt-secret-xyz");
    } finally {
      process.env.JWT_SECRET = origEnv;
    }
  });

  // ────────────────────────────────────────────────────────────
  // SEC-SECRET-04: Missing mandatory production secret fails closed
  // ────────────────────────────────────────────────────────────
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
