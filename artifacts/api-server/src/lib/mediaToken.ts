import crypto from "crypto";

const MEDIA_SECRET = process.env.SESSION_SECRET ?? "media_secret_fallback";
const MEDIA_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Generate a short-lived media-access token for a specific user.
 * Format (base64url): "userId:crecheId:expMs:hmac"
 *
 * Unlike the main auth token this is scoped to media:read only and is
 * passed as a query-param (?mt=) so <img> / <video> tags can load private
 * objects without auth headers.
 */
export function generateMediaToken(userId: number, crecheId: number | null): string {
  const exp = Date.now() + MEDIA_TOKEN_TTL_MS;
  const payload = `${userId}:${crecheId ?? "null"}:${exp}`;
  const sig = crypto.createHmac("sha256", MEDIA_SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

export interface MediaTokenPayload {
  userId: number;
  crecheId: number | null;
}

/**
 * Verify a media token. Returns the payload if valid, or null if expired /
 * tampered / malformed.
 */
export function verifyMediaToken(token: string): MediaTokenPayload | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf-8");
    const lastColon = decoded.lastIndexOf(":");
    if (lastColon === -1) return null;

    const payload = decoded.slice(0, lastColon);
    const sig = decoded.slice(lastColon + 1);

    const expectedSig = crypto
      .createHmac("sha256", MEDIA_SECRET)
      .update(payload)
      .digest("hex");

    // Constant-time comparison to prevent timing attacks
    if (sig.length !== expectedSig.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expectedSig, "hex"))) {
      return null;
    }

    const parts = payload.split(":");
    if (parts.length < 3) return null;
    const [userIdStr, crecheIdStr, expStr] = parts;

    const exp = parseInt(expStr, 10);
    if (Number.isNaN(exp) || Date.now() > exp) return null;

    return {
      userId: parseInt(userIdStr, 10),
      crecheId: crecheIdStr === "null" ? null : parseInt(crecheIdStr, 10),
    };
  } catch {
    return null;
  }
}
