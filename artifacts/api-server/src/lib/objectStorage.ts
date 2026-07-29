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

  async downloadObject(localFilePath: string, cacheTtlSec: number = 3600): Promise<Response> {
    try {
      const stats = await fsp.stat(localFilePath);
      const nodeStream = fs.createReadStream(localFilePath);
      const webStream = Readable.toWeb(nodeStream) as ReadableStream;

      // Simplistic content-type guessing based on extension
      const ext = path.extname(localFilePath).toLowerCase();
      let contentType = "application/octet-stream";
      if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
      else if (ext === ".png") contentType = "image/png";
      else if (ext === ".webp") contentType = "image/webp";
      else if (ext === ".mp4") contentType = "video/mp4";
      else if (ext === ".webm") contentType = "video/webm";
      else if (ext === ".pdf") contentType = "application/pdf";

      const headers: Record<string, string> = {
        "Content-Type": contentType,
        "Cache-Control": `public, max-age=${cacheTtlSec}`,
        "Content-Length": String(stats.size),
      };

      return new Response(webStream, { headers });
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

  async uploadBuffer(
    buffer: Buffer,
    contentType: string,
    _ownerId?: string,
    crecheId?: string,
  ): Promise<string> {
    const uuid = randomUUID();
    const subPath = crecheId ? `uploads/c${crecheId}/${uuid}` : `uploads/${uuid}`;
    const entityDir = this.getPrivateObjectDir();
    const localFilePath = path.join(this.getAbsoluteStoragePath(entityDir), subPath);

    await fsp.mkdir(path.dirname(localFilePath), { recursive: true });
    await fsp.writeFile(localFilePath, buffer);

    return `/objects/${subPath}`;
  }
}
