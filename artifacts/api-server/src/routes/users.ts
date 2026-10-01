import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { usersTable, financialAuditLogsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate.js";
import { hashPassword } from "../lib/auth.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { logFinancialAudit } from "../services/audit.js";
import {
  acquireTenantOperationalLock,
  TenantArchivedError,
} from "../services/tenantLifecycleLock.js";
import { checkQuota, checkCreationQuota } from "../services/entitlementsService.js";
import { logger } from "../lib/logger.js";

const userRoleEnum = z.enum(["master_admin", "creche_admin", "staff", "tutor"]);

const createUserSchema = z.object({
  name: z.string().min(1, "name é obrigatório"),
  email: z.string().email("email inválido"),
  password: z.string().min(1, "password é obrigatório"),
  role: userRoleEnum,
  crecheId: z.number().int().positive().optional().nullable(),
  cpf: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email("email inválido").optional(),
  avatarUrl: z.string().url("avatarUrl inválido").optional().nullable(),
  role: userRoleEnum.optional(),
  isActive: z.boolean().optional(),
  crecheId: z.number().int().positive().optional().nullable(),
  newPassword: z.string().min(6, "senha deve ter ao menos 6 caracteres").optional(),
  cpf: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
});

const router = Router();
router.use(authenticate);

// GET users by creche (creche_admin or master_admin)
router.get("/by-creche/:crecheId", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  if (req.user?.role === "master_admin" || (req.user?.role === "creche_admin" && req.user.crecheId === crecheId)) {
    const users = await db.select({
      id: usersTable.id, name: usersTable.name, email: usersTable.email,
      role: usersTable.role, crecheId: usersTable.crecheId, avatarUrl: usersTable.avatarUrl,
      isActive: usersTable.isActive, mustChangePassword: usersTable.mustChangePassword,
      createdAt: usersTable.createdAt,
    }).from(usersTable).where(eq(usersTable.crecheId, crecheId)).orderBy(usersTable.name);
    res.json(users);
  } else {
    res.status(403).json({ error: "Sem permissão" });
  }
});

// GET all users (master_admin only)
router.get("/", requireRole("master_admin"), async (_req, res) => {
  const users = await db.select({
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    role: usersTable.role,
    crecheId: usersTable.crecheId,
    avatarUrl: usersTable.avatarUrl,
    isActive: usersTable.isActive,
    mustChangePassword: usersTable.mustChangePassword,
    createdAt: usersTable.createdAt,
  }).from(usersTable).orderBy(usersTable.createdAt);
  res.json(users);
});

// POST create user (master_admin or creche_admin)
router.post("/", requireRole("master_admin", "creche_admin"), async (req: AuthRequest, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten().fieldErrors });
    return;
  }
  const { name, email, password, role, crecheId, cpf, phone } = parsed.data;
  if (req.user?.role === "creche_admin" && !["staff", "tutor"].includes(role)) {
    res.status(403).json({ error: "Admins de creche só podem criar staff e tutores" });
    return;
  }
  const normalizedEmail = String(email).trim().toLowerCase();
  const assignedCrecheId = req.user?.role === "creche_admin" ? req.user.crecheId : (crecheId ?? null);

  try {
    const user = await db.transaction(async (tx) => {
      if (assignedCrecheId != null) {
        await acquireTenantOperationalLock(assignedCrecheId, tx);
      }

      const [existing] = await tx.select().from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);
      if (existing) {
        throw new Error("email_exists");
      }

      if (assignedCrecheId != null && ["creche_admin", "staff"].includes(role)) {
        const quota = await checkCreationQuota(tx, { crecheId: assignedCrecheId, resource: "staff", requestedDelta: 1 });
        if (!quota.allowed) {
          const err: any = new Error(quota.enforcementReason ?? `Staff limit of ${quota.limit} reached. Current active staff + invitations: ${quota.used}.`);
          err.code = "STAFF_LIMIT_EXCEEDED";
          err.statusCode = 403;
          err.current = quota.used;
          err.limit = quota.limit;
          throw err;
        }
      }

      const [newUser] = await tx.insert(usersTable).values({
        name, email: normalizedEmail,
        passwordHash: hashPassword(password),
        role, crecheId: assignedCrecheId,
        mustChangePassword: true,
        isActive: true,
        cpf: cpf ? encrypt(cpf) : null,
        phone: phone ? encrypt(phone) : null,
      }).returning();

      return newUser;
    });

    res.status(201).json({
      id: user.id, name: user.name, email: user.email, role: user.role,
      crecheId: user.crecheId, avatarUrl: user.avatarUrl, isActive: user.isActive,
      mustChangePassword: user.mustChangePassword, createdAt: user.createdAt,
    });
  } catch (err: any) {
    if (err instanceof TenantArchivedError || err?.code === "tenant_archived" || err?.message === "tenant_archived") {
      res.status(403).json({ error: "tenant_archived", code: "tenant_archived", message: "Esta creche foi arquivada. Operações desabilitadas." });
      return;
    }
    if (err?.code === "STAFF_LIMIT_EXCEEDED" || err?.statusCode === 403) {
      res.status(403).json({
        error: "STAFF_LIMIT_EXCEEDED",
        code: "STAFF_LIMIT_EXCEEDED",
        message: err.message,
        current: err.current,
        limit: err.limit,
      });
      return;
    }
    if (err.message === "email_exists") {
      res.status(409).json({ error: "Email já está em uso" });
      return;
    }
    const requestId = (req as any).id;
    logger.error("users_create_error", err, {
      requestId,
      userId: req.user?.id,
      errorCode: (err as any)?.code || "USER_CREATE_FAILED",
    });
    res.status(500).json({
      error: "Erro ao criar usuário",
      code: "INTERNAL_ERROR",
      requestId,
    });
  }
});

