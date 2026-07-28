/**
 * Construct a URL that the browser can load directly in an <img> or <video>
 * tag for a private object-storage path.
 *
 * The media token (?mt=) is a short-lived credential (24h) that the storage
 * route accepts instead of an Authorization header.
 */
export function buildMediaSrc(objectPath: string, mediaToken: string): string {
  // objectPath: "/objects/uploads/uuid.webp"
  // target:     "/api/storage/objects/uploads/uuid.webp?mt=<token>"
  const withoutPrefix = objectPath.replace(/^\/objects\//, "");
  return `/api/storage/objects/${withoutPrefix}?mt=${encodeURIComponent(mediaToken)}`;
}

export function getMediaToken(): string {
  return localStorage.getItem("media_token") ?? "";
}

/**
 * Return the expiry timestamp (ms since epoch) embedded in a media token, or
 * null if the token is absent / malformed. Does NOT verify the HMAC — that is
 * the server's job. Used only to decide when to proactively refresh.
 *
 * Token format (base64url-encoded): "userId:crecheId:expMs:hmac"
 */
export function getMediaTokenExpiryMs(token: string): number | null {
  if (!token) return null;
  try {
    // base64url → utf-8
    const decoded = atob(token.replace(/-/g, "+").replace(/_/g, "/"));
    // last field is hmac; third field (index 2) is expMs
    const parts = decoded.split(":");
    if (parts.length < 4) return null;
    const exp = parseInt(parts[2], 10);
    return Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}
