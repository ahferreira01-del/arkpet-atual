import { getBusinessDate } from "../lib/date.js";
import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { crechesTable, usersTable, petsTable, bookingsTable, tasksTable } from "@workspace/db/schema";
import { eq, and, count, sql, gte, lt } from "drizzle-orm";
import { authenticate, requireRole, type AuthRequest } from "../middlewares/authenticate.js";
import { hashPassword } from "../lib/auth.js";
import { sendWelcomeEmail } from "../services/email.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import {
  provisionTenant,
  archiveTenant,
  restoreTenant,
  TenantProvisioningError,
  TenantArchiveBlockedError,
} from "../services/tenantProvisioning.js";
import {
  acquireTenantOperationalLock,
  TenantArchivedError,
} from "../services/tenantLifecycleLock.js";

const staffRoleEnum = z.enum(["creche_admin", "staff"]);

const createCrecheSchema = z.object({
  name: z.string().min(1, "name é obrigatório"),
  address: z.string().min(1, "address é obrigatório"),
  phone: z.string().min(1, "phone é obrigatório"),
  email: z.string().email("email inválido"),
  maxCapacity: z.number().int().positive().optional(),
  adminEmail: z.string().email("adminEmail é obrigatório e deve ser válido"),
  adminName: z.string().min(1, "adminName é obrigatório"),
  adminPassword: z.string().min(6, "adminPassword deve ter no mínimo 6 caracteres"),
  reason: z.string().optional().nullable(),
});

const CANONICAL_LOGO_REGEX =
  /^(?:\/api\/storage\/public-objects)?(?:\/objects)?\/uploads\/c([1-9]\d*)\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?:\.[a-zA-Z0-9]+)?$/;

const updateCrecheSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email("email inválido").optional().nullable(),
  maxCapacity: z.number().int().positive().optional().nullable(),
  status: z.enum(["active", "inactive"]).optional(),
  logoUrl: z
    .string()
    .refine((val) => {
      if (val === "" || val === null) return true;
      if (val.includes("..") || val.includes("\\") || val.includes("%2e") || val.includes("%2E")) return false;
      if (/^https?:\/\//i.test(val)) return true;
      return CANONICAL_LOGO_REGEX.test(val);
    }, "logoUrl inválido")
    .optional()
    .nullable(),
  pixKey: z.string().optional().nullable(),
  pixName: z.string().optional().nullable(),
  deliveryType: z.enum(["fixed", "on_demand"]).optional().nullable(),
  deliveryFee: z
    .string()
    .regex(/^\d{1,8}$/, "deliveryFee deve ser um número inteiro de centavos não-negativo (máx 8 dígitos)")
    .optional(),
  auditEnabled: z.boolean().optional(),
  reason: z.string().optional().nullable(),
});

const addStaffSchema = z.object({
  email: z.string().email("email é obrigatório e deve ser válido"),
  name: z.string().min(1, "name é obrigatório").optional(),
  role: staffRoleEnum.optional().default("staff"),
  password: z.string().optional().nullable(),
});

const createTutorSchema = z.object({
  name: z.string().min(1, "name é obrigatório"),
  email: z.string().email("email inválido"),
  password: z.string().optional().nullable(),
  mensalidadeDia: z.number().int().min(1).max(31).optional().nullable(),
  cpf: z.string().optional().nullable(),
});

const router = Router();

router.use(authenticate);

// GET tutors (simple list, used internally) — accessible only by staff, creche_admin, and master_admin
router.get("/:crecheId/tutors", requireRole("master_admin", "creche_admin", "staff"), async (req: AuthRequest, res) => {
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
router.get("/:crecheId/tutors/manage", requireRole("master_admin", "creche_admin", "staff"), async (req: AuthRequest, res) => {
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
      mensalidadeDia: usersTable.mensalidadeDia,
      cpf: usersTable.cpf,
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

  res.json(tutors.map((t) => {
    let decryptedCpf = null;
    if (t.cpf) {
      try { decryptedCpf = decrypt(t.cpf); } catch (e) {}
    }
    return { ...t, cpf: decryptedCpf, petCount: countMap[t.id] ?? 0 };
  }));
});

// POST create tutor
router.post("/:crecheId/tutors", requireRole("master_admin", "creche_admin", "staff"), async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  if (req.user?.crecheId !== crecheId && req.user?.role !== "master_admin") {
    res.status(403).json({ error: "Sem permissão" }); return;
  }
  const parsedTutor = createTutorSchema.safeParse(req.body);
  if (!parsedTutor.success) {
    res.status(400).json({ error: "Dados inválidos", details: parsedTutor.error.flatten().fieldErrors });
    return;
  }
  const { name, email, password, mensalidadeDia, cpf } = parsedTutor.data;
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing) { res.status(409).json({ error: "E-mail já cadastrado" }); return; }
  const [user] = await db.insert(usersTable).values({
    name, email, passwordHash: hashPassword(password || "ArkPet@123"),
    role: "tutor", crecheId, mustChangePassword: true, isActive: true,
    mensalidadeDia: mensalidadeDia ? parseInt(String(mensalidadeDia)) : null,
    cpf: cpf ? encrypt(cpf) : null,
  }).returning();
  // Send welcome email (non-blocking)
  sendWelcomeEmail({ name: user.name, email: user.email, role: "tutor", tempPassword: password as string }).catch(() => {});
  res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role, crecheId: user.crecheId, mensalidadeDia: user.mensalidadeDia, createdAt: user.createdAt });
});