// GET single user
router.get("/:userId", async (req: AuthRequest, res) => {
  const userId = parseInt(String(req.params.userId));
  if (isNaN(userId) || userId <= 0) {
    res.status(400).json({ error: "ID de usuário inválido" });
    return;
  }

  const [user] = await db.select({
    id: usersTable.id, name: usersTable.name, email: usersTable.email,
    role: usersTable.role, crecheId: usersTable.crecheId, avatarUrl: usersTable.avatarUrl,
    isActive: usersTable.isActive, mustChangePassword: usersTable.mustChangePassword,
    createdAt: usersTable.createdAt,
    cpf: usersTable.cpf, phone: usersTable.phone
  }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "Usuário não encontrado" }); return; }

  const isSelf = req.user?.id === userId;
  const isMaster = req.user?.role === "master_admin";
  const isCrecheAdmin = req.user?.role === "creche_admin" && user.crecheId === req.user?.crecheId;
  const isStaff = req.user?.role === "staff" && user.crecheId === req.user?.crecheId;

  // Boundary check: self, master_admin, or same-creche staff/admin
  if (!isSelf && !isMaster && !isCrecheAdmin && !isStaff) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }

  if (isSelf || isMaster || isCrecheAdmin) {
    if (user.cpf) {
      try { user.cpf = decrypt(user.cpf); } catch { /* preserve plain if unencrypted */ }
    }
    if (user.phone) {
      try { user.phone = decrypt(user.phone); } catch { /* preserve plain if unencrypted */ }
    }
  } else {
    user.cpf = null;
    user.phone = null;
  }

  res.json(user);
});

