import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, crechesTable, subscriptionsTable, plansTable } from "@workspace/db/schema";
import { eq, and, gt, isNull } from "drizzle-orm";
import crypto from "crypto";
import { hashPassword, verifyPassword, generateToken, needsRehash } from "../lib/auth.js";
import { encrypt } from "../lib/crypto.js";
import { generateMediaToken } from "../lib/mediaToken.js";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate.js";
import { sendSelfSignupWelcomeEmail, sendPasswordResetEmail } from "../services/email.js";
import { passwordResetTokensTable } from "@workspace/db/schema";
import { loginLimiter, sensitiveLimiter } from "../middlewares/rateLimit.js";
import { getAppBaseUrl } from "../lib/config.js";
import { provisionTenant } from "../services/tenantProvisioning.js";

import { logger, maskEmail } from "../lib/logger.js";

const router = Router();

const TRIAL_DAYS = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);
  const passwordOk = !!user && verifyPassword(password, user.passwordHash);

  if (!user || !passwordOk) {
    logger.warn("login_failed", {
      requestId: (req as any).id,
      emailMasked: maskEmail(normalizedEmail),
      reason: "invalid_credentials",
    });
    res.status(401).json({ error: "E-mail ou senha inválidos." });
    return;
  }
  if (!user.isActive) {
    logger.warn("login_failed", {
      requestId: (req as any).id,
      userId: user.id,
      reason: "account_deactivated",
    });
    res.status(403).json({ error: "Conta desativada. Contate o administrador." });
    return;
  }

  // Block login if user belongs to an archived tenant (non-master)
  if (user.crecheId != null && user.role !== "master_admin") {
    const [creche] = await db
      .select({ status: crechesTable.status })
      .from(crechesTable)
      .where(eq(crechesTable.id, user.crecheId))
      .limit(1);

    if (creche && creche.status === "archived") {
      logger.warn("login_failed", {
        requestId: (req as any).id,
        userId: user.id,
        crecheId: user.crecheId,
        reason: "tenant_archived",
      });
      res.status(403).json({
        error: "tenant_archived",
        code: "tenant_archived",
        message: "Esta creche foi arquivada. Acesso bloqueado.",
      });
      return;
    }
  }

  // Transparently upgrade legacy SHA-256 hashes to bcrypt on successful login.
  if (needsRehash(user.passwordHash)) {
    try {
      await db.update(usersTable).set({ passwordHash: hashPassword(password) }).where(eq(usersTable.id, user.id));
    } catch (err) {
      logger.warn("password_rehash_failed", { userId: user.id });
    }
  }
  const token      = generateToken(user.id, user.role);
  const mediaToken = generateMediaToken(user.id, user.crecheId);

  logger.info("login_success", {
    requestId: (req as any).id,
    userId: user.id,
    role: user.role,
    crecheId: user.crecheId ?? undefined,
  });
  res.json({
    token,
    mediaToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      crecheId: user.crecheId,
      avatarUrl: user.avatarUrl,
      isPrimaryOwner: user.isPrimaryOwner,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt,
    },
  });
});

router.post("/register", authenticate, requireRole("master_admin"), sensitiveLimiter, async (req, res) => {
  const { name, email, password, role, crecheId, cpf, phone } = req.body;
  if (!name || !email || !password || !role) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);
  if (existing) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }
  const [user] = await db.insert(usersTable).values({
    name,
    email: normalizedEmail,
    passwordHash: hashPassword(password),
    role,
    crecheId: crecheId ?? null,
    cpf: cpf ? encrypt(cpf) : null,
    phone: phone ? encrypt(phone) : null,
  }).returning();
  const token = generateToken(user.id, user.role);
  res.status(201).json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      crecheId: user.crecheId,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
    },
  });
});

router.post("/register-creche", sensitiveLimiter, async (req, res) => {
  const { name, email, password, crecheName, crechePhone, crecheAddress, cpf, phone } = req.body;

  if (!name?.trim() || !email?.trim() || !password || !crecheName?.trim()) {
    res.status(400).json({ error: "Preencha nome, e-mail, senha e nome da creche." });
    return;
  }
  if (!EMAIL_RE.test(email)) {
    res.status(400).json({ error: "E-mail inválido." });
    return;
  }
  if (String(password).length < 6) {
    res.status(400).json({ error: "A senha deve ter no mínimo 6 caracteres." });
    return;
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);
  if (existing) {
    res.status(409).json({ error: "Este e-mail já está cadastrado." });
    return;
  }

  try {
    const result = await provisionTenant({
      name: crecheName.trim(),
      address: crecheAddress?.trim() || "",
      phone: crechePhone?.trim() || "",
      email: normalizedEmail,
      adminName: name.trim(),
      adminEmail: normalizedEmail,
      adminPassword: password,
      adminCpf: cpf || null,
      adminPhone: phone || null,
      reason: "Autocadastro público de creche (trial)",
    });

    sendSelfSignupWelcomeEmail({
      name: result.user.name,
      email: result.user.email,
      crecheName: result.creche.name,
    }).catch((err) => {
      logger.warn("welcome_email_failed", {
        requestId: (req as any).id,
        errorCode: (err as any)?.code || "EMAIL_DELIVERY_FAILED",
        crecheId: result.creche.id,
        userId: result.user.id,
      });
    });

    const token      = generateToken(result.user.id, result.user.role);
    const mediaToken = generateMediaToken(result.user.id, result.user.crecheId);
    res.status(201).json({
      token,
      mediaToken,
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: result.user.role,
        crecheId: result.user.crecheId,
        avatarUrl: result.user.avatarUrl,
        isPrimaryOwner: result.user.isPrimaryOwner,
        mustChangePassword: result.user.mustChangePassword,
        createdAt: result.user.createdAt,
      },
    });
  } catch (err: any) {
    if ((err as { code?: string })?.code === "23505") {
      res.status(409).json({ error: "Este e-mail já está cadastrado." });
      return;
    }
    const requestId = (req as any).id;
    logger.error("register_creche_failed", err, {
      requestId,
      errorCode: (err as any)?.code || "INTERNAL_PROVISIONING_ERROR",
    });
    // Never leak arbitrary err.message or driver/filesystem details to clients
    // REGISTER_CRECHE_INTERNAL_ERROR_LEAK = 0
    res.status(500).json({
      error: "Não foi possível cadastrar a creche. Tente novamente.",
      code: "INTERNAL_ERROR",
      requestId,
    });
  }
});

