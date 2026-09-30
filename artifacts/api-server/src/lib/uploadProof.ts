import crypto from "crypto";

export interface UploadProofPayload {
  userId: number;
  crecheId: number;
  objectPath: string;
  expiresAt: number;
  purpose: string;
}

export interface VerifyUploadProofResult {
  ok: boolean;
  payload?: UploadProofPayload;
  error?: string;
  code?: string;
}

export const UPLOAD_PROOF_DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes

export function getUploadProofSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET || process.env.ENCRYPTION_KEY;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Missing SESSION_SECRET in production environment");
    }
    return "dev_upload_proof_secret_fallback_key";
  }
  return secret;
}

/**
 * Generate a short-lived, cryptographically signed upload ownership proof.
 * Binds: userId, crecheId, objectPath, expiresAt, purpose
 * Format: `${payloadB64}.${signatureB64url}`
 */
export function generateUploadProof({
  userId,
  crecheId,
  objectPath,
  ttlMs = UPLOAD_PROOF_DEFAULT_TTL_MS,
  purpose = "chat_attachment",
}: {
  userId: number;
  crecheId: number;
  objectPath: string;
  ttlMs?: number;
  purpose?: string;
}): string {
  const expiresAt = Date.now() + ttlMs;
  const payloadObj: UploadProofPayload = {
    userId,
    crecheId,
    objectPath,
    expiresAt,
    purpose,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj), "utf-8").toString("base64url");
  const secret = getUploadProofSecret();
  const signature = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return `${payloadB64}.${signature}`;
}

/**
 * Verify upload ownership proof with constant-time signature comparison.
 */
export function verifyUploadProof(
  proofToken: string,
  expected?: {
    userId?: number;
    crecheId?: number;
    objectPath?: string;
    purpose?: string;
  }
): VerifyUploadProofResult {
  if (!proofToken || typeof proofToken !== "string") {
    return { ok: false, error: "Token de prova de upload ausente ou inválido", code: "INVALID_UPLOAD_PROOF" };
  }

  const parts = proofToken.split(".");
  if (parts.length !== 2) {
    return { ok: false, error: "Formato de prova de upload inválido", code: "INVALID_UPLOAD_PROOF" };
  }

  const [payloadB64, providedSig] = parts;
  const secret = getUploadProofSecret();
  const expectedSig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");

  // Constant-time signature verification (UPLOAD_PROOF_TIMING_SAFE_VERIFY = YES)
  const providedBuf = Buffer.from(providedSig);
  const expectedBuf = Buffer.from(expectedSig);
  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return { ok: false, error: "Assinatura da prova de upload inválida ou adulterada", code: "TAMPERED_UPLOAD_PROOF" };
  }

  let payload: UploadProofPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
  } catch {
    return { ok: false, error: "Payload da prova de upload corrompido", code: "INVALID_UPLOAD_PROOF" };
  }

  if (
    typeof payload.userId !== "number" ||
    typeof payload.crecheId !== "number" ||
    typeof payload.objectPath !== "string" ||
    typeof payload.expiresAt !== "number"
  ) {
    return { ok: false, error: "Campos obrigatórios ausentes no payload", code: "INVALID_UPLOAD_PROOF" };
  }

  if (Date.now() > payload.expiresAt) {
    return { ok: false, error: "Prova de upload expirada", code: "EXPIRED_UPLOAD_PROOF", payload };
  }

  if (expected) {
    if (expected.userId !== undefined && payload.userId !== expected.userId) {
      return { ok: false, error: "Prova de upload não pertence ao usuário autenticado", code: "USER_MISMATCH", payload };
    }
    if (expected.crecheId !== undefined && payload.crecheId !== expected.crecheId) {
      return { ok: false, error: "Prova de upload não pertence a esta creche", code: "TENANT_MISMATCH", payload };
    }
    if (expected.objectPath !== undefined && payload.objectPath !== expected.objectPath) {
      return { ok: false, error: "Prova de upload não corresponde ao arquivo informado", code: "PATH_MISMATCH", payload };
    }
    if (expected.purpose !== undefined && payload.purpose !== expected.purpose) {
      return { ok: false, error: "Finalidade da prova de upload incompatível", code: "PURPOSE_MISMATCH", payload };
    }
  }

  return { ok: true, payload };
}
