import crypto from "crypto";

export function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "pet_daycare_salt").digest("hex");
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

export function generateToken(userId: number, role: string): string {
  const payload = `${userId}:${role}:${Date.now()}`;
  const sig = crypto.createHash("sha256").update(payload + "jwt_secret_key").digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64");
}

export function verifyToken(token: string): { userId: number; role: string } | null {
  try {
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const parts = decoded.split(":");
    if (parts.length < 4) return null;
    const [userId, role, timestamp, sig] = parts;
    const payload = `${userId}:${role}:${timestamp}`;
    const expectedSig = crypto.createHash("sha256").update(payload + "jwt_secret_key").digest("hex");
    if (sig !== expectedSig) return null;
    return { userId: parseInt(userId), role };
  } catch {
    return null;
  }
}