router.get("/me", authenticate, async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user.id)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    crecheId: user.crecheId,
    avatarUrl: user.avatarUrl,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt,
  });
});

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// Always responds 200 to avoid leaking which e-mails are registered.
router.post("/forgot-password", sensitiveLimiter, async (req, res) => {
  const { email } = req.body;
  const genericOk = { message: "Se o e-mail estiver cadastrado, enviaremos as instruções de redefinição." };

  if (!email || !EMAIL_RE.test(String(email))) {
    res.status(200).json(genericOk);
    return;
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);

    if (user && user.isActive) {
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
      try {
        await db.insert(passwordResetTokensTable).values({ userId: user.id, token, expiresAt });
        const resetLink = `${getAppBaseUrl()}/redefinir-senha?token=${token}`;
        sendPasswordResetEmail({ name: user.name, email: user.email, resetLink })
          .catch((err) =>
            logger.warn("password_reset_email_failed", {
              requestId: (req as any).id,
              userId: user.id,
              errorCode:
                typeof (err as any)?.code === "string"
                  ? (err as any).code
                  : "EMAIL_DELIVERY_FAILED",
            })
          );
        logger.info("password_reset_requested", {
          requestId: (req as any).id,
          userId: user.id,
        });
      } catch (err) {
        logger.error("forgot_password_failed", err, { requestId: (req as any).id, userId: user.id });
      }
    }

    res.status(200).json(genericOk);
  });

  router.post("/reset-password", sensitiveLimiter, async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) {
      res.status(400).json({ error: "Token e nova senha são obrigatórios." });
      return;
    }
    if (String(password).length < 6) {
      res.status(400).json({ error: "A senha deve ter no mínimo 6 caracteres." });
      return;
    }

    try {
      let claimedUserId: number | null = null;
      const now = new Date();
      await db.transaction(async (tx) => {
        // Atomically claim the token: only one concurrent request can flip
        // usedAt from NULL, so the token is strictly single-use (no TOCTOU race).
        const claimed = await tx.update(passwordResetTokensTable)
          .set({ usedAt: now })
          .where(and(
            eq(passwordResetTokensTable.token, String(token)),
            isNull(passwordResetTokensTable.usedAt),
            gt(passwordResetTokensTable.expiresAt, now),
          ))
          .returning({ userId: passwordResetTokensTable.userId });
        if (claimed.length === 0) return;
        claimedUserId = claimed[0].userId;
        // Set new password and stamp passwordChangedAt to invalidate any
        // outstanding auth tokens issued before this reset.
        await tx.update(usersTable)
          .set({ passwordHash: hashPassword(password), mustChangePassword: false, passwordChangedAt: now })
          .where(eq(usersTable.id, claimedUserId));
        // Invalidate any other outstanding reset tokens for this user.
        await tx.update(passwordResetTokensTable)
          .set({ usedAt: now })
          .where(and(
            eq(passwordResetTokensTable.userId, claimedUserId),
            isNull(passwordResetTokensTable.usedAt),
          ));
      });

      if (claimedUserId === null) {
        logger.warn("password_reset_failed", {
          requestId: (req as any).id,
          reason: "invalid_or_expired_token",
        });
        res.status(400).json({ error: "Token inválido ou expirado. Solicite uma nova redefinição." });
        return;
      }
      logger.info("password_reset_completed", {
        requestId: (req as any).id,
        userId: claimedUserId,
      });
      res.status(200).json({ message: "Senha redefinida com sucesso. Você já pode entrar." });
    } catch (err) {
      logger.error("reset_password_failed", err, { requestId: (req as any).id });
      res.status(500).json({ error: "Não foi possível redefinir a senha. Tente novamente." });
    }
  });

  /**
   * Silently refresh the caller's media token without requiring re-login.
   * The client should call this when the stored token is within 2 h of expiry.
   */
  router.get("/refresh-media-token", authenticate, async (req: AuthRequest, res) => {
    if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
    const [user] = await db.select({ id: usersTable.id, crecheId: usersTable.crecheId })
      .from(usersTable).where(eq(usersTable.id, req.user.id)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    const mediaToken = generateMediaToken(user.id, user.crecheId);
    res.json({ mediaToken });
  });

  router.post("/logout", (req, res) => {
    logger.info("logout", {
      requestId: (req as any).id,
    });
    res.json({ message: "Logged out" });
  });

  export default router;
