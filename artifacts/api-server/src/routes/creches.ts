import { Router } from "express";
import { db } from "@workspace/db";
import { crechesTable, usersTable, petsTable, bookingsTable, tasksTable } from "@workspace/db/schema";
import { eq, and, count, sql } from "drizzle-orm";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate.js";
import { hashPassword } from "../lib/auth.js";

const router = Router();

router.use(authenticate);

router.get("/", async (req: AuthRequest, res) => {
  if (req.user?.role !== "master_admin") {
    if (!req.user?.crecheId) { res.status(403).json({ error: "No creche assigned" }); return; }
    const [creche] = await db.select().from(crechesTable).where(eq(crechesTable.id, req.user.crecheId)).limit(1);
    res.json([creche]);
    return;
  }
  const creches = await db.select().from(crechesTable).orderBy(crechesTable.createdAt);
  res.json(creches);
});

router.post("/", requireRole("master_admin"), async (req: AuthRequest, res) => {
  const { name, address, phone, email, maxCapacity, adminEmail } = req.body;
  const [creche] = await db.insert(crechesTable).values({
    name, address, phone, email, maxCapacity: maxCapacity || 20,
  }).returning();

  if (adminEmail) {
    const [admin] = await db.select().from(usersTable).where(eq(usersTable.email, adminEmail)).limit(1);
    if (admin) {
      await db.update(usersTable).set({ crecheId: creche.id, role: "creche_admin" }).where(eq(usersTable.id, admin.id));
      await db.update(crechesTable).set({ adminId: admin.id }).where(eq(crechesTable.id, creche.id));
    }
  }
  res.status(201).json(creche);
});

router.get("/:crecheId", async (req: AuthRequest, res) => {
  const id = parseInt(req.params.crecheId);
  const [creche] = await db.select().from(crechesTable).where(eq(crechesTable.id, id)).limit(1);
  if (!creche) { res.status(404).json({ error: "Creche not found" }); return; }
  res.json(creche);
});

router.put("/:crecheId", requireRole("master_admin", "creche_admin"), async (req: AuthRequest, res) => {
  const id = parseInt(req.params.crecheId);
  const { name, address, phone, email, maxCapacity, status, logoUrl } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (address !== undefined) updates.address = address;
  if (phone !== undefined) updates.phone = phone;
  if (email !== undefined) updates.email = email;
  if (maxCapacity !== undefined) updates.maxCapacity = maxCapacity;
  if (status !== undefined) updates.status = status;
  if (logoUrl !== undefined) updates.logoUrl = logoUrl;
  const [creche] = await db.update(crechesTable).set(updates).where(eq(crechesTable.id, id)).returning();
  res.json(creche);
});

router.get("/:crecheId/stats", async (req: AuthRequest, res) => {
  const id = parseInt(req.params.crecheId);
  const [creche] = await db.select().from(crechesTable).where(eq(crechesTable.id, id)).limit(1);
  if (!creche) { res.status(404).json({ error: "Not found" }); return; }

  const today = new Date().toISOString().split("T")[0];
  const [checkedInPets] = await db.select({ count: count() }).from(petsTable)
    .where(and(eq(petsTable.crecheId, id), eq(petsTable.isCheckedIn, true)));
  const [totalPets] = await db.select({ count: count() }).from(petsTable)
    .where(and(eq(petsTable.crecheId, id), eq(petsTable.status, "active")));
  const [pendingBookings] = await db.select({ count: count() }).from(bookingsTable)
    .where(and(eq(bookingsTable.crecheId, id), eq(bookingsTable.status, "pending")));
  const [activeBookings] = await db.select({ count: count() }).from(bookingsTable)
    .where(and(eq(bookingsTable.crecheId, id), eq(bookingsTable.status, "active")));
  const [pendingTasks] = await db.select({ count: count() }).from(tasksTable)
    .where(and(eq(tasksTable.crecheId, id), eq(tasksTable.status, "pending")));
  const [completedTasks] = await db.select({ count: count() }).from(tasksTable)
    .where(and(eq(tasksTable.crecheId, id), eq(tasksTable.status, "completed")));

  res.json({
    crecheId: id,
    currentOccupancy: creche.currentOccupancy,
    maxCapacity: creche.maxCapacity,
    todayCheckIns: checkedInPets?.count || 0,
    todayCheckOuts: 0,
    pendingBookings: pendingBookings?.count || 0,
    activeBookings: activeBookings?.count || 0,
    pendingTasks: pendingTasks?.count || 0,
    completedTasks: completedTasks?.count || 0,
    petsCheckedIn: checkedInPets?.count || 0,
    totalPets: totalPets?.count || 0,
  });
});

router.get("/:crecheId/staff", async (req: AuthRequest, res) => {
  const id = parseInt(req.params.crecheId);
  const staff = await db.select({
    id: usersTable.id,
    name: usersTable.name,
    email: usersTable.email,
    role: usersTable.role,
    crecheId: usersTable.crecheId,
    avatarUrl: usersTable.avatarUrl,
    createdAt: usersTable.createdAt,
  }).from(usersTable).where(and(eq(usersTable.crecheId, id), sql`role IN ('creche_admin', 'staff')`));
  res.json(staff);
});

router.post("/:crecheId/staff", requireRole("master_admin", "creche_admin"), async (req: AuthRequest, res) => {
  const id = parseInt(req.params.crecheId);
  const { email, name, role, password } = req.body;
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing) {
    await db.update(usersTable).set({ crecheId: id, role }).where(eq(usersTable.id, existing.id));
    const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, existing.id)).limit(1);
    res.status(201).json({ id: updated.id, name: updated.name, email: updated.email, role: updated.role, crecheId: updated.crecheId, avatarUrl: updated.avatarUrl, createdAt: updated.createdAt });
    return;
  }
  const [user] = await db.insert(usersTable).values({
    name, email, passwordHash: hashPassword(password || "password123"), role, crecheId: id,
  }).returning();
  res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role, crecheId: user.crecheId, avatarUrl: user.avatarUrl, createdAt: user.createdAt });
});

export default router;
