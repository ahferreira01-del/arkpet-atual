import { Router } from "express";
import { db } from "@workspace/db";
import { crechesTable, usersTable, petsTable, bookingsTable, tasksTable } from "@workspace/db/schema";
import { eq, and, count, sql, gte, lt } from "drizzle-orm";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate.js";
import { hashPassword } from "../lib/auth.js";
import { sendWelcomeEmail } from "../services/email.js";

const router = Router();

router.use(authenticate);

// GET tutors (simple list, used internally) — accessible by all authenticated members
router.get("/:crecheId/tutors", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  if (req.user?.crecheId !== crecheId && req.user?.role !== "master_admin") {
    res.status(403).json({ error: "Sem permissão" });
    return;
  }
  const tutors = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(usersTable)
    .where(and(eq(usersTable.crecheId, crecheId), eq(usersTable.role, "tutor"), eq(usersTable.isActive, true)))
    .orderBy(usersTable.name);
  res.json(tutors);
});

// GET tutors with full data + pet count — for tutor management page
router.get("/:crecheId/tutors/manage", requireRole("master_admin", "creche_admin"), async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  if (req.user?.crecheId !== crecheId && req.user?.role !== "master_admin") {
    res.status(403).json({ error: "Sem permissão" });
    return;
  }
  const tutors = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      isActive: usersTable.isActive,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(and(eq(usersTable.crecheId, crecheId), eq(usersTable.role, "tutor")))
    .orderBy(usersTable.name);

  // Fetch pet counts for all tutors
  const tutorIds = tutors.map((t) => t.id);
  const petCounts = tutorIds.length > 0
    ? await db
        .select({ tutorId: petsTable.tutorId, count: count() })
        .from(petsTable)
        .where(and(eq(petsTable.crecheId, crecheId), sql`tutor_id = ANY(ARRAY[${sql.join(tutorIds.map(id => sql`${id}`), sql`, `)}]::int[])`))
        .groupBy(petsTable.tutorId)
    : [];

  const countMap: Record<number, number> = {};
  for (const row of petCounts) {
    if (row.tutorId != null) countMap[row.tutorId] = Number(row.count);
  }

  res.json(tutors.map((t) => ({ ...t, petCount: countMap[t.id] ?? 0 })));
});

// POST create tutor
router.post("/:crecheId/tutors", requireRole("master_admin", "creche_admin"), async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  if (req.user?.crecheId !== crecheId && req.user?.role !== "master_admin") {
    res.status(403).json({ error: "Sem permissão" }); return;
  }
  const { name, email, password } = req.body;
  if (!name || !email) { res.status(400).json({ error: "Nome e e-mail são obrigatórios" }); return; }
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing) { res.status(409).json({ error: "E-mail já cadastrado" }); return; }
  const [user] = await db.insert(usersTable).values({
    name, email, passwordHash: hashPassword(password || "ArkPet@123"),
    role: "tutor", crecheId, mustChangePassword: true, isActive: true,
  }).returning();
  // Send welcome email (non-blocking)
  sendWelcomeEmail({ name: user.name, email: user.email, role: "tutor", tempPassword: password }).catch(() => {});
  res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role, crecheId: user.crecheId, createdAt: user.createdAt });
});

