import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword, generateToken } from "../lib/auth.js";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";

const router = Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  if (!user.isActive) {
    res.status(403).json({ error: "Conta desativada. Contate o administrador." });
    return;
  }
  const token = generateToken(user.id, user.role);
  res.json({
    token,
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

router.post("/register", async (req, res) => {
  const { name, email, password, role, crecheId } = req.body;
  if (!name || !email || !password || !role) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }
  const [user] = await db.insert(usersTable).values({
    name,
    email,
    passwordHash: hashPassword(password),
    role,
    crecheId: crecheId ?? null,
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

router.post("/logout", (_req, res) => {
  res.json({ message: "Logged out" });
});

export default router;
