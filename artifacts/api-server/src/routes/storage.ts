import { Router, raw, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import { crechesTable, usersTable, storageFilesTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage.js";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { verifyMediaToken } from "../lib/mediaToken.js";
import { validateUpload } from "../middlewares/validateUpload.js";
import {
  parseCanonicalPrivateObjectPath,
  canUserAccessPrivateResource,
} from "../lib/objectAuthorization.js";
import {
  acquireTenantOperationalLock,
  TenantArchivedError,
} from "../services/tenantLifecycleLock.js";
import {
  createStorageReservation,
  confirmStorageReservation,
  claimStorageFileForDeletion,
  finalizeStorageFileDeletion,
  checkCreationQuota,
  resolveStorageEnforcementMode,
  EntitlementsError,
} from "../services/entitlementsService.js";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * Resolves and validates target crecheId for storage upload requests.
 * - master_admin: Requires ?crecheId=<id> pointing to an existing creche.
 * - tutor / staff / creche_admin: Strictly bound to user's assigned session crecheId.
 */
async function resolveUploadCrecheId(
  req: AuthRequest,
  res: Response
): Promise<{ ok: boolean; crecheId?: string }> {
  if (!req.user) {
    res.status(401).json({ error: "Não autenticado" });
    return { ok: false };
  }

  if (req.user.role === "master_admin") {
    const rawParam = req.query["crecheId"];
    const qCreche = rawParam ? parseInt(String(rawParam), 10) : NaN;
    if (Number.isNaN(qCreche) || qCreche <= 0) {
      res.status(400).json({ error: "crecheId é obrigatório para upload por master_admin" });
      return { ok: false };
    }

    const [targetCreche] = await db
      .select({ id: crechesTable.id })
      .from(crechesTable)
      .where(eq(crechesTable.id, qCreche))
      .limit(1);

    if (!targetCreche) {
      res.status(404).json({ error: "Creche de destino não encontrada" });
      return { ok: false };
    }

    return { ok: true, crecheId: String(targetCreche.id) };
  }

  if (req.user.crecheId != null && req.user.crecheId > 0) {
    const [targetCreche] = await db
      .select({ id: crechesTable.id, status: crechesTable.status })
      .from(crechesTable)
      .where(eq(crechesTable.id, req.user.crecheId))
      .limit(1);

    if (targetCreche && targetCreche.status === "archived") {
      res.status(403).json({
        error: "tenant_archived",
        code: "tenant_archived",
        message: "Esta creche foi arquivada. Uploads desabilitados.",
      });
      return { ok: false };
    }

    return { ok: true, crecheId: String(req.user.crecheId) };
  }

  res.status(403).json({ error: "Usuário não possui creche associada" });
  return { ok: false };
}

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

  const resolved = await resolveUploadCrecheId(req, res);
  if (!resolved.ok || !resolved.crecheId) return;

  res.status(501).json({
    error: "PRESIGNED_UPLOAD_REPLAY_UNSAFE",
    code: "PRESIGNED_UPLOAD_REPLAY_UNSAFE",
    message: "Presigned upload is unavailable with the current storage provider.",
  });
});

/**
 * POST /storage/uploads/direct
 *
 * Upload a file directly through the API server to object storage with atomic 3-phase accounting:
 * Phase A: Reserve quota inside operational lock
 * Phase B: Upload buffer to physical storage
 * Phase C: Confirm reservation inside operational lock
 */