// PATCH toggle tutor active status
router.patch("/:crecheId/tutors/:tutorId", requireRole("master_admin", "creche_admin", "staff"), async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const tutorId = parseInt(String(req.params.tutorId));
  if (req.user?.crecheId !== crecheId && req.user?.role !== "master_admin") {
    res.status(403).json({ error: "Sem permissão" }); return;
  }
  const { isActive, mensalidadeDia } = req.body;
  const setFields: Record<string, unknown> = {};
  if (isActive !== undefined) setFields.isActive = isActive;
  if (mensalidadeDia !== undefined) setFields.mensalidadeDia = mensalidadeDia ? parseInt(String(mensalidadeDia)) : null;
  const [updated] = await db.update(usersTable)
    .set(setFields)
    .where(and(eq(usersTable.id, tutorId), eq(usersTable.crecheId, crecheId), eq(usersTable.role, "tutor")))
    .returning();
  if (!updated) { res.status(404).json({ error: "Tutor não encontrado" }); return; }
  res.json({ id: updated.id, name: updated.name, isActive: updated.isActive, mensalidadeDia: updated.mensalidadeDia });
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
  const parsed = createCrecheSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten().fieldErrors });
    return;
  }
  const { name, address, phone, email, maxCapacity, adminEmail, adminName, adminPassword, reason } = parsed.data;

  const [existingUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, adminEmail.trim().toLowerCase()))
    .limit(1);

  if (existingUser) {
    res.status(409).json({ error: "E-mail de administrador já cadastrado" });
    return;
  }

  try {
    const result = await provisionTenant({
      name,
      address,
      phone,
      email,
      maxCapacity,
      adminName,
      adminEmail,
      adminPassword,
      reason: reason || "Criação direta de creche pelo Master Admin",
      actorId: req.user?.id,
      actorRole: req.user?.role,
      actorEmail: req.user?.email,
      actorType: "user",
    });
    res.status(201).json(result.creche);
  } catch (error: any) {
    if (error instanceof TenantProvisioningError) {
      res.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }
    if (error?.code === "23505") {
      res.status(409).json({ error: "Conflito ao criar creche ou administrador" });
      return;
    }
    res.status(500).json({ error: error.message || "Erro ao criar creche" });
  }
});

router.delete("/:crecheId", requireRole("master_admin"), async (req: AuthRequest, res) => {
  const id = parseInt(String(req.params.crecheId));
  try {
    const result = await archiveTenant({
      crecheId: id,
      actorId: req.user?.id,
      actorRole: req.user?.role,
      actorEmail: req.user?.email,
      actorType: "user",
      reason: req.body?.reason || "Arquivamento de creche pelo Master Admin",
    });
    res.status(200).json({ ok: true, creche: result });
  } catch (error: any) {
    if (error instanceof TenantArchiveBlockedError) {
      res.status(409).json({
        error: error.message,
        code: error.code,
        blockers: error.blockers,
        details: error.blockers[0]?.details,
      });
      return;
    }
    if (error instanceof TenantProvisioningError) {
      res.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }
    res.status(500).json({ error: error.message || "Erro ao arquivar creche" });
  }
});

router.get("/:crecheId", async (req: AuthRequest, res) => {
  const id = parseInt(String(req.params.crecheId));
  if (req.user?.crecheId !== id && req.user?.role !== "master_admin") {
    res.status(403).json({ error: "Sem permissão" });
    return;
  }
  const [creche] = await db.select().from(crechesTable).where(eq(crechesTable.id, id)).limit(1);
  if (!creche) { res.status(404).json({ error: "Creche not found" }); return; }
  res.json(creche);
});

