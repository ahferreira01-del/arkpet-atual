import { randomUUID } from "crypto";
import { Readable } from "stream";
import { File, Storage } from "@google-cloud/storage";

// ── Minimal ACL stubs kept for backward-compat imports ───────────────────────
export enum ObjectPermission { READ = "READ", WRITE = "WRITE" }
export interface ObjectAclPolicy { visibility?: "public" | "private" }

// ── Sidecar-authenticated GCS client ─────────────────────────────────────────
const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: { type: "json", subject_token_field_name: "access_token" },
    },
    universe_domain: "googleapis.com",
  } as any,
  projectId: "",
});

// ── Error ─────────────────────────────────────────────────────────────────────
export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseGcsPath(fullPath: string): { bucketName: string; objectName: string } {
  // Handles: gs://bucket/path, /bucket/path, bucket/path
  const cleaned = fullPath.replace(/^gs:\/\//, "").replace(/^\//, "");
  const slash = cleaned.indexOf("/");
  if (slash === -1) return { bucketName: cleaned, objectName: "" };
  return {
    bucketName: cleaned.slice(0, slash),
    objectName: cleaned.slice(slash + 1),
  };
}

async function signGcsUrl({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket_name: bucketName,
        object_name: objectName,
        method,
        expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to sign GCS URL (${response.status})`);
  }
  const { signed_url } = await response.json();
  return signed_url;
}

/** Map content-type → file extension */
function extForContentType(contentType: string): string {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg":      ".jpg",
    "image/jpg":       ".jpg",
    "image/png":       ".png",
    "image/webp":      ".webp",
    "video/mp4":       ".mp4",
    "video/quicktime": ".mov",
    "video/webm":      ".webm",
    "application/pdf": ".pdf",
  };
  return map[mime] ?? "";
}

// ── ObjectStorageService ──────────────────────────────────────────────────────
export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): string[] {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(pathsStr.split(",").map((p) => p.trim()).filter((p) => p.length > 0))
    );
    return paths.length > 0 ? paths : [];
  }

  getPrivateObjectDir(): string {
    return process.env.PRIVATE_OBJECT_DIR || "";
  }

  // ── Public-object search (for /storage/public-objects/* route) ────────────
  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;
      const { bucketName, objectName } = parseGcsPath(fullPath);
      const file = objectStorageClient.bucket(bucketName).file(objectName);
      try {
        const [exists] = await file.exists();
        if (exists) return file;
      } catch {
        // try next path
      }
    }
    return null;
  }

  // ── Download (streaming, with HTTP Range support for Safari/iOS video) ─────
  async downloadObject(
    file: File,
    cacheTtlSec: number = 3600,
    range?: string,
  ): Promise<Response> {
    let metadata: Record<string, any>;
    try {
      const [meta] = await file.getMetadata();
      metadata = meta;
    } catch {
      throw new ObjectNotFoundError();
    }

    const contentType = (metadata.contentType as string) || "application/octet-stream";
    const fileSize = Number(metadata.size ?? 0);

    // ── Range request (required by Safari / iOS for video) ──────────────────
    if (range) {
      const match = range.match(/bytes=(\d*)-(\d*)/);
      if (match) {
        const start = match[1] !== "" ? parseInt(match[1], 10) : 0;
        const end   = match[2] !== "" ? parseInt(match[2], 10) : fileSize - 1;

        if (fileSize > 0 && (start > end || end >= fileSize)) {
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": `bytes */${fileSize}` },
          });
        }

        const chunkSize = end - start + 1;
        const nodeStream = file.createReadStream({ start, end });
        const webStream = Readable.toWeb(nodeStream) as ReadableStream;

        return new Response(webStream, {
          status: 206,
          headers: {
            "Content-Type":   contentType,
            "Content-Range":  `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges":  "bytes",
            "Content-Length": String(chunkSize),
            "Cache-Control":  `public, max-age=${cacheTtlSec}`,
          },
        });
      }
    }

    // ── Full file ────────────────────────────────────────────────────────────
    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type":  contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": `public, max-age=${cacheTtlSec}`,
    };
    if (fileSize > 0) headers["Content-Length"] = String(fileSize);

    return new Response(webStream, { headers });
  }

  // ── Upload a buffer directly to GCS (used by feed, financial, migrate) ─────
  async uploadBuffer(
    buffer: Buffer,
    contentType: string,
    _ownerId?: string,
    crecheId?: string,
  ): Promise<string> {
    const uuid    = randomUUID();
    const ext     = extForContentType(contentType);
    const subPath = crecheId
      ? `uploads/c${crecheId}/${uuid}${ext}`
      : `uploads/${uuid}${ext}`;

    const privateDir = this.getPrivateObjectDir();
    const fullPath   = privateDir ? `${privateDir}/${subPath}` : subPath;
    const { bucketName, objectName } = parseGcsPath(fullPath);

    const gcsFile = objectStorageClient.bucket(bucketName).file(objectName);
    await gcsFile.save(buffer, {
      contentType,
      resumable: false,
      metadata: { cacheControl: "public, max-age=3600" },
    });

    return `/objects/${subPath}`;
  }

  // ── Resolve an objectPath (/objects/…) → GCS File handle ─────────────────
  async getObjectEntityFile(objectPath: string): Promise<File> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const relPath    = objectPath.slice("/objects/".length);
    const privateDir = this.getPrivateObjectDir();
    const fullPath   = privateDir ? `${privateDir}/${relPath}` : relPath;
    const { bucketName, objectName } = parseGcsPath(fullPath);

    const file = objectStorageClient.bucket(bucketName).file(objectName);
    try {
      const [exists] = await file.exists();
      if (!exists) throw new ObjectNotFoundError();
    } catch (err) {
      if (err instanceof ObjectNotFoundError) throw err;
      throw new ObjectNotFoundError();
    }
    return file;
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  async deleteObject(file: File): Promise<void> {
    try {
      await file.delete();
    } catch {
      // ignore — object may already be gone
    }
  }

  // ── Presigned upload URL for client-side direct uploads ───────────────────
  async getObjectEntityUploadURL(crecheId?: string): Promise<string> {
    const uuid    = randomUUID();
    const subPath = crecheId ? `uploads/c${crecheId}/${uuid}` : `uploads/${uuid}`;

    const privateDir = this.getPrivateObjectDir();
    const fullPath   = privateDir ? `${privateDir}/${subPath}` : subPath;
    const { bucketName, objectName } = parseGcsPath(fullPath);

    return signGcsUrl({ bucketName, objectName, method: "PUT", ttlSec: 900 });
  }

  // ── Signed read URL (for short-lived media tokens) ────────────────────────
  async getSignedReadURL(objectPath: string, ttlSec: number = 300): Promise<string> {
    if (!objectPath.startsWith("/objects/")) return `/api${objectPath}`;
    const relPath    = objectPath.slice("/objects/".length);
    const privateDir = this.getPrivateObjectDir();
    const fullPath   = privateDir ? `${privateDir}/${relPath}` : relPath;
    const { bucketName, objectName } = parseGcsPath(fullPath);
    try {
      return await signGcsUrl({ bucketName, objectName, method: "GET", ttlSec });
    } catch {
      return `/api${objectPath}`;
    }
  }

  // ── Path normalization ────────────────────────────────────────────────────
  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("http")) return rawPath;
    const url = new URL(rawPath);
    return url.pathname.replace("/api/storage", "");
  }

  // ── ACL (no-op — access is enforced by path-based auth in storage.ts) ─────
  async trySetObjectEntityAclPolicy(
    rawPath: string,
    _aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    return this.normalizeObjectEntityPath(rawPath);
  }

  async canAccessObjectEntity(_opts: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return true;
  }
}