// PUT update user
router.put("/:userId", async (req: AuthRequest, res) => {
  const userId = parseInt(String(req.params.userId));
  if (isNaN(userId) || userId <= 0) {
    res.status(400).json({ error: "ID de usuário inválido" });
    return;
  }

  const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!targetUser) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }

  const isSelf = req.user?.id === userId;
  const isMaster = req.user?.role === "master_admin";
  const isCrecheAdmin = req.user?.role === "creche_admin";

  if (!isSelf && !isMaster && !isCrecheAdmin) {
    res.status(403).json({ error: "Sem permissão" });
    return;
  }

  // Creche admin cross-tenant and target boundaries
  if (isCrecheAdmin && !isMaster) {
    if (targetUser.role === "master_admin") {
      res.status(403).json({ error: "Sem permissão para alterar master admin" });
      return;
    }
    if (!isSelf && targetUser.crecheId !== req.user?.crecheId) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
  }

  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten().fieldErrors });
    return;
  }

  const { name, email, avatarUrl, role, isActive, crecheId, newPassword, cpf, phone } = parsed.data;
  const updates: Record<string, unknown> = {};

  // Personal fields (allowed for self, creche_admin on same creche, and master_admin)
  if (name !== undefined) updates.name = name;
  if (email !== undefined) updates.email = String(email).trim().toLowerCase();
  if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;
  if (cpf !== undefined) updates.cpf = cpf ? encrypt(cpf) : null;
  if (phone !== undefined) updates.phone = phone ? encrypt(phone) : null;

  // Password reset
  if (newPassword !== undefined) {
    if (isSelf || isMaster || (isCrecheAdmin && targetUser.crecheId === req.user?.crecheId && ["staff", "tutor"].includes(targetUser.role))) {
      updates.passwordHash = hashPassword(newPassword);
      updates.mustChangePassword = false;
      updates.passwordChangedAt = new Date();
    } else {
      res.status(403).json({ error: "Sem permissão para alterar senha deste usuário" });
      return;
    }
  }

  // Administrative fields
  if (isMaster) {
    if (role !== undefined) updates.role = role;
    if (isActive !== undefined) updates.isActive = isActive;
    if (crecheId !== undefined) updates.crecheId = crecheId;
  } else if (isCrecheAdmin) {
    if (isSelf) {
      // Self creche_admin cannot escalate role or change crecheId
      if (role !== undefined && role !== targetUser.role) {
        res.status(403).json({ error: "Sem permissão para alterar própria role" });
        return;
      }
      if (crecheId !== undefined && crecheId !== targetUser.crecheId) {
        res.status(403).json({ error: "Sem permissão para alterar própria creche" });
        return;
      }
      if (isActive !== undefined) {
        updates.isActive = isActive;
      }
    } else {
      // Creche admin editing someone else in own creche
      if (targetUser.role === "creche_admin") {
        // Peer admin boundary: cannot alter role or isActive
        if (role !== undefined && role !== targetUser.role) {
          res.status(403).json({ error: "Sem permissão para alterar role de outro administrador" });
          return;
        }
        if (isActive !== undefined && isActive !== targetUser.isActive) {
          res.status(403).json({ error: "Sem permissão para alterar status de outro administrador" });
          return;
        }
      } else {
        // Target is staff or tutor: creche_admin can only assign 'staff' or 'tutor'
        if (role !== undefined) {
          if (!["staff", "tutor"].includes(role)) {
            res.status(403).json({ error: "Admins de creche só podem atribuir as funções staff e tutor" });
            return;
          }
          updates.role = role;
        }
        if (isActive !== undefined) {
          updates.isActive = isActive;
        }
      }

      if (crecheId !== undefined && crecheId !== targetUser.crecheId) {
        res.status(403).json({ error: "Sem permissão para alterar creche do usuário" });
        return;
      }
    }
  }

  try {
    const wasCounted = Boolean(targetUser.isActive && ["creche_admin", "staff"].includes(targetUser.role) && targetUser.crecheId != null);
    const effRole = updates.role !== undefined ? updates.role : targetUser.role;
    const effActive = updates.isActive !== undefined ? updates.isActive : targetUser.isActive;
    const effCrecheId = updates.crecheId !== undefined ? updates.crecheId : targetUser.crecheId;
    const willBeCounted = Boolean(effActive && ["creche_admin", "staff"].includes(effRole as string) && effCrecheId != null);

    const user = await db.transaction(async (tx) => {
      if (effCrecheId != null) {
        await acquireTenantOperationalLock(Number(effCrecheId), tx);
      }

      if (willBeCounted && (!wasCounted || targetUser.crecheId !== effCrecheId)) {
        const quota = await checkCreationQuota(tx, { crecheId: Number(effCrecheId), resource: "staff", requestedDelta: 1 });
        if (!quota.allowed) {
          const err: any = new Error(quota.enforcementReason ?? `Staff limit of ${quota.limit} reached. Current active staff + invitations: ${quota.used}.`);
          err.code = "STAFF_LIMIT_EXCEEDED";
          err.statusCode = 403;
          err.current = quota.used;
          err.limit = quota.limit;
          throw err;
        }
      }

      let updatedUser = targetUser;
      if (Object.keys(updates).length > 0) {
        const [updated] = await tx.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();
        if (updated) updatedUser = updated;
      }
      return updatedUser;
    });

    res.json({
      id: user.id, name: user.name, email: user.email, role: user.role,
      crecheId: user.crecheId, avatarUrl: user.avatarUrl, isActive: user.isActive,
      mustChangePassword: user.mustChangePassword, createdAt: user.createdAt,
    });
  } catch (err: any) {
    if (err instanceof TenantArchivedError || err?.code === "tenant_archived" || err?.message === "tenant_archived") {
      res.status(403).json({ error: "tenant_archived", code: "tenant_archived", message: "Esta creche foi arquivada. Operações desabilitadas." });
      return;
    }
    if (err?.code === "STAFF_LIMIT_EXCEEDED" || err?.statusCode === 403) {
      res.status(403).json({
        error: "STAFF_LIMIT_EXCEEDED",
        code: "STAFF_LIMIT_EXCEEDED",
        message: err.message,
        current: err.current,
        limit: err.limit,
      });
      return;
    }
    const requestId = (req as any).id;
    logger.error("users_update_error", err, {
      requestId,
      userId: req.user?.id,
      targetUserId: userId,
      errorCode: (err as any)?.code || "USER_UPDATE_FAILED",
    });
    res.status(500).json({
      error: "Erro ao atualizar usuário",
      code: "INTERNAL_ERROR",
      requestId,
    });
  }
});

