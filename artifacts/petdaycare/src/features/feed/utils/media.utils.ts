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
