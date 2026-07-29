import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { randomUUID } from "crypto";

// Minimal stubs for ACL to avoid breaking existing imports
export enum ObjectPermission { READ = "READ", WRITE = "WRITE" }
export interface ObjectAclPolicy { visibility?: "public" | "private" }

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "./storage";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p.length > 0)
      )
    );
    if (paths.length === 0) {
      return ["./storage"];
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    return process.env.PRIVATE_OBJECT_DIR || "./storage";
  }

  // Resolves the absolute path relative to cwd
  private getAbsoluteStoragePath(relativePath: string): string {
    const p = path.join(process.cwd(), relativePath);
    return p;
  }

  async searchPublicObject(filePath: string): Promise<string | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = path.join(this.getAbsoluteStoragePath(searchPath), filePath);
      try {
        await fsp.access(fullPath, fs.constants.R_OK);
        return fullPath;
      } catch (err) {
        // file doesn't exist in this path, continue
      }
    }
    return null;
  }

  /**
   * Guess content-type from file extension.
   */
  private getContentType(localFilePath: string): string {
    const ext = path.extname(localFilePath).toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".png")  return "image/png";
    if (ext === ".webp") return "image/webp";
    if (ext === ".mp4")  return "video/mp4";
    if (ext === ".mov")  return "video/mp4";   // Safari plays .mov best as video/mp4
    if (ext === ".webm") return "video/webm";
    if (ext === ".pdf")  return "application/pdf";
    return "application/octet-stream";
  }

  /**
   * Serve a file from the local filesystem, honouring HTTP Range requests
   * (required by Safari / iOS for video playback).
   *
   * @param range  Value of the incoming `Range` header, e.g. "bytes=0-1023"
   */
  async downloadObject(
    localFilePath: string,
    cacheTtlSec: number = 3600,
    range?: string,
  ): Promise<Response> {
    try {
      const stats = await fsp.stat(localFilePath);
      const contentType = this.getContentType(localFilePath);
      const fileSize = stats.size;

      // ── Range request (Safari / iOS video) ───────────────────────────────
      if (range) {
        const match = range.match(/bytes=(\d*)-(\d*)/);
        if (match) {
          const start = match[1] !== "" ? parseInt(match[1], 10) : 0;
          const end   = match[2] !== "" ? parseInt(match[2], 10) : fileSize - 1;

          if (start > end || end >= fileSize) {
            // Unsatisfiable range
            return new Response(null, {
              status: 416,
              headers: { "Content-Range": `bytes */${fileSize}` },
            });
          }

          const chunkSize = end - start + 1;
          const nodeStream = fs.createReadStream(localFilePath, { start, end });
          const webStream  = Readable.toWeb(nodeStream) as ReadableStream;

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

      // ── Full file ─────────────────────────────────────────────────────────
      const nodeStream = fs.createReadStream(localFilePath);
      const webStream  = Readable.toWeb(nodeStream) as ReadableStream;

      return new Response(webStream, {
        headers: {
          "Content-Type":   contentType,
          "Accept-Ranges":  "bytes",
          "Content-Length": String(fileSize),
          "Cache-Control":  `public, max-age=${cacheTtlSec}`,
        },
      });
    } catch (err) {
      throw new ObjectNotFoundError();
    }
  }

  async getObjectEntityUploadURL(crecheId?: string): Promise<string> {
    // This is essentially unused now since we use direct uploads, but keep interface
    const uuid = randomUUID();
    const subPath = crecheId ? `uploads/c${crecheId}/${uuid}` : `uploads/${uuid}`;
    return `/api/storage/objects/${subPath}`;
  }

  async getSignedReadURL(objectPath: string, ttlSec: number = 300): Promise<string> {
    // We don't use real signed URLs. The frontend uses standard auth or ?mt=
    // So we just return the endpoint to fetch the object.
    return `/api${objectPath}`;
  }

  async getObjectEntityFile(objectPath: string): Promise<string> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }
    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    const localFilePath = path.join(this.getAbsoluteStoragePath(entityDir), entityId);

    try {
      await fsp.access(localFilePath, fs.constants.R_OK);
      return localFilePath;
    } catch {
      throw new ObjectNotFoundError();
    }
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("http")) {
      return rawPath;
    }
    const url = new URL(rawPath);
    return url.pathname.replace("/api/storage", "");
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    // No-op for local fs
    return this.normalizeObjectEntityPath(rawPath);
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: string;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    // We rely on path-based ACL in storage.ts for the actual authorization now.
    return true;
  }

  async deleteObject(localFilePath: string): Promise<void> {
    try {
      await fsp.unlink(localFilePath);
    } catch (err) {
      // ignore
    }
  }

  /** Map MIME type → file extension so the file can be served with the right Content-Type. */
  private extForContentType(contentType: string): string {
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

  async uploadBuffer(
    buffer: Buffer,
    contentType: string,
    _ownerId?: string,
    crecheId?: string,
  ): Promise<string> {
    const uuid    = randomUUID();
    const ext     = this.extForContentType(contentType);
    const subPath = crecheId
      ? `uploads/c${crecheId}/${uuid}${ext}`
      : `uploads/${uuid}${ext}`;
    const entityDir   = this.getPrivateObjectDir();
    const localFilePath = path.join(this.getAbsoluteStoragePath(entityDir), subPath);

    await fsp.mkdir(path.dirname(localFilePath), { recursive: true });
    await fsp.writeFile(localFilePath, buffer);

    return `/objects/${subPath}`;
  }
}
