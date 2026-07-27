import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { usersTable, financialAuditLogsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate.js";
import { hashPassword } from "../lib/auth.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import { logFinancialAudit } from "../services/audit.js";

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
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);
  if (existing) {
    res.status(409).json({ error: "Email já está em uso" });
    return;
  }
  const assignedCrecheId = req.user?.role === "creche_admin" ? req.user.crecheId : (crecheId ?? null);
  const [user] = await db.insert(usersTable).values({
    name, email: normalizedEmail,
    passwordHash: hashPassword(password),
    role, crecheId: assignedCrecheId,
    mustChangePassword: true,
    isActive: true,
    cpf: cpf ? encrypt(cpf) : null,
    phone: phone ? encrypt(phone) : null,
  }).returning();
  res.status(201).json({
    id: user.id, name: user.name, email: user.email, role: user.role,
    crecheId: user.crecheId, avatarUrl: user.avatarUrl, isActive: user.isActive,
    mustChangePassword: user.mustChangePassword, createdAt: user.createdAt,
  });
});

// GET single user
router.get("/:userId", async (req: AuthRequest, res) => {
  const userId = parseInt(String(req.params.userId));
  const [user] = await db.select({
    id: usersTable.id, name: usersTable.name, email: usersTable.email,
    role: usersTable.role, crecheId: usersTable.crecheId, avatarUrl: usersTable.avatarUrl,
    isActive: usersTable.isActive, mustChangePassword: usersTable.mustChangePassword,
    createdAt: usersTable.createdAt,
    cpf: usersTable.cpf, phone: usersTable.phone
  }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "Usuário não encontrado" }); return; }

  const isSelf = req.user?.id === userId;
  const isAdmin = req.user?.role === "master_admin" || req.user?.role === "creche_admin";
  
  if (isSelf || isAdmin) {
    user.cpf = user.cpf ? decrypt(user.cpf) : null;
    user.phone = user.phone ? decrypt(user.phone) : null;
  } else {
    user.cpf = null;
    user.phone = null;
  }

  res.json(user);
});

// PUT update user
router.put("/:userId", async (req: AuthRequest, res) => {
  const userId = parseInt(String(req.params.userId));
  const isSelf = req.user?.id === userId;
  const isAdmin = req.user?.role === "master_admin" || req.user?.role === "creche_admin";
  if (!isSelf && !isAdmin) { res.status(403).json({ error: "Sem permissão" }); return; }

  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten().fieldErrors });
    return;
  }
  const { name, email, avatarUrl, role, isActive, crecheId, newPassword, cpf, phone } = parsed.data;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (email !== undefined) updates.email = String(email).trim().toLowerCase();
  if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;
  if (cpf !== undefined) updates.cpf = cpf ? encrypt(cpf) : null;
  if (phone !== undefined) updates.phone = phone ? encrypt(phone) : null;
  if (newPassword !== undefined) {
    updates.passwordHash = hashPassword(newPassword);
    updates.mustChangePassword = false;
  }
  if (isAdmin) {
    if (role !== undefined) updates.role = role;
    if (isActive !== undefined) updates.isActive = isActive;
    if (crecheId !== undefined) updates.crecheId = crecheId;
  }

  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();
  res.json({
    id: user.id, name: user.name, email: user.email, role: user.role,
    crecheId: user.crecheId, avatarUrl: user.avatarUrl, isActive: user.isActive,
    mustChangePassword: user.mustChangePassword, createdAt: user.createdAt,
  });
});

// DELETE (deactivate) user
router.delete("/:userId", requireRole("master_admin", "creche_admin"), async (req: AuthRequest, res) => {
  const userId = parseInt(String(req.params.userId));
  await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.id, userId));
  res.json({ message: "Usuário desativado" });
});

// POST anonymize tutor (LGPD)
router.post("/:tutorId/anonymize", requireRole("creche_admin"), async (req: AuthRequest, res) => {
  const tutorId = parseInt(String(req.params.tutorId));
  const crecheId = req.user!.crecheId;
  
  if (!crecheId) {
    res.status(400).json({ error: "Admin sem creche associada" });
    return;
  }

  const [tutor] = await db.select().from(usersTable).where(eq(usersTable.id, tutorId)).limit(1);
  if (!tutor) {
    res.status(404).json({ error: "Tutor não encontrado" });
    return;
  }

  if (tutor.crecheId !== crecheId) {
    res.status(403).json({ error: "Sem permissão para anonimizar este tutor" });
    return;
  }

  try {
    await db.transaction(async (tx) => {
      await tx.update(usersTable)
        .set({
          name: `Tutor Anonimizado #${tutorId}`,
          email: `anonimizado_${tutorId}@arkpet.internal`,
          cpf: null,
          phone: null,
          avatarUrl: null,
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
    res.status(500).json({ error: "Erro ao anonimizar tutor: " + err.message });
  }
});

export default router;