router.put("/:crecheId", requireRole("master_admin", "creche_admin"), async (req: AuthRequest, res) => {
  const id = parseInt(String(req.params.crecheId));
  if (req.user?.crecheId !== id && req.user?.role !== "master_admin") {
    res.status(403).json({ error: "Sem permissão" });
    return;
  }

  const [currentCreche] = await db.select().from(crechesTable).where(eq(crechesTable.id, id)).limit(1);
  if (!currentCreche) {
    res.status(404).json({ error: "Creche not found" });
    return;
  }

  // Handle archived tenant checks & restoration
  if (currentCreche.status === "archived") {
    if (req.user?.role !== "master_admin") {
      res.status(403).json({
        error: "tenant_archived",
        code: "tenant_archived",
        message: "Esta creche está arquivada e não pode ser modificada por administradores locais.",
      });
      return;
    }

    if (req.body.status === "active") {
      try {
        const result = await restoreTenant({
          crecheId: id,
          actorId: req.user.id,
          actorRole: req.user.role,
          actorEmail: req.user.email,
          actorType: "user",
          reason: req.body.reason || "Reativação de creche pelo Master Admin",
        });
        res.json(result);
        return;
      } catch (err: any) {
        if (err instanceof TenantProvisioningError) {
          res.status(err.statusCode).json({ error: err.message, code: err.code });
          return;
        }
        res.status(500).json({ error: err.message || "Erro ao restaurar creche" });
        return;
      }
    } else {
      res.status(400).json({ error: "Apenas a reativação (status: active) é permitida para creches arquivadas" });
      return;
    }
  }

  if (req.user?.role === "creche_admin" && req.body.status === "archived") {
    res.status(403).json({ error: "Apenas Master Admin pode arquivar uma creche" });
    return;
  }

  const parsed = updateCrecheSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten().fieldErrors });
    return;
  }
  const { name, address, phone, email, maxCapacity, status, logoUrl, pixKey, pixName, deliveryType, deliveryFee } = parsed.data;

  // Strict tenant ownership validation for relative ArkPet logo paths (NO master exception)
  if (logoUrl !== undefined && logoUrl !== null && logoUrl !== "") {
    const match = logoUrl.match(CANONICAL_LOGO_REGEX);
    if (match) {
      const pathCrecheId = parseInt(match[1], 10);
      if (pathCrecheId !== id) {
        res.status(403).json({ error: "Sem permissão para associar mídia pertencente a outra creche" });
        return;
      }
    }
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (address !== undefined) updates.address = address;
  if (phone !== undefined) updates.phone = phone;
  if (email !== undefined) updates.email = email;
  if (maxCapacity !== undefined) updates.maxCapacity = maxCapacity;
  if (status !== undefined) updates.status = status;
  if (logoUrl !== undefined) updates.logoUrl = logoUrl === "" ? null : logoUrl;
  if (pixKey !== undefined) updates.pixKey = pixKey;
  if (pixName !== undefined) updates.pixName = pixName;
  if (deliveryType !== undefined) updates.deliveryType = deliveryType;
  if (deliveryFee !== undefined) updates.deliveryFee = deliveryFee;
  if (parsed.data.auditEnabled !== undefined) updates.auditEnabled = parsed.data.auditEnabled;
  const [creche] = await db.update(crechesTable).set(updates).where(eq(crechesTable.id, id)).returning();
  res.json(creche);
});

router.get("/:crecheId/stats", async (req: AuthRequest, res) => {
  const id = parseInt(String(req.params.crecheId));
  if (req.user?.crecheId !== id && req.user?.role !== "master_admin") {
    res.status(403).json({ error: "Sem permissão" });
    return;
  }
  const [creche] = await db.select().from(crechesTable).where(eq(crechesTable.id, id)).limit(1);
  if (!creche) { res.status(404).json({ error: "Not found" }); return; }

  const today = getBusinessDate();
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
  if (req.user?.crecheId !== id && req.user?.role !== "master_admin") {
    res.status(403).json({ error: "Sem permissão" });
    return;
  }
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
  if (req.user?.crecheId !== id && req.user?.role !== "master_admin") {
    res.status(403).json({ error: "Sem permissão" });
    return;
  }
  const parsed = addStaffSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten().fieldErrors });
    return;
  }
  const { email, name, role, password } = parsed.data;

  try {
    const user = await db.transaction(async (tx) => {
      await acquireTenantOperationalLock(id, tx);

      const [existing] = await tx
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, email.trim().toLowerCase()))
        .limit(1);

      if (existing) {
        await tx.update(usersTable).set({ crecheId: id, role }).where(eq(usersTable.id, existing.id));
        const [updated] = await tx.select().from(usersTable).where(eq(usersTable.id, existing.id)).limit(1);
        return updated;
      }

      if (!name) {
        throw new Error("name_required");
      }

      const [newUser] = await tx
        .insert(usersTable)
        .values({
          name,
          email: email.trim().toLowerCase(),
          passwordHash: hashPassword(password ?? "password123"),
          role,
          crecheId: id,
          mustChangePassword: true,
          isActive: true,
        })
        .returning();

      return newUser;
    });

    sendWelcomeEmail({ name: user.name, email: user.email, role: user.role, tempPassword: password || "password123" }).catch(() => {});
    res.status(201).json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      crecheId: user.crecheId,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
    });
  } catch (err: any) {
    if (err instanceof TenantArchivedError || err?.code === "tenant_archived" || err?.message === "tenant_archived") {
      res.status(403).json({ error: "tenant_archived", code: "tenant_archived", message: "Esta creche foi arquivada. Operações desabilitadas." });
      return;
    }
    if (err.message === "name_required") {
      res.status(400).json({ error: "name é obrigatório ao criar um novo staff" });
      return;
    }
    res.status(500).json({ error: err.message || "Erro ao adicionar staff" });
  }
});

export default router;