// DELETE (deactivate) user
router.delete("/:userId", requireRole("master_admin", "creche_admin"), async (req: AuthRequest, res) => {
  const userId = parseInt(String(req.params.userId));
  if (isNaN(userId) || userId <= 0) {
    res.status(400).json({ error: "ID de usuário inválido" });
    return;
  }

  const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!targetUser) {
    res.status(404).json({ error: "Usuário não encontrado" });
    return;
  }

  if (req.user?.role === "creche_admin") {
    // Cannot deactivate master_admin or another creche_admin
    if (targetUser.role === "master_admin") {
      res.status(403).json({ error: "Sem permissão para desativar este usuário" });
      return;
    }
    // Tenant check
    if (targetUser.crecheId !== req.user.crecheId) {
      res.status(404).json({ error: "Usuário não encontrado" });
      return;
    }
    if (!["staff", "tutor"].includes(targetUser.role)) {
      res.status(403).json({ error: "Sem permissão para desativar este usuário" });
      return;
    }
    // Cannot deactivate self via DELETE
    if (targetUser.id === req.user.id) {
      res.status(403).json({ error: "Não é possível desativar a si mesmo" });
      return;
    }
  }

  await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, userId));
  res.json({ message: "Usuário desativado" });
});

// POST anonymize tutor (LGPD)
router.post("/:tutorId/anonymize", async (req: AuthRequest, res) => {
  const tutorId = parseInt(String(req.params.tutorId));
  if (isNaN(tutorId) || tutorId <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.id, tutorId)).limit(1);
  if (!targetUser) {
    res.status(404).json({ error: "Tutor não encontrado" });
    return;
  }

  // R13-07: Only tutors can be anonymized
  if (targetUser.role !== "tutor") {
    res.status(400).json({ error: "Apenas tutores podem ser anonimizados" });
    return;
  }

  const isSelf = req.user?.id === tutorId && req.user?.role === "tutor";
  const isCrecheAdmin = req.user?.role === "creche_admin" && targetUser.crecheId === req.user?.crecheId;

  if (!isSelf && !isCrecheAdmin) {
    res.status(403).json({ error: "Sem permissão para anonimizar este tutor" });
    return;
  }

  const crecheId = targetUser.crecheId || req.user?.crecheId || 0;

  try {
    await db.transaction(async (tx) => {
      await tx.update(usersTable)
        .set({
          name: `Tutor Anonimizado #${tutorId}`,
          email: `anonimizado_${tutorId}@arkpet.internal`,
          cpf: null,
          phone: null,
          avatarUrl: null,
          isActive: false,
        })
        .where(eq(usersTable.id, tutorId));

      await logFinancialAudit({
        crecheId,
        userId: req.user!.id,
        action: 'tutor_anonymize',
        referenceId: tutorId,
        referenceType: 'users',
        details: `Dados pessoais do tutor #${tutorId} anonimizados por solicitação LGPD. Registros financeiros preservados.`
      }, tx);
    });

    res.json({ success: true, message: "Dados anonimizados com sucesso" });
  } catch (err: any) {
    const requestId = (req as any).id;
    logger.error("tutor_anonymize_error", err, {
      requestId,
      userId: req.user?.id,
      tutorId,
      errorCode: (err as any)?.code || "TUTOR_ANONYMIZE_FAILED",
    });
    res.status(500).json({
      error: "Erro ao anonimizar tutor",
      code: "INTERNAL_ERROR",
      requestId,
    });
  }
});

export default router;
