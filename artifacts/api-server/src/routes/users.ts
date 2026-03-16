import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate.js";

const router = Router();
router.use(authenticate);

router.get("/", requireRole("master_admin"), async (_req, res) => {
  const users = await db.select({
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    role: usersTable.role,
    crecheId: usersTable.crecheId,
    avatarUrl: usersTable.avatarUrl,
    createdAt: usersTable.createdAt,
  }).from(usersTable).orderBy(usersTable.createdAt);
  res.json(users);
});

router.get("/:userId", async (req: AuthRequest, res) => {
  const userId = parseInt(req.params.userId);
  const [user] = await db.select({
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    role: usersTable.role,
    crecheId: usersTable.crecheId,
    avatarUrl: usersTable.avatarUrl,
    createdAt: usersTable.createdAt,
  }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "Not found" }); return; }
  res.json(user);
});

router.put("/:userId", async (req: AuthRequest, res) => {
  const userId = parseInt(req.params.userId);
  if (req.user?.id !== userId && req.user?.role !== "master_admin") {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const { name, avatarUrl } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, crecheId: user.crecheId, avatarUrl: user.avatarUrl, createdAt: user.createdAt });
});

export default router;
