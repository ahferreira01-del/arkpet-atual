import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate.js";
import { hashPassword } from "../lib/auth.js";

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
  const { name, email, password, role, crecheId } = req.body;
  if (!name || !email || !password || !role) {
    res.status(400).json({ error: "name, email, password e role são obrigatórios" });
    return;
  }
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
  }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "Usuário não encontrado" }); return; }
  res.json(user);
});

// PUT update user
router.put("/:userId", async (req: AuthRequest, res) => {
  const userId = parseInt(String(req.params.userId));
  const isSelf = req.user?.id === userId;
  const isAdmin = req.user?.role === "master_admin" || req.user?.role === "creche_admin";
  if (!isSelf && !isAdmin) { res.status(403).json({ error: "Sem permissão" }); return; }

  const { name, email, avatarUrl, role, isActive, crecheId, newPassword } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (email !== undefined) updates.email = String(email).trim().toLowerCase();
  if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;
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

export default router;