// PATCH toggle tutor active status
router.patch("/:crecheId/tutors/:tutorId", requireRole("master_admin", "creche_admin"), async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const tutorId = parseInt(String(req.params.tutorId));
  if (req.user?.crecheId !== crecheId && req.user?.role !== "master_admin") {
    res.status(403).json({ error: "Sem permissão" }); return;
  }
  const { isActive } = req.body;
  const [updated] = await db.update(usersTable)
    .set({ isActive })
    .where(and(eq(usersTable.id, tutorId), eq(usersTable.crecheId, crecheId), eq(usersTable.role, "tutor")))
    .returning();
  if (!updated) { res.status(404).json({ error: "Tutor não encontrado" }); return; }
  res.json({ id: updated.id, name: updated.name, isActive: updated.isActive });
});

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
  const { name, address, phone, email, maxCapacity, adminEmail, adminName, adminPassword } = req.body;
  const [creche] = await db.insert(crechesTable).values({
    name, address, phone, email, maxCapacity: maxCapacity || 20,
  }).returning();

  if (adminEmail) {
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, adminEmail)).limit(1);
    if (existing) {
      await db.update(usersTable).set({ crecheId: creche.id, role: "creche_admin" }).where(eq(usersTable.id, existing.id));
      await db.update(crechesTable).set({ adminId: existing.id }).where(eq(crechesTable.id, creche.id));
    } else if (adminName && adminPassword) {
      const [newAdmin] = await db.insert(usersTable).values({
        name: adminName, email: adminEmail,
        passwordHash: hashPassword(adminPassword),
        role: "creche_admin", crecheId: creche.id,
        mustChangePassword: true, isActive: true,
      }).returning();
      await db.update(crechesTable).set({ adminId: newAdmin.id }).where(eq(crechesTable.id, creche.id));
      // Send welcome email to new creche admin
      sendWelcomeEmail({ name: adminName, email: adminEmail, role: "creche_admin", tempPassword: adminPassword, crecheName: name }).catch(() => {});
    }
  }
  res.status(201).json(creche);
});

router.get("/:crecheId", async (req: AuthRequest, res) => {
  const id = parseInt(String(req.params.crecheId));
  const [creche] = await db.select().from(crechesTable).where(eq(crechesTable.id, id)).limit(1);
  if (!creche) { res.status(404).json({ error: "Creche not found" }); return; }
  res.json(creche);
});

router.put("/:crecheId", requireRole("master_admin", "creche_admin"), async (req: AuthRequest, res) => {
  const id = parseInt(String(req.params.crecheId));
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
  const id = parseInt(String(req.params.crecheId));
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
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const [pendingTasks] = await db.select({ count: count() }).from(tasksTable)
    .where(and(eq(tasksTable.crecheId, id), eq(tasksTable.status, "pending"), gte(tasksTable.scheduledFor, todayStart), lt(tasksTable.scheduledFor, todayEnd)));
  const [completedTasks] = await db.select({ count: count() }).from(tasksTable)
    .where(and(eq(tasksTable.crecheId, id), eq(tasksTable.status, "completed"), gte(tasksTable.scheduledFor, todayStart), lt(tasksTable.scheduledFor, todayEnd)));

  res.json({
    crecheId: id,
    currentOccupancy: creche.currentOccupancy,
    maxCapacity: creche.maxCapacity,
    todayCheckIns: checkedInPets?.count || 0,
    todayCheckOuts: (await db.select({ count: count() }).from(bookingsTable)
      .where(and(eq(bookingsTable.crecheId, id), eq(bookingsTable.status, "completed"),
        gte(bookingsTable.checkOutTime as any, todayStart), lt(bookingsTable.checkOutTime as any, todayEnd))))[0]?.count || 0,
    pendingBookings: pendingBookings?.count || 0,
    activeBookings: activeBookings?.count || 0,
    pendingTasks: pendingTasks?.count || 0,
    completedTasks: completedTasks?.count || 0,
    petsCheckedIn: checkedInPets?.count || 0,
    totalPets: totalPets?.count || 0,
  });
});

router.get("/:crecheId/staff", async (req: AuthRequest, res) => {
  const id = parseInt(String(req.params.crecheId));
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
  const id = parseInt(String(req.params.crecheId));
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
    mustChangePassword: true, isActive: true,
  }).returning();
  // Send welcome email (non-blocking)
  sendWelcomeEmail({ name: user.name, email: user.email, role: user.role, tempPassword: password || "password123" }).catch(() => {});
  res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role, crecheId: user.crecheId, avatarUrl: user.avatarUrl, createdAt: user.createdAt });
});

export default router;
