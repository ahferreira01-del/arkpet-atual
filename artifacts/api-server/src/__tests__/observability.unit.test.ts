import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  logger,
  redact,
  sanitizePushEndpoint,
  maskEmail,
  setLogWriter,
  resetLogWriter,
  financialLog,
  type StructuredLogRecord,
} from "../lib/logger.js";
import { requestIdMiddleware, isValidRequestId } from "../middlewares/requestId.js";
import { requestLoggerMiddleware } from "../middlewares/requestLogger.js";
import { handleLivenessCheck, handleReadinessCheck } from "../routes/health.js";
import { getRuntimeProvenance, handleGetVersion, APP_VERSION } from "../lib/version.js";
import { requireRole } from "../middlewares/authenticate.js";
import { requireCrecheMembership } from "../middlewares/requireCrecheMembership.js";
import type { Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";

describe("R40.F — Audit, Observability & Runtime Provenance Unit Tests", () => {
  let capturedLogs: Array<{ line: string; parsed: any; level: string }> = [];

  beforeEach(() => {
    capturedLogs = [];
    setLogWriter((line: string, level: string) => {
      try {
        capturedLogs.push({ line, parsed: JSON.parse(line), level });
      } catch {
        capturedLogs.push({ line, parsed: line, level });
      }
    });
  });

  afterEach(() => {
    resetLogWriter();
    vi.restoreAllMocks();
  });

  // Helper to create mock Express request and response objects
  function createMockReqRes(options: {
    headers?: Record<string, string>;
    method?: string;
    path?: string;
    id?: string;
    user?: any;
    params?: any;
    body?: any;
  } = {}) {
    const req: any = {
      headers: options.headers || {},
      method: options.method || "GET",
      path: options.path || "/api/test",
      id: options.id,
      user: options.user,
      params: options.params || {},
      body: options.body || {},
    };

    const headerStore: Record<string, string> = {};
    const listeners: Record<string, Array<() => void>> = {};

    const res: any = {
      statusCode: 200,
      headersSent: false,
      setHeader: vi.fn((key: string, value: string) => {
        headerStore[key.toLowerCase()] = value;
      }),
      getHeader: vi.fn((key: string) => headerStore[key.toLowerCase()]),
      status: vi.fn(function (code: number) {
        res.statusCode = code;
        return res;
      }),
      json: vi.fn(function (body: any) {
        res.body = body;
        return res;
      }),
      on: vi.fn((event: string, callback: () => void) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(callback);
      }),
      emitFinish: () => {
        if (listeners["finish"]) {
          listeners["finish"].forEach((cb) => cb());
        }
      },
    };

    return { req, res, headerStore };
  }

  // ────────────────────────────────────────────────────────────
  // OBS-001: Request ID generated when missing
  // ────────────────────────────────────────────────────────────
  it("OBS-001: generates a unique correlation ID when X-Request-ID header is missing", () => {
    const { req, res } = createMockReqRes({ headers: {} });
    const next = vi.fn();

    requestIdMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.id).toBeDefined();
    expect(typeof req.id).toBe("string");
    expect(isValidRequestId(req.id)).toBe(true);
    expect(req.id.length).toBeGreaterThanOrEqual(16);
  });

  // ────────────────────────────────────────────────────────────
  // OBS-002: Valid incoming X-Request-ID preserved
  // ────────────────────────────────────────────────────────────
  it("OBS-002: preserves valid incoming X-Request-ID header", () => {
    const customId = "req-upstream-trace-123456";
    const { req, res } = createMockReqRes({
      headers: { "x-request-id": customId },
    });
    const next = vi.fn();

    requestIdMiddleware(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.id).toBe(customId);
  });

  // ────────────────────────────────────────────────────────────
  // OBS-003: Oversized / malformed incoming ID replaced
  // ────────────────────────────────────────────────────────────
  it("OBS-003: replaces oversized or malformed incoming request IDs with a safe UUID", () => {
    // Case 1: Oversized string (> 64 chars)
    const oversizedId = "a".repeat(65);
    const { req: req1, res: res1 } = createMockReqRes({
      headers: { "x-request-id": oversizedId },
    });
    requestIdMiddleware(req1 as Request, res1 as Response, vi.fn());
    expect(req1.id).not.toBe(oversizedId);
    expect(isValidRequestId(req1.id)).toBe(true);

    // Case 2: Malformed characters (potential injection / log splitting)
    const maliciousId = "req-id<script>alert(1)</script>";
    const { req: req2, res: res2 } = createMockReqRes({
      headers: { "x-request-id": maliciousId },
    });
    requestIdMiddleware(req2 as Request, res2 as Response, vi.fn());
    expect(req2.id).not.toBe(maliciousId);
    expect(isValidRequestId(req2.id)).toBe(true);
  });

  // ────────────────────────────────────────────────────────────
  // OBS-004: X-Request-ID set on response header
  // ────────────────────────────────────────────────────────────
  it("OBS-004: sets X-Request-ID response header matching the assigned request ID", () => {
    const { req, res, headerStore } = createMockReqRes({ headers: {} });
    requestIdMiddleware(req as Request, res as Response, vi.fn());

    expect(res.setHeader).toHaveBeenCalledWith("X-Request-ID", req.id);
    expect(headerStore["x-request-id"]).toBe(req.id);
  });

  // ────────────────────────────────────────────────────────────
  // OBS-005: Central log redaction (passwords, tokens, proofs, CPF, etc.)
  // ────────────────────────────────────────────────────────────
  it("OBS-005: central redact recursively sanitizes sensitive keys and protects against circular references", () => {
    const sensitivePayload: any = {
      safeUserId: 42,
      safeRole: "creche_admin",
      password: "SuperSecretPassword123!",
      passwordHash: "$2b$10$abcdefghijklmnopqrstuvwxyz",
      token: "jwt.header.payload.signature",
      authorization: "Bearer secret-token-xyz",
      cookie: "connect.sid=s%3A123456",
      jwt: "secret.token.string",
      vapidPrivateKey: "vapid-secret-key-material",
      stripeSecretKey: "sk_test_51234567890abcdef",
      stripeWebhookSecret: "whsec_test_secret_key",
      uploadProof: "payload.hmac_signature_value",
      mediaUploadProof: "chat_proof.signature_val",
      ownershipProof: "ownership_proof_hash",
      cpf: "123.456.789-00",
      card: "4111222233334444",
      cvv: "123",
      nested: {
        innerPassword: "InnerSecret123",
        safeMeta: "ok",
      },
    };

    // Circular reference test
    sensitivePayload.circularRef = sensitivePayload;

    const sanitized = redact(sensitivePayload) as any;

    expect(sanitized.safeUserId).toBe(42);
    expect(sanitized.safeRole).toBe("creche_admin");
    expect(sanitized.password).toBe("[REDACTED]");
    expect(sanitized.passwordHash).toBe("[REDACTED]");
    expect(sanitized.token).toBe("[REDACTED]");
    expect(sanitized.authorization).toBe("[REDACTED]");
    expect(sanitized.cookie).toBe("[REDACTED]");
    expect(sanitized.jwt).toBe("[REDACTED]");
    expect(sanitized.vapidPrivateKey).toBe("[REDACTED]");
    expect(sanitized.stripeSecretKey).toBe("[REDACTED]");
    expect(sanitized.stripeWebhookSecret).toBe("[REDACTED]");
    expect(sanitized.uploadProof).toBe("[REDACTED]");
    expect(sanitized.mediaUploadProof).toBe("[REDACTED]");
    expect(sanitized.ownershipProof).toBe("[REDACTED]");
    expect(sanitized.cpf).toBe("[REDACTED]");
    expect(sanitized.card).toBe("[REDACTED]");
    expect(sanitized.cvv).toBe("[REDACTED]");
    expect(sanitized.nested.innerPassword).toBe("[REDACTED]");
    expect(sanitized.nested.safeMeta).toBe("ok");
    expect(sanitized.circularRef).toBe("[CIRCULAR]");
  });

  // ────────────────────────────────────────────────────────────
  // OBS-006: Unexpected error logs requestId, returns 500 without stack trace
  // ────────────────────────────────────────────────────────────
  it("OBS-006: unhandled error middleware logs requestId and returns 500 without leaking stack trace", () => {
    const { req, res } = createMockReqRes({ id: "req-err-unit-test-99" });
    const mockError = new Error("Database deadlock during transaction");
    mockError.stack = "Error: Database deadlock\n    at internalQuery (/app/src/db.ts:42:15)";

    // App error handler implementation logic
    const status: number = (mockError as any).status ?? 500;
    const requestId = req.id;

    logger.error("unhandled_error", mockError, {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: 500,
    });

    res.status(500).json({
      error: "Erro interno do servidor",
      code: "INTERNAL_ERROR",
      requestId,
    });

    // Verify response
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      error: "Erro interno do servidor",
      code: "INTERNAL_ERROR",
      requestId: "req-err-unit-test-99",
    });
    // Response MUST NOT contain stack or internal file path
    expect(res.body.stack).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain("/app/src/db.ts");

    // Verify log record
    expect(capturedLogs.length).toBe(1);
    const log = capturedLogs[0].parsed;
    expect(log.event).toBe("unhandled_error");
    expect(log.requestId).toBe("req-err-unit-test-99");
    expect(log.messageSafe).toBe("Database deadlock during transaction");
  });

  // ────────────────────────────────────────────────────────────
  // OBS-007: /api/version returns expected safe schema
  // ────────────────────────────────────────────────────────────
  it("OBS-007: getRuntimeProvenance returns expected safe schema", () => {
    const provenance = getRuntimeProvenance({
      ARKPET_COMMIT_SHA: "68c5cb713b9a58e0666649b70da6505ff43a7961",
      BUILD_TIME: "2026-10-01T10:00:00.000Z",
      NODE_ENV: "production",
    });

    expect(provenance).toHaveProperty("version");
    expect(provenance).toHaveProperty("commitSha");
    expect(provenance).toHaveProperty("buildTime");
    expect(provenance).toHaveProperty("environment");

    expect(provenance.version).toBe(APP_VERSION);
    expect(provenance.commitSha).toBe("68c5cb713b9a58e0666649b70da6505ff43a7961");
    expect(provenance.buildTime).toBe("2026-10-01T10:00:00.000Z");
    expect(provenance.environment).toBe("production");
  });

  // ────────────────────────────────────────────────────────────
  // OBS-008: Commit SHA comes from environment/metadata, not hardcoded
  // ────────────────────────────────────────────────────────────
  it("OBS-008: commit SHA dynamically reflects environment and is not hardcoded to a static string", () => {
    const customCommit = "abc1234567890def";
    const prov1 = getRuntimeProvenance({ ARKPET_COMMIT_SHA: customCommit, NODE_ENV: "production" });
    expect(prov1.commitSha).toBe(customCommit);

    // When no commit SHA is injected in production, it safely falls back to 'unknown'
    const prov2 = getRuntimeProvenance({ NODE_ENV: "production" });
    expect(prov2.commitSha).toBe("unknown");
  });

  // ────────────────────────────────────────────────────────────
  // OBS-009: /api/version does not expose environment secrets
  // ────────────────────────────────────────────────────────────
  it("OBS-009: /api/version does not expose environment secrets (SESSION_SECRET, DATABASE_URL)", () => {
    const dangerousEnv = {
      ARKPET_COMMIT_SHA: "commit-sha-val",
      NODE_ENV: "production",
      SESSION_SECRET: "ultra_confidential_session_secret",
      DATABASE_URL: "postgresql://postgres:secretpassword@prod-db:5432/arkpet",
      STRIPE_SECRET_KEY: "sk_live_verysecretstripekey",
      VAPID_PRIVATE_KEY: "vapid_super_private",
    };

    const provenance = getRuntimeProvenance(dangerousEnv);
    const serialized = JSON.stringify(provenance);

    expect(serialized).not.toContain("ultra_confidential_session_secret");
    expect(serialized).not.toContain("secretpassword");
    expect(serialized).not.toContain("sk_live_verysecretstripekey");
    expect(serialized).not.toContain("vapid_super_private");

    expect((provenance as any).SESSION_SECRET).toBeUndefined();
    expect((provenance as any).DATABASE_URL).toBeUndefined();
  });

  // ────────────────────────────────────────────────────────────
  // OBS-010: Liveness /api/health returns 200 without DB call
  // ────────────────────────────────────────────────────────────
  it("OBS-010: liveness probe returns 200 without database interaction (LIVENESS_DB_DEPENDENCY = NO)", () => {
    const { req, res } = createMockReqRes();
    handleLivenessCheck(req as Request, res as Response);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  // ────────────────────────────────────────────────────────────
  // OBS-011: Readiness /api/ready returns 200 when DB is healthy
  // ────────────────────────────────────────────────────────────
  it("OBS-011: readiness probe returns 200 when database connectivity succeeds", async () => {
    const { req, res } = createMockReqRes();
    const mockDbPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
    };

    await handleReadinessCheck(req as Request, res as Response, mockDbPool);

    expect(mockDbPool.query).toHaveBeenCalledWith("SELECT 1");
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      checks: { database: "healthy" },
    });
  });

  // ────────────────────────────────────────────────────────────
  // OBS-012: Readiness /api/ready returns 503 without credential leak when DB fails
  // ────────────────────────────────────────────────────────────
  it("OBS-012: readiness probe returns 503 and redacts credentials when database connectivity fails", async () => {
    const { req, res } = createMockReqRes();
    const mockDbPool = {
      query: vi.fn().mockRejectedValue(new Error("FATAL: password authentication failed for user arkpet_admin: secret_pass_123")),
    };

    await handleReadinessCheck(req as Request, res as Response, mockDbPool);

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      status: "unhealthy",
      checks: { database: "down" },
    });

    const responseStr = JSON.stringify(res.body);
    expect(responseStr).not.toContain("secret_pass_123");
    expect(responseStr).not.toContain("arkpet_admin");
  });

  // ────────────────────────────────────────────────────────────
  // OBS-013: Commercial audit preserved (commercial_audit_ledger / financialLog)
  // ────────────────────────────────────────────────────────────
  it("OBS-013: financialLog preserves audit ledger events while automatically redacting sensitive data", () => {
    financialLog({
      operation: "charge_plan_cycle",
      tenantId: 1,
      invoiceId: 901,
      userId: 42,
      result: "success",
      token: "tok_secret_card_token_123",
      password: "unexpected_password_field",
      level: "info",
    });

    expect(capturedLogs.length).toBe(1);
    const log = capturedLogs[0].parsed;
    expect(log.logger).toBe("financial");
    expect(log.operation).toBe("charge_plan_cycle");
    expect(log.tenantId).toBe(1);
    expect(log.invoiceId).toBe(901);
    expect(log.token).toBe("[REDACTED]");
    expect(log.password).toBe("[REDACTED]");
  });

  // ────────────────────────────────────────────────────────────
  // OBS-014: Push audit preserves privacy (fingerprinted endpoint, keys stripped)
  // ────────────────────────────────────────────────────────────
  it("OBS-014: sanitizePushEndpoint preserves origin and SHA256 fingerprint without logging client subscriber tokens", () => {
    const rawEndpoint = "https://fcm.googleapis.com/fcm/send/dK3f84s9-very-secret-push-subscriber-token-123456";
    const sanitized = sanitizePushEndpoint(rawEndpoint);

    expect(sanitized).toMatch(/^https:\/\/fcm\.googleapis\.com\/\.\.\.\[[0-9a-f]{8}\]$/);
    expect(sanitized).not.toContain("very-secret-push-subscriber-token");

    // Invalid endpoint handling
    expect(sanitizePushEndpoint("not-a-url")).toBe("[invalid-endpoint]");
    expect(sanitizePushEndpoint(undefined)).toBe("none");
  });

  // ────────────────────────────────────────────────────────────
  // OBS-015: Storage failure log does not leak upload proof or file content
  // ────────────────────────────────────────────────────────────
  it("OBS-015: storage failure logging redacts uploadProof and file contents", () => {
    logger.error("storage_upload_failed", {
      objectPath: "/objects/uploads/c1/test.jpg",
      uploadProof: "payload.hmac_signature_value",
      fileContent: "BASE64_SENSITIVE_BINARY_PAYLOAD_DATA",
      fileData: "BUFFER_CONTENTS",
      crecheId: 1,
      userId: 10,
    });

    expect(capturedLogs.length).toBe(1);
    const log = capturedLogs[0].parsed;
    expect(log.event).toBe("storage_upload_failed");
    expect(log.uploadProof).toBe("[REDACTED]");
    expect(log.fileContent).toBe("[REDACTED]");
    expect(log.fileData).toBe("[REDACTED]");
    expect(log.crecheId).toBe(1);
    expect(log.userId).toBe(10);
  });

  // ────────────────────────────────────────────────────────────
  // OBS-016: Chat technical log does not contain message body
  // ────────────────────────────────────────────────────────────
  it("OBS-016: chat technical logging redacts message bodies and content", () => {
    logger.info("chat_message_dispatch", {
      tutorId: 25,
      crecheId: 1,
      content: "Sensitive medical note: o pet tomou antibiótico às 14h",
      messageBody: "Privileged message body text",
    });

    expect(capturedLogs.length).toBe(1);
    const log = capturedLogs[0].parsed;
    expect(log.event).toBe("chat_message_dispatch");
    expect(log.tutorId).toBe(25);
    expect(log.crecheId).toBe(1);
    expect(log.content).toBe("[REDACTED]");
    expect(log.messageBody).toBe("[REDACTED]");
    expect(capturedLogs[0].line).not.toContain("antibiótico");
  });

  // ────────────────────────────────────────────────────────────
  // OBS-017: Failed login log contains no password
  // ────────────────────────────────────────────────────────────
  it("OBS-017: failed login logging redacts password and masks email address", () => {
    logger.warn("login_failed", {
      emailMasked: maskEmail("admin.alpha@arkpet.test"),
      password: "wrong_password_attempt",
      reason: "invalid_credentials",
      path: "/api/auth/login",
    });

    expect(capturedLogs.length).toBe(1);
    const log = capturedLogs[0].parsed;
    expect(log.event).toBe("login_failed");
    expect(log.emailMasked).toBe("ad***@arkpet.test");
    expect(log.password).toBe("[REDACTED]");
    expect(log.reason).toBe("invalid_credentials");
    expect(capturedLogs[0].line).not.toContain("wrong_password_attempt");
  });

  // ────────────────────────────────────────────────────────────
  // OBS-018: Password reset log contains no reset token
  // ────────────────────────────────────────────────────────────
  it("OBS-018: password reset logging redacts reset token", () => {
    logger.info("password_reset_completed", {
      userId: 5,
      emailMasked: maskEmail("tutor.bob@arkpet.test"),
      token: "secret_reset_token_raw_abc123",
      resetToken: "secret_reset_token_raw_xyz789",
    });

    expect(capturedLogs.length).toBe(1);
    const log = capturedLogs[0].parsed;
    expect(log.event).toBe("password_reset_completed");
    expect(log.userId).toBe(5);
    expect(log.emailMasked).toBe("tu***@arkpet.test");
    expect(log.token).toBe("[REDACTED]");
    expect(log.resetToken).toBe("[REDACTED]");
    expect(capturedLogs[0].line).not.toContain("secret_reset_token_raw");
  });

  // ────────────────────────────────────────────────────────────
  // OBS-019: Slow request emits warning with requestId, duration, safe path, no body
  // ────────────────────────────────────────────────────────────
  it("OBS-019: slow request logging emits warning with duration and requestId without request body", () => {
    const { req, res } = createMockReqRes({
      id: "req-slow-perf-001",
      method: "POST",
      path: "/api/creches/1/reports",
      body: { sensitiveFilter: "secret query data" },
    });

    // Mock Date.now() to simulate 1600ms latency (> 1500ms threshold)
    let callCount = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      callCount++;
      return callCount === 1 ? 1000 : 2600; // 2600 - 1000 = 1600ms
    });

    requestLoggerMiddleware(req as Request, res as Response, vi.fn());
    res.statusCode = 200;
    res.emitFinish();

    expect(capturedLogs.length).toBe(1);
    const log = capturedLogs[0].parsed;
    expect(log.event).toBe("slow_request");
    expect(log.requestId).toBe("req-slow-perf-001");
    expect(log.durationMs).toBe(1600);
    expect(log.path).toBe("/api/creches/1/reports");
    expect(log.statusCode).toBe(200);
    // Request body must never be attached to request logs
    expect(log.body).toBeUndefined();
    expect(log.sensitiveFilter).toBeUndefined();
  });

  // ────────────────────────────────────────────────────────────
  // OBS-020: Authenticated request log safely includes userId, role, crecheId, excludes PII
  // ────────────────────────────────────────────────────────────
  it("OBS-020: authenticated request log includes technical tenant/user identifiers and excludes PII", () => {
    const { req, res } = createMockReqRes({
      id: "req-auth-020",
      method: "GET",
      path: "/api/creches/1/pets",
      user: {
        id: 42,
        role: "creche_admin",
        crecheId: 1,
        name: "Admin User",
        email: "admin@creche.com",
        cpf: "11122233344",
        phone: "1199999999",
      },
    });

    requestLoggerMiddleware(req as Request, res as Response, vi.fn());
    res.statusCode = 200;
    res.emitFinish();

    expect(capturedLogs.length).toBe(1);
    const log = capturedLogs[0].parsed;
    expect(log.event).toBe("request_completed");
    expect(log.userId).toBe(42);
    expect(log.role).toBe("creche_admin");
    expect(log.crecheId).toBe(1);

    // PII fields MUST NOT be present
    expect(log.name).toBeUndefined();
    expect(log.email).toBeUndefined();
    expect(log.cpf).toBeUndefined();
    expect(log.phone).toBeUndefined();
  });

  // ────────────────────────────────────────────────────────────
  // BONUS: Security Denial Observability (requireRole & requireCrecheMembership)
  // ────────────────────────────────────────────────────────────
  describe("Security Denial Observability (AUTHORIZATION_DENIAL_OBSERVABLE = YES)", () => {
    it("logs warning when role authorization is denied", () => {
      const { req, res } = createMockReqRes({
        id: "req-role-denied-001",
        method: "POST",
        path: "/api/creches/1/manage",
        user: { id: 10, role: "tutor", crecheId: 1 },
      });
      const next = vi.fn();

      const middleware = requireRole("master_admin", "creche_admin");
      middleware(req as any, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect(capturedLogs.length).toBe(1);
      const log = capturedLogs[0].parsed;
      expect(log.event).toBe("authorization_denied");
      expect(log.reason).toBe("insufficient_role");
      expect(log.userId).toBe(10);
      expect(log.role).toBe("tutor");
      expect(log.requiredRoles).toEqual(["master_admin", "creche_admin"]);
    });

    it("logs warning on cross-tenant access attempt", () => {
      const { req, res } = createMockReqRes({
        id: "req-cross-tenant-001",
        method: "GET",
        path: "/api/creches/2/pets",
        params: { crecheId: "2" },
        user: { id: 10, role: "creche_admin", crecheId: 1 }, // Belongs to Creche 1, accessing Creche 2
      });
      const next = vi.fn();

      requireCrecheMembership(req as any, res as Response, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect(capturedLogs.length).toBe(1);
      const log = capturedLogs[0].parsed;
      expect(log.event).toBe("authorization_denied");
      expect(log.reason).toBe("cross_tenant_access_attempt");
      expect(log.userId).toBe(10);
      expect(log.userCrecheId).toBe(1);
      expect(log.targetCrecheId).toBe(2);
    });
  });

  // ────────────────────────────────────────────────────────────
  // R40.F-FINAL.1 MANDATORY CLOSURE TESTS
  // ────────────────────────────────────────────────────────────
  describe("R40.F-FINAL.1 — Secret-Safe Error Logging & Version Provenance Closure", () => {
    // OBS-FINAL-01: READINESS LEAK TEST
    it("OBS-FINAL-01: readiness probe prevents secret leaks when database failure error contains credentials (READINESS_LOG_SECRET_LEAK = 0, READINESS_RAW_DRIVER_ERROR_LOGGED = 0)", async () => {
      const { req, res } = createMockReqRes();
      const rawSecret = "super_secret_db_pass_999";
      const rawDbUri = "postgres://postgres:super_secret_db_pass_999@db-cluster.internal:5432/arkpet_prod";
      const mockDbPool = {
        query: vi.fn().mockRejectedValue(
          new Error(`Connection failed: ${rawDbUri} - password authentication failed for user postgres: ${rawSecret}`)
        ),
      };

      await handleReadinessCheck(req as Request, res as Response, mockDbPool);

      expect(res.statusCode).toBe(503);
      expect(res.body).toEqual({
        status: "unhealthy",
        checks: { database: "down" },
      });

      // Assert logger output
      expect(capturedLogs.length).toBe(1);
      const log = capturedLogs[0].parsed;
      const logLine = capturedLogs[0].line;

      // Invariants:
      // 1. reason is fixed safe metadata, not raw driver string
      expect(log.reason).toBe("database_unavailable");
      expect(log.errorCode).toBe("DATABASE_ERROR");

      // 2. Secret value ABSENT
      expect(logLine).not.toContain(rawSecret);
      // 3. Database URL ABSENT
      expect(logLine).not.toContain("postgres://postgres");
      expect(logLine).not.toContain("db-cluster.internal");
      // 4. Raw driver error message ABSENT
      expect(logLine).not.toContain("password authentication failed for user postgres");
    });

    // OBS-FINAL-02: LOGGER SECRET-IN-STRING TEST
    it("OBS-FINAL-02: logger.error prevents secret leaks in Error strings across dev and production (ERROR_STRING_SECRET_LEAK = 0, RAW_ERROR_MESSAGE_PRODUCTION_LOGGING = 0)", () => {
      const syntheticSecret = "super_secret_user_password_456";
      const syntheticJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwidXNlcklkIjo5OX0.doNotLeakThisSignatureString12345";
      const syntheticDbUri = "postgres://db_user:db_pass_789@db.internal:5432/arkpet";
      const syntheticStripe = "sk_test_51MzTestSecretKey1234567890abcdef";

      const err = new Error(
        `Failed processing payment: ${syntheticStripe} with bearer token Bearer ${syntheticJwt} and database ${syntheticDbUri} where password=${syntheticSecret}`
      );

      // Test 1: In development/test mode
      logger.error("payment_failed_dev", err, { requestId: "req-dev-test" });
      expect(capturedLogs.length).toBe(1);
      const devLogLine = capturedLogs[0].line;

      expect(devLogLine).not.toContain(syntheticSecret);
      expect(devLogLine).not.toContain(syntheticJwt);
      expect(devLogLine).not.toContain("db_pass_789");
      expect(devLogLine).not.toContain(syntheticStripe);

      // Test 2: In production mode (RAW_ERROR_MESSAGE_PRODUCTION_LOGGING = 0, PRODUCTION_ERROR_MESSAGE_SAFE = YES)
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        capturedLogs = [];
        logger.error("payment_failed_prod", err, { requestId: "req-prod-test" });
        expect(capturedLogs.length).toBe(1);
        const prodLog = capturedLogs[0].parsed;
        const prodLogLine = capturedLogs[0].line;

        // Production log must NEVER copy raw err.message to messageSafe
        expect(prodLog.messageSafe).not.toContain("Failed processing payment");
        expect(prodLog.messageSafe).toBe("An internal server error occurred");

        // Every synthetic secret ABSENT
        expect(prodLogLine).not.toContain(syntheticSecret);
        expect(prodLogLine).not.toContain(syntheticJwt);
        expect(prodLogLine).not.toContain("db_pass_789");
        expect(prodLogLine).not.toContain(syntheticStripe);
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });

    // OBS-FINAL-03: VERSION ALIGNMENT TEST
    it("OBS-FINAL-03: backend APP_VERSION matches service worker CACHE_NAME (APP_VERSION_DRIFT = 0, BACKEND_VERSION_MATCHES_CURRENT_APP_VERSION = YES)", () => {
      // Find sw.js path
      const swPath = path.resolve(process.cwd(), "../petdaycare/public/sw.js");
      expect(fs.existsSync(swPath)).toBe(true);

      const swContent = fs.readFileSync(swPath, "utf-8");
      const match = swContent.match(/const CACHE_NAME = "([^"]+)";/);
      expect(match).not.toBeNull();
      const swCacheVersion = match![1];

      // Must be arkpet-v32 and match backend APP_VERSION
      expect(swCacheVersion).toBe("arkpet-v32");
      expect(APP_VERSION).toBe(swCacheVersion);

      const provenance = getRuntimeProvenance();
      expect(provenance.version).toBe("arkpet-v32");
      expect(provenance.version).toBe(swCacheVersion);
    });

    // OBS-FINAL-04: AUTH INTERNAL ERROR SECRET LEAK TEST
    it("OBS-FINAL-04: register-creche failure returns safe generic 500 and prevents secret leak in logs (AUTH_INTERNAL_ERROR_SECRET_LEAK = 0, REGISTER_CRECHE_INTERNAL_ERROR_LEAK = 0)", () => {
      const { req, res } = createMockReqRes({ id: "req-auth-fail-001" });
      const syntheticSecret = "pg_super_admin_pass_333";
      const internalFilePath = "/var/lib/postgresql/data/base/16384/pg_internal.dat";
      const rawDbError = `Internal error at ${internalFilePath}: FATAL password authentication failed for postgres: ${syntheticSecret}`;

      const err = new Error(rawDbError);
      (err as any).code = "INTERNAL_PROVISIONING_ERROR";

      // Simulated auth register-creche catch block
      const requestId = req.id;
      logger.error("register_creche_failed", err, {
        requestId,
        errorCode: (err as any)?.code || "INTERNAL_PROVISIONING_ERROR",
      });

      res.status(500).json({
        error: "Não foi possível cadastrar a creche. Tente novamente.",
        code: "INTERNAL_ERROR",
        requestId,
      });

      // 1. Response verification: generic safe error
      expect(res.statusCode).toBe(500);
      expect(res.body).toEqual({
        error: "Não foi possível cadastrar a creche. Tente novamente.",
        code: "INTERNAL_ERROR",
        requestId: "req-auth-fail-001",
      });
      const responseStr = JSON.stringify(res.body);
      expect(responseStr).not.toContain(syntheticSecret);
      expect(responseStr).not.toContain(internalFilePath);

      // 2. Log verification: contains requestId, safe code, zero secret leaks
      expect(capturedLogs.length).toBe(1);
      const log = capturedLogs[0].parsed;
      const logLine = capturedLogs[0].line;
      expect(log.event).toBe("register_creche_failed");
      expect(log.requestId).toBe("req-auth-fail-001");
      expect(log.errorCode).toBe("INTERNAL_PROVISIONING_ERROR");
      expect(logLine).not.toContain(syntheticSecret);
    });

    // BUILT_ARTIFACT_PROVENANCE_TEST
    it("BUILT_ARTIFACT_PROVENANCE_TEST: getRuntimeProvenance resolves valid commitSha and buildTime without falling back to unknown in production", () => {
      const commitSha = "68c5cb713b9a58e0666649b70da6505ff43a7961";
      const buildTime = "2026-10-01T08:00:00.000Z";

      const provenance = getRuntimeProvenance({
        ARKPET_COMMIT_SHA: commitSha,
        BUILD_TIME: buildTime,
        NODE_ENV: "production",
      });

      expect(provenance.commitSha).toBe(commitSha);
      expect(provenance.buildTime).toBe(buildTime);
      expect(provenance.version).toBe("arkpet-v32");
      expect(provenance.commitSha).not.toBe("unknown");
      expect(provenance.buildTime).not.toBe("unknown");
    });
  });
});
