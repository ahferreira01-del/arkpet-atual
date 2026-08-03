import { randomUUID } from "crypto";
import { Readable } from "stream";
import { File, Storage } from "@google-cloud/storage";
import {
  canAccessObject,
  getObjectAclPolicy,
  ObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
} from "./objectAcl.js";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

// ── GCS client — Replit sidecar external-account credentials ─────────────────
// IMPORTANT: Do NOT change this setup. The sidecar is the Replit-managed
// identity broker. The external_account flow works for READ operations.
// WRITE operations must use presigned PUT URLs via signObjectURL() below.
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

// ── Default bucket resolution ────────────────────────────────────────────────
// The env secrets (PRIVATE_OBJECT_DIR etc.) can go stale if the bucket is
// re-provisioned. The sidecar's default-bucket endpoint is the source of truth,
// so we prefer it and fall back to env vars only if it is unavailable.
let resolvedBucketId: string | null = null;
const bucketInit: Promise<void> = (async () => {
  try {
    const r = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/default-bucket`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (r.ok) {
      const j = (await r.json()) as { bucketId?: string };
      if (typeof j.bucketId === "string" && j.bucketId.length > 0) {
        resolvedBucketId = j.bucketId;
        console.log(`[objectStorage] Bucket padrão resolvido via sidecar: ${resolvedBucketId}`);
      } else {
        console.warn("[objectStorage] Sidecar não tem bucket padrão configurado; usando env vars.");
      }
    } else {
      console.warn(`[objectStorage] Sidecar default-bucket respondeu ${r.status}; usando env vars.`);
    }
  } catch {
    console.warn("[objectStorage] Sidecar default-bucket indisponível; usando env vars.");
  }
})();

// ── Error ─────────────────────────────────────────────────────────────────────
export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// ── Backward-compat re-exports ────────────────────────────────────────────────
export { ObjectPermission };
export type { ObjectAclPolicy };

// ── parseObjectPath ───────────────────────────────────────────────────────────
// Expects leading-slash paths: "/bucket/objectName"
// Works with PRIVATE_OBJECT_DIR = "/bucket-id/.private"
function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) path = `/${path}`;
  const parts = path.split("/");
  // parts[0] is "" (from leading slash), parts[1] is bucketName
  if (parts.length < 3) throw new Error("Invalid path: must contain at least a bucket name");
  const bucketName = parts[1];
  const objectName = parts.slice(2).join("/");
  return { bucketName, objectName };
}

// ── signObjectURL — always uses the sidecar, bypasses STS ────────────────────
async function signObjectURL({
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
    throw new Error(
      `Failed to sign object URL (${response.status}) — ensure you are running on Replit`,
    );
  }
  const { signed_url: signedURL } = await response.json();
  return signedURL;
}

// ── Content-type → extension helper ──────────────────────────────────────────
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
    if (resolvedBucketId) return [`/${resolvedBucketId}/public`];
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(pathsStr.split(",").map((p) => p.trim()).filter((p) => p.length > 0)),
    );
    return paths.length > 0 ? paths : [];
  }

  getPrivateObjectDir(): string {
    if (resolvedBucketId) return `/${resolvedBucketId}/.private`;
    return process.env.PRIVATE_OBJECT_DIR || "";
  }

  // ── Public-asset search ────────────────────────────────────────────────────
  async searchPublicObject(filePath: string): Promise<File | null> {
    await bucketInit;
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;
      const { bucketName, objectName } = parseObjectPath(fullPath);
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

  // ── Download — streaming, with HTTP Range support (iOS video) ─────────────
  async downloadObject(
    file: File,
    cacheTtlSec = 3600,
    range?: string,
  ): Promise<Response> {
    let metadata: Record<string, any>;
    try {
      const [meta] = await file.getMetadata();
      metadata = meta;
    } catch {
      throw new ObjectNotFoundError();
    }

    const aclPolicy = await getObjectAclPolicy(file).catch(() => null);
    const isPublic = aclPolicy?.visibility === "public";
    const contentType = (metadata.contentType as string) || "application/octet-stream";
    const fileSize = Number(metadata.size ?? 0);

    // Range request (required by Safari/iOS for video)
    if (range) {
      const match = range.match(/bytes=(\d*)-(\d*)/);
      if (match) {
        const start = match[1] !== "" ? parseInt(match[1], 10) : 0;
        const end   = match[2] !== "" ? parseInt(match[2], 10) : Math.max(0, fileSize - 1);

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
            "Cache-Control":  `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
          },
        });
      }
    }

    // Full file
    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;
    const headers: Record<string, string> = {
      "Content-Type":  contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (fileSize > 0) headers["Content-Length"] = String(fileSize);

    return new Response(webStream, { headers });
  }

  // ── Server-side buffer upload via presigned PUT (avoids STS write errors) ──
  // Used by POST /storage/uploads/direct and financial receipt uploads.
  async uploadBuffer(
    buffer: Buffer,
    contentType: string,
    _ownerId?: string,
    crecheId?: string,
  ): Promise<string> {
    const uuid    = randomUUID();
    await bucketInit;
    const ext     = extForContentType(contentType);
    const subPath = crecheId
      ? `uploads/c${crecheId}/${uuid}${ext}`
      : `uploads/${uuid}${ext}`;

    const privateDir = this.getPrivateObjectDir();
    const fullPath   = privateDir ? `${privateDir}/${subPath}` : `/${subPath}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    // Presigned PUT — goes through sidecar, bypasses STS (which fails for writes)
    const signedUrl = await signObjectURL({ bucketName, objectName, method: "PUT", ttlSec: 900 });
    const uploadRes = await fetch(signedUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: buffer,
    });
    if (!uploadRes.ok) {
      throw new Error(`GCS upload failed: ${uploadRes.status} ${uploadRes.statusText}`);
    }

    return `/objects/${subPath}`;
  }

  // ── Presigned upload URL for client-side direct-to-GCS uploads ────────────
  async getObjectEntityUploadURL(crecheId?: string): Promise<string> {
    await bucketInit;
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) throw new Error("PRIVATE_OBJECT_DIR not set");

    const uuid    = randomUUID();
    const subPath = crecheId ? `uploads/c${crecheId}/${uuid}` : `uploads/${uuid}`;
    const fullPath = `${privateObjectDir}/${subPath}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({ bucketName, objectName, method: "PUT", ttlSec: 900 });
  }

  // ── Resolve objectPath (/objects/…) → GCS File handle ────────────────────
  async getObjectEntityFile(objectPath: string): Promise<File> {
    await bucketInit;
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) throw new ObjectNotFoundError();

    const entityId = parts.slice(1).join("/"); // strip leading "objects"
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) entityDir = `${entityDir}/`;
    const fullPath = `${entityDir}${entityId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);
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

  // ── Delete via presigned URL (avoids STS write errors) ───────────────────
  async deleteObject(file: File): Promise<void> {
    try {
      // file.name is the GCS object name; file.bucket.name is the bucket
      const bucketName = (file as any).bucket?.name ?? (file as any).parent?.name ?? "";
      const objectName = file.name;
      if (!bucketName || !objectName) {
        await file.delete().catch(() => undefined);
        return;
      }
      const signedUrl = await signObjectURL({
        bucketName,
        objectName,
        method: "DELETE",
        ttlSec: 300,
      });
      await fetch(signedUrl, { method: "DELETE" }).catch(() => undefined);
    } catch {
      // ignore — object may already be gone
    }
  }

  // ── Normalize GCS signed URL → /objects/… path for DB storage ────────────
  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) return rawPath;

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname; // /bucket/.private/uploads/c3/uuid.webp

    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) entityDir = `${entityDir}/`;

    if (!rawObjectPath.startsWith(entityDir)) return rawObjectPath;

    const entityId = rawObjectPath.slice(entityDir.length); // uploads/c3/uuid.webp
    return `/objects/${entityId}`;
  }

  // ── ACL helpers ───────────────────────────────────────────────────────────
  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    await bucketInit;
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) return normalizedPath;
    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }

  // ── Signed read URL (for short-lived media tokens / CDN offloading) ────────
  async getSignedReadURL(objectPath: string, ttlSec = 300): Promise<string> {
    await bucketInit;
    try {
      if (!objectPath.startsWith("/objects/")) return `/api${objectPath}`;
      const parts = objectPath.slice(1).split("/");
      const entityId = parts.slice(1).join("/");
      let entityDir = this.getPrivateObjectDir();
      if (!entityDir.endsWith("/")) entityDir = `${entityDir}/`;
      const fullPath = `${entityDir}${entityId}`;
      const { bucketName, objectName } = parseObjectPath(fullPath);
      return await signObjectURL({ bucketName, objectName, method: "GET", ttlSec });
    } catch {
      return `/api${objectPath}`;
    }
  }
}