router.post("/storage/uploads/direct", authenticate, validateUpload, raw({ type: "*/*", limit: "100mb" }), async (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }

  const resolved = await resolveUploadCrecheId(req, res);
  if (!resolved.ok || !resolved.crecheId) return;

  const crecheId = Number(resolved.crecheId);

  try {
    const contentType = (req.headers["content-type"] as string) || "application/octet-stream";
    const buffer = req.body as Buffer;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      res.status(400).json({ error: "Arquivo vazio ou inválido" });
      return;
    }

    const sizeBytes = buffer.length;
    const mode = resolveStorageEnforcementMode();

    // Phase A: Reservation inside operational lock (OPEN-C-01 / R38.C5)
    const { file: reservedFile, quota } = await db.transaction(async (tx) => {
      await acquireTenantOperationalLock(crecheId, tx);
      const quota = await checkCreationQuota(tx, {
        crecheId,
        resource: "storage",
        requestedDelta: sizeBytes,
      });

      if (mode === "ENFORCE" && !quota.allowed && !quota.enforcementBypassed) {
        throw new EntitlementsError(
          "ERR_STORAGE_QUOTA_EXCEEDED",
          `Storage quota exceeded. Requested: ${sizeBytes} bytes, Available: ${quota.availableBytes ?? 0} bytes.`,
          403,
        );
      }

      const resResult = await createStorageReservation(tx, {
        crecheId,
        fileKey: `res_${randomUUID()}`,
        requestedBytes: sizeBytes,
        contentType,
        enforceHardLimit: mode === "ENFORCE",
      });

      return { file: resResult.file, quota };
    });

    // Phase B: Upload to physical storage (outside lock / DB tx)
    const objectPath = await objectStorageService.uploadBuffer(buffer, contentType, String(req.user.id), String(crecheId));

    // Phase C: Confirmation inside operational lock
    await db.transaction(async (tx) => {
      await acquireTenantOperationalLock(crecheId, tx);
      await tx
        .update(storageFilesTable)
        .set({ fileKey: objectPath })
        .where(eq(storageFilesTable.id, reservedFile.id));

      await confirmStorageReservation(tx, reservedFile.id, sizeBytes);
    });

    const effectiveLimit = quota.effectiveLimit ?? quota.limitBytes ?? quota.limit ?? null;
    const isWarning80 =
      effectiveLimit !== null &&
      effectiveLimit > 0 &&
      (quota.warning80 || (Number(quota.effectiveUsedBytes ?? quota.used ?? 0) + sizeBytes) >= Math.floor((effectiveLimit * 80) / 100));

    if (isWarning80 && (mode === "SHADOW" || mode === "ENFORCE")) {
      res.setHeader("X-ArkPet-Storage-Warning", "true");
    }

    res.json({ objectPath });
  } catch (err: any) {
    if (err instanceof TenantArchivedError || err?.code === "tenant_archived" || err?.message === "tenant_archived") {
      res.status(403).json({ error: "tenant_archived", code: "tenant_archived", message: "Esta creche foi arquivada. Uploads desabilitados." });
      return;
    }
    if (err instanceof EntitlementsError || err?.code === "ERR_STORAGE_QUOTA_EXCEEDED" || err?.message?.includes("Storage quota exceeded")) {
      res.status(403).json({
        error: "STORAGE_QUOTA_EXCEEDED",
        code: "STORAGE_QUOTA_EXCEEDED",
        message: err.message,
      });
      return;
    }
    console.error("Error uploading file directly", err);
    res.status(500).json({ error: "Failed to upload file", message: err.message });
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

    const response = await objectStorageService.downloadObject(file, 3600, req.headers.range);

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

    // Load full user identity for authenticated user
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, payload.userId))
      .limit(1);

    if (!user || user.isActive === false) {
      res.status(401).json({ error: "Não autenticado" });
      return;
    }

    req.user = {
      id: user.id,
      role: user.role,
      crecheId: user.crecheId,
      name: user.name,
      email: user.email,
    };
  } else {
    // Fall through to standard Bearer authentication
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Não autenticado" });
      return;
    }

    const { verifyToken } = await import("../lib/auth.js");
    const token = authHeader.slice(7);
    const tokenPayload = verifyToken(token);
    if (!tokenPayload) {
      res.status(401).json({ error: "Token inválido" });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, tokenPayload.userId))
      .limit(1);

    if (!user || user.isActive === false) {
      res.status(401).json({ error: "Não autenticado" });
      return;
    }

    req.user = {
      id: user.id,
      role: user.role,
      crecheId: user.crecheId,
      name: user.name,
      email: user.email,
    };
  }

  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;

    // Strict canonical path parse
    const parsed = parseCanonicalPrivateObjectPath(wildcardPath);
    if (!parsed.ok || !parsed.pathCrecheId || !parsed.canonicalObjectPath) {
      res.status(403).json({ error: "Caminho de arquivo inválido ou não autorizado" });
      return;
    }

    const { pathCrecheId, canonicalObjectPath } = parsed;

    // Cross-tenant gate
    if (req.user.role !== "master_admin" && req.user.crecheId !== pathCrecheId) {
      res.status(403).json({ error: "Sem acesso a este arquivo" });
      return;
    }

    // Resource-aware authorization check
    const hasAccess = await canUserAccessPrivateResource({
      canonicalObjectPath,
      pathCrecheId,
      user: req.user,
    });

    if (!hasAccess) {
      res.status(403).json({ error: "Sem acesso a este arquivo" });
      return;
    }

    const objectFile = await objectStorageService.getObjectEntityFile(canonicalObjectPath);
    const response = await objectStorageService.downloadObject(objectFile, 3600, req.headers.range);

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
      res.status(404).json({ error: "Object not found" });
      return;
    }
    console.error("Error serving object", error);
    res.status(500).json({ error: "Failed to serve object" });
  }
});

