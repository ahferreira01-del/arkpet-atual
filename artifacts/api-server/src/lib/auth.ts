import crypto from "crypto";
import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET ?? "jwt_secret_key";
const PASSWORD_SALT = process.env.PASSWORD_SALT ?? "pet_daycare_salt";
const BCRYPT_ROUNDS = 10;

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

export function generateToken(userId: number, role: string): string {
  const payload = `${userId}:${role}:${Date.now()}`;
  const sig = crypto.createHash("sha256").update(payload + JWT_SECRET).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64");
}

export function verifyToken(token: string): { userId: number; role: string; issuedAt: number } | null {
  try {
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const parts = decoded.split(":");
    if (parts.length < 4) return null;
    const [userId, role, timestamp, sig] = parts;
    const payload = `${userId}:${role}:${timestamp}`;
    const expectedSig = crypto.createHash("sha256").update(payload + JWT_SECRET).digest("hex");
    if (sig !== expectedSig) return null;
    return { userId: parseInt(userId), role, issuedAt: parseInt(timestamp) };
  } catch {
    return null;
  }
}
