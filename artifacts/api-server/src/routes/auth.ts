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
  console.log(`[login] email="${normalizedEmail}" userFound=${!!user} passwordOk=${passwordOk} ua="${String(req.headers["user-agent"] ?? "").slice(0, 80)}"`);
  if (!user || !passwordOk) {
    res.status(401).json({ error: "E-mail ou senha inválidos." });
    return;
  }
  if (!user.isActive) {
    res.status(403).json({ error: "Conta desativada. Contate o administrador." });
    return;
  }
  // Transparently upgrade legacy SHA-256 hashes to bcrypt on successful login.
  if (needsRehash(user.passwordHash)) {
    try {
      await db.update(usersTable).set({ passwordHash: hashPassword(password) }).where(eq(usersTable.id, user.id));
    } catch (err) {
      console.error("[auth] password rehash failed:", err);
    }
  }
  const token      = generateToken(user.id, user.role);
  const mediaToken = generateMediaToken(user.id, user.crecheId);
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

  const [trialPlan] = await db.select().from(plansTable).where(eq(plansTable.name, "Trial")).limit(1);
  if (!trialPlan) {
    res.status(500).json({ error: "Plano de trial não configurado. Contate o suporte." });
    return;
  }

  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  try {
    const result = await db.transaction(async (tx) => {
      const [user] = await tx.insert(usersTable).values({
        name: name.trim(),
        email: normalizedEmail,
        passwordHash: hashPassword(password),
        role: "creche_admin",
        mustChangePassword: false,
        isActive: true,
        cpf: cpf ? encrypt(cpf) : null,
        phone: phone ? encrypt(phone) : null,
      }).returning();

      const [creche] = await tx.insert(crechesTable).values({
        name: crecheName.trim(),
        address: crecheAddress?.trim() || "",
        phone: crechePhone?.trim() || "",
        email: normalizedEmail,
        adminId: user.id,
        status: "active",
      }).returning();

      const [updatedUser] = await tx.update(usersTable)
        .set({ crecheId: creche.id })
        .where(eq(usersTable.id, user.id))
        .returning();

      const [subscription] = await tx.insert(subscriptionsTable).values({
        crecheId: creche.id,
        planId: trialPlan.id,
        status: "trial",
        trialEndsAt,
      }).returning();

      return { user: updatedUser, creche, subscription };
    });

    sendSelfSignupWelcomeEmail({
      name: result.user.name,
      email: result.user.email,
      crecheName: result.creche.name,
    }).catch((err) => console.error("[auth] welcome email failed:", err));

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
        mustChangePassword: result.user.mustChangePassword,
        createdAt: result.user.createdAt,
      },
    });
  } catch (err) {
    // Handle the race where two concurrent signups pass the email precheck and
    // collide on the users.email unique constraint (Postgres 23505).
    if ((err as { code?: string })?.code === "23505") {
      res.status(409).json({ error: "Este e-mail já está cadastrado." });
      return;
    }
    console.error("[auth] register-creche failed:", err);
    res.status(500).json({ error: "Não foi possível concluir o cadastro. Tente novamente." });
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
        .catch((err) => console.error("[auth] reset email failed:", err));
    } catch (err) {
      console.error("[auth] forgot-password failed:", err);
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
      res.status(400).json({ error: "Token inválido ou expirado. Solicite uma nova redefinição." });
      return;
    }
    res.status(200).json({ message: "Senha redefinida com sucesso. Você já pode entrar." });
  } catch (err) {
    console.error("[auth] reset-password failed:", err);
    res.status(500).json({ error: "Não foi possível redefinir a senha. Tente novamente." });
  }
});

router.post("/logout", (_req, res) => {
  res.json({ message: "Logged out" });
});

export default router;
