import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../../artifacts/api-server/src/app.js";
import { pool } from "@workspace/db";
import { getJwtSecret, validateJwtConfig } from "../../artifacts/api-server/src/lib/auth.js";
import { createGracefulShutdown } from "../../artifacts/api-server/src/index.js";

describe("R29B — Production Deployment Hardening Suite", () => {
  describe("DEPLOY-R29-002: Database-Aware Health & Readiness Check (/api/healthz)", () => {
    it("returns HTTP 200 and status 'ok' when database is healthy", async () => {
      const res = await request(app).get("/api/healthz");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok" });
      // Ensure no internal DB details are leaked
      expect(res.body.database_url).toBeUndefined();
      expect(res.body.connection).toBeUndefined();
    });

    it("returns HTTP 503 and sanitized status 'unavailable' when database query fails", async () => {
      const querySpy = vi.spyOn(pool, "query").mockRejectedValueOnce(new Error("Connection refused: 5432"));

      const res = await request(app).get("/api/healthz");
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ status: "unavailable" });

      // Ensure zero sensitive details, SQL errors, or stack traces leak in body
      expect(res.body.error).toBeUndefined();
      expect(res.body.stack).toBeUndefined();
      expect(res.body.message).toBeUndefined();
      expect(res.text).not.toContain("Connection refused");

      querySpy.mockRestore();
    });
  });

  describe("DEPLOY-R29-003: JWT_SECRET Production Fail-Fast", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("rejects startup when NODE_ENV=production and JWT_SECRET is unset", () => {
      process.env.NODE_ENV = "production";
      delete process.env.JWT_SECRET;

      expect(() => validateJwtConfig()).toThrow("JWT_SECRET must be configured in production");
      expect(() => getJwtSecret()).toThrow("JWT_SECRET must be configured in production");
    });

    it("rejects startup when NODE_ENV=production and JWT_SECRET is empty or whitespace", () => {
      process.env.NODE_ENV = "production";
      process.env.JWT_SECRET = "   ";

      expect(() => validateJwtConfig()).toThrow("JWT_SECRET must be configured in production");
      expect(() => getJwtSecret()).toThrow("JWT_SECRET must be configured in production");
    });

    it("accepts configuration when NODE_ENV=production and valid JWT_SECRET is provided", () => {
      process.env.NODE_ENV = "production";
      process.env.JWT_SECRET = "super-secret-prod-token-123456";

      expect(() => validateJwtConfig()).not.toThrow();
      expect(getJwtSecret()).toBe("super-secret-prod-token-123456");
    });

    it("preserves dev and test fallback when NODE_ENV is not production", () => {
      process.env.NODE_ENV = "development";
      delete process.env.JWT_SECRET;

      expect(() => validateJwtConfig()).not.toThrow();
      expect(getJwtSecret()).toBe("jwt_secret_key");
    });
  });

  describe("DEPLOY-R29-004: Graceful Shutdown", () => {
    it("drains HTTP connections and terminates DB pool cleanly on SIGTERM/SIGINT", async () => {
      let serverClosed = false;
      let poolEnded = false;
      let exitCode: number | null = null;

      const mockServer = {
        close: vi.fn((cb: any) => {
          serverClosed = true;
          cb();
        }),
      };

      const mockPool = {
        end: vi.fn(async () => {
          poolEnded = true;
        }),
      };

      const mockExit = vi.fn((code: number) => {
        exitCode = code;
      });

      const shutdown = createGracefulShutdown(mockServer as any, mockPool, mockExit as any);

      await shutdown("SIGTERM");

      expect(mockServer.close).toHaveBeenCalledTimes(1);
      expect(serverClosed).toBe(true);
      expect(mockPool.end).toHaveBeenCalledTimes(1);
      expect(poolEnded).toBe(true);
      expect(mockExit).toHaveBeenCalledWith(0);
      expect(exitCode).toBe(0);
    });

    it("is idempotent and executes shutdown sequence only once for consecutive signals", async () => {
      const mockServer = {
        close: vi.fn((cb: any) => {
          cb();
        }),
      };

      const mockPool = {
        end: vi.fn(async () => {}),
      };

      const mockExit = vi.fn();

      const shutdown = createGracefulShutdown(mockServer as any, mockPool, mockExit as any);

      // Invoke twice concurrently
      await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);

      expect(mockServer.close).toHaveBeenCalledTimes(1);
      expect(mockPool.end).toHaveBeenCalledTimes(1);
      expect(mockExit).toHaveBeenCalledTimes(1);
    });
  });
});