/**
 * DELETE /storage/objects/*path
 *
 * Deletes an object with CAS state management:
 * 1. CAS transition 'confirmed' -> 'deleting' in DB under operational lock
 * 2. Physical delete from object storage
 * 3. Finalize CAS transition 'deleting' -> 'deleted' and decrement ledger under operational lock
 */
router.delete("/storage/objects/*path", authenticate, async (req: AuthRequest, res: Response) => {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }

  const raw = req.params.path;
  const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;

  const parsed = parseCanonicalPrivateObjectPath(wildcardPath);
  if (!parsed.ok || !parsed.pathCrecheId || !parsed.canonicalObjectPath) {
    res.status(403).json({ error: "Caminho de arquivo inválido ou não autorizado" });
    return;
  }

  const { pathCrecheId, canonicalObjectPath } = parsed;

  if (req.user.role !== "master_admin" && req.user.crecheId !== pathCrecheId) {
    res.status(403).json({ error: "Sem acesso a este arquivo" });
    return;
  }

  try {
    // 1. Look up tracked file in storage_files
    const [storageFile] = await db
      .select()
      .from(storageFilesTable)
      .where(
        and(
          eq(storageFilesTable.crecheId, pathCrecheId),
          eq(storageFilesTable.fileKey, canonicalObjectPath),
        ),
      )
      .limit(1);

    if (storageFile && storageFile.status === "confirmed") {
      // Step 1: Claim for deletion under operational lock
      await db.transaction(async (tx) => {
        await acquireTenantOperationalLock(pathCrecheId, tx);
        await claimStorageFileForDeletion(tx, storageFile.id);
      });

      // Step 2: Physical deletion
      try {
        const objectFile = await objectStorageService.getObjectEntityFile(canonicalObjectPath);
        await objectStorageService.deleteObject(objectFile);
      } catch (err: any) {
        if (!(err instanceof ObjectNotFoundError)) {
          console.error("Physical storage delete error (ignoring for idempotency):", err);
        }
      }

      // Step 3: Finalize deletion under operational lock
      await db.transaction(async (tx) => {
        await acquireTenantOperationalLock(pathCrecheId, tx);
        await finalizeStorageFileDeletion(tx, storageFile.id);
      });
    } else {
      // Legacy untracked file or already deleted: physical delete if file exists
      try {
        const objectFile = await objectStorageService.getObjectEntityFile(canonicalObjectPath);
        await objectStorageService.deleteObject(objectFile);
      } catch (err: any) {
        // Idempotent 404
      }
    }

    res.json({ ok: true, message: "Arquivo excluído com sucesso" });
  } catch (err: any) {
    if (err instanceof TenantArchivedError || err?.code === "tenant_archived" || err?.message === "tenant_archived") {
      res.status(403).json({ error: "tenant_archived", code: "tenant_archived", message: "Esta creche foi arquivada. Operações desabilitadas." });
      return;
    }
    console.error("Error deleting storage object", err);
    res.status(500).json({ error: "Failed to delete file", message: err.message });
  }
});

export default router;
