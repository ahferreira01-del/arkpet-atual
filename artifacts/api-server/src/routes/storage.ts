import { Router, raw, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage.js";
import { ObjectPermission } from "../lib/objectAcl.js";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { verifyMediaToken } from "../lib/mediaToken.js";
import { validateUpload } from "../middlewares/validateUpload.js";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 */
router.post("/storage/uploads/request-url", authenticate, async (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    console.error("Error generating upload URL", error);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * POST /storage/uploads/direct
 *
 * Upload a file directly through the API server to object storage.
 * Avoids the sidecar-signed URL (which returns 401 in production).
 * Client sends the raw file bytes as the request body with Content-Type set.
 */
router.post("/storage/uploads/direct", authenticate, validateUpload, raw({ type: "*/*", limit: "100mb" }), async (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }
  try {
    const contentType = (req.headers["content-type"] as string) || "application/octet-stream";
    const buffer = req.body as Buffer;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      res.status(400).json({ error: "Arquivo vazio ou inválido" });
      return;
    }
    const crecheId = req.user.crecheId != null ? String(req.user.crecheId) : undefined;
    const objectPath = await objectStorageService.uploadBuffer(buffer, contentType, String(req.user.id), crecheId);
    res.json({ objectPath });
  } catch (err) {
    console.error("Error uploading file directly", err);
    res.status(500).json({ error: "Failed to upload file" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    console.error("Error serving public object", error);
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * Accepts authentication via:
 *   1. Authorization: Bearer <accessToken>  (standard API auth)
 *   2. ?mt=<mediaToken>                     (for <img>/<video> tags in the
 *                                            feed that cannot send headers)
 */
router.get("/storage/objects/*path", async (req: AuthRequest, res: Response) => {
  // --- Auth: Bearer header OR ?mt= media token ---
  const mtParam = req.query["mt"];
  if (mtParam && typeof mtParam === "string") {
    const payload = verifyMediaToken(mtParam);
    if (!payload) {
      res.status(401).json({ error: "Token de mídia inválido ou expirado" });
      return;
    }
    // Attach a minimal user object so downstream ACL checks work
    req.user = { id: payload.userId, role: "media_reader", crecheId: payload.crecheId, name: "", email: "" };
  } else {
    // Fall through to standard Bearer authentication
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Não autenticado" });
      return;
    }
    // Reuse the authenticate middleware logic inline to avoid async middleware chaining
    const { verifyToken } = await import("../lib/auth.js");
    const token = authHeader.slice(7);
    const tokenPayload = verifyToken(token);
    if (!tokenPayload) {
      res.status(401).json({ error: "Token inválido" });
      return;
    }
    const { db: dbConn } = await import("@workspace/db");
    const { usersTable } = await import("@workspace/db/schema");
    const { eq } = await import("drizzle-orm");
    const [user] = await dbConn.select().from(usersTable).where(eq(usersTable.id, tokenPayload.userId)).limit(1);
    if (!user || user.isActive === false) {
      res.status(401).json({ error: "Não autenticado" });
      return;
    }
    req.user = { id: user.id, role: user.role, crecheId: user.crecheId, name: user.name, email: user.email };
  }

  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    // --- Protected route ---
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    
    const canAccess = await objectStorageService.canAccessObjectEntity({
      userId: String(req.user.id),
      objectFile,
      requestedPermission: ObjectPermission.READ,
    });
    if (!canAccess) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    // ------------------------------------------------------------------
    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      console.warn("Object not found", error);
      res.status(404).json({ error: "Object not found" });
      return;
    }
    console.error("Error serving object", error);
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
