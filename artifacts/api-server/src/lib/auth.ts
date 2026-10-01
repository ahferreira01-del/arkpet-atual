import crypto from "crypto";
import bcrypt from "bcryptjs";

// Password salt is ONLY used for legacy SHA-256 fallback hash verification.
// In production, no hardcoded secret fallback is allowed (PRODUCTION_HARDCODED_SECRET_FALLBACK = 0).
const PASSWORD_SALT = process.env.PASSWORD_SALT ?? (process.env.NODE_ENV === "production" ? "" : "pet_daycare_salt");
const BCRYPT_ROUNDS = 10;

// Maximum validity period for stateful/stateless bearer auth tokens (30 days)
export const AUTH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function getJwtSecret(): string {
  const isProduction = process.env.NODE_ENV === "production";
  const rawSecret = process.env.JWT_SECRET;
  const secret = rawSecret ? rawSecret.trim() : "";

  if (isProduction && !secret) {
    throw new Error("JWT_SECRET must be configured in production");
  }

  return secret || "jwt_secret_key";
}

export function validateJwtConfig(): void {
  getJwtSecret();
}

// Legacy hashing kept ONLY to verify pre-bcrypt credentials so existing users
// are not locked out. New hashes are always bcrypt (see hashPassword).
function legacyHash(password: string): string {
  return crypto.createHash("sha256").update(password + PASSWORD_SALT).digest("hex");
}

function isBcryptHash(hash: string): boolean {
  return /^\$2[aby]\$/.test(hash);
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): boolean {
  if (isBcryptHash(hash)) {
    return bcrypt.compareSync(password, hash);
  }
  // Legacy SHA-256 fallback (constant-time compare).
  const expected = legacyHash(password);
  const a = Buffer.from(expected);
  const b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// True when a stored hash is in the legacy format and should be upgraded to
// bcrypt on the next successful login.
export function needsRehash(hash: string): boolean {
  return !isBcryptHash(hash);
}

export function generateToken(userId: number, role: string, timestampMs?: number): string {
  const secret = getJwtSecret();
  const issuedAt = timestampMs ?? Date.now();
  const payload = `${userId}:${role}:${issuedAt}`;
  const sig = crypto.createHash("sha256").update(payload + secret).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64");
}

export function verifyToken(token: string): { userId: number; role: string; issuedAt: number } | null {
  try {
    if (!token || typeof token !== "string") return null;
    const secret = getJwtSecret();
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const parts = decoded.split(":");
    if (parts.length < 4) return null;
    const [userIdStr, role, timestampStr, sig] = parts;
    if (!userIdStr || !role || !timestampStr || !sig) return null;

    const issuedAt = parseInt(timestampStr, 10);
    const userId = parseInt(userIdStr, 10);
    if (isNaN(issuedAt) || issuedAt <= 0 || isNaN(userId) || userId <= 0) return null;

    // Check expiry (JWT_EXPIRED_ACCEPTED = 0)
    // Allow up to 5 minutes of future clock skew
    const now = Date.now();
    if (now - issuedAt > AUTH_TOKEN_TTL_MS || issuedAt > now + 5 * 60 * 1000) {
      return null;
    }

    const payload = `${userId}:${role}:${timestampStr}`;
    const expectedSig = crypto.createHash("sha256").update(payload + secret).digest("hex");
    if (sig.length !== expectedSig.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;

    return { userId, role, issuedAt };
  } catch {
    return null;
  }
}
