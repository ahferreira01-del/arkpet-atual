import { getBusinessDate } from "../lib/date.js";
import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { db } from "@workspace/db";
import { crechesTable, usersTable, petsTable, bookingsTable, tasksTable, crecheInvitationsTable, subscriptionsTable } from "@workspace/db/schema";
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
import { checkQuota, checkCreationQuota } from "../services/entitlementsService.js";

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

      const wasAlreadyStaff = Boolean(
        existing &&
        existing.crecheId === id &&
        existing.isActive &&
        ["creche_admin", "staff"].includes(existing.role)
      );
      const delta = wasAlreadyStaff ? 0 : 1;
      // Check if a pending unexpired invitation exists for this email
      const [existingPendingInv] = await tx
        .select({ id: crecheInvitationsTable.id })
        .from(crecheInvitationsTable)
        .where(
          and(
            eq(crecheInvitationsTable.crecheId, id),
            eq(crecheInvitationsTable.email, email.trim().toLowerCase()),
            eq(crecheInvitationsTable.status, "pending"),
            sql`${crecheInvitationsTable.expiresAt} > NOW()`,
          ),
        )
        .limit(1);

      if (existingPendingInv) {
        const err: any = new Error("A pending invitation already exists for this email.");
        err.code = "INVITATION_ALREADY_EXISTS";
        err.statusCode = 409;
        throw err;
      }

      if (delta > 0) {
        const quota = await checkCreationQuota(tx, { crecheId: id, resource: "staff", requestedDelta: delta });
        if (!quota.allowed) {
          const err: any = new Error(quota.enforcementReason ?? `Staff limit of ${quota.limit} reached. Current active staff + invitations: ${quota.used}.`);
          err.code = "STAFF_LIMIT_EXCEEDED";
          err.statusCode = 403;
          err.current = quota.used;
          err.limit = quota.limit;
          throw err;
        }
      }

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
    if (err?.code === "INVITATION_ALREADY_EXISTS" || err?.message === "INVITATION_ALREADY_EXISTS") {
      res.status(409).json({
        error: "INVITATION_ALREADY_EXISTS",
        code: "INVITATION_ALREADY_EXISTS",
        message: "A pending invitation already exists for this email.",
      });
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
    if (err.message === "name_required") {
      res.status(400).json({ error: "name é obrigatório ao criar um novo staff" });
      return;
    }
    res.status(500).json({ error: err.message || "Erro ao adicionar staff" });
  }
});

const createInvitationSchema = z.object({
  email: z.string().email("email inválido"),
  role: z.enum(["creche_admin", "staff"]).default("staff"),
});

// POST /:crecheId/invitations (authenticated creche_admin / master_admin)
router.post("/:crecheId/invitations", requireRole("master_admin", "creche_admin"), async (req: AuthRequest, res) => {
  const id = parseInt(String(req.params.crecheId));
  if (req.user?.crecheId !== id && req.user?.role !== "master_admin") {
    res.status(403).json({ error: "Sem permissão" });
    return;
  }

  const parsed = createInvitationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten().fieldErrors });
    return;
  }

  const { email, role } = parsed.data;
  const normalizedEmail = email.trim().toLowerCase();

  // DEC-C3-INV-03: Pre-check existing user in usersTable
  const [existingUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail))
    .limit(1);

  if (existingUser) {
    res.status(409).json({
      error: "INVITATION_EMAIL_ALREADY_REGISTERED",
      code: "INVITATION_EMAIL_ALREADY_REGISTERED",
      message: "User with this email is already registered.",
    });
    return;
  }

  try {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours per DEC-C3-INV-01

    const invitation = await db.transaction(async (tx) => {
      await acquireTenantOperationalLock(id, tx);

      // Check existing pending unexpired invitation
      const [existingPending] = await tx
        .select({ id: crecheInvitationsTable.id })
        .from(crecheInvitationsTable)
        .where(
          and(
            eq(crecheInvitationsTable.crecheId, id),
            eq(crecheInvitationsTable.email, normalizedEmail),
            eq(crecheInvitationsTable.status, "pending"),
            sql`${crecheInvitationsTable.expiresAt} > NOW()`,
          ),
        )
        .limit(1);

      if (existingPending) {
        throw new Error("INVITATION_ALREADY_EXISTS");
      }

      // Quota check: 1 slot reserved for staff
      const quota = await checkCreationQuota(tx, { crecheId: id, resource: "staff", requestedDelta: 1 });
      if (!quota.allowed) {
        const err: any = new Error(quota.enforcementReason ?? `Staff limit of ${quota.limit} reached. Current active staff + invitations: ${quota.used}.`);
        err.code = "STAFF_LIMIT_EXCEEDED";
        err.statusCode = 403;
        err.current = quota.used;
        err.limit = quota.limit;
        throw err;
      }

      // Authoritative re-check immediately before inserting creche_invitations
      const [existingUserBeforeInsert] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, normalizedEmail))
        .limit(1);

      if (existingUserBeforeInsert) {
        throw new Error("INVITATION_EMAIL_ALREADY_REGISTERED");
      }

      const [newInv] = await tx
        .insert(crecheInvitationsTable)
        .values({
          crecheId: id,
          email: normalizedEmail,
          role,
          token: tokenHash,
          status: "pending",
          invitedByUserId: req.user?.id,
          expiresAt,
        })
        .returning();

      return newInv;
    });

    res.status(201).json({
      id: invitation.id,
      crecheId: invitation.crecheId,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      token: rawToken, // raw token returned only once, never stored in plaintext
      acceptanceEndpoint: `/api/creches/${id}/invitations/${invitation.id}/accept`,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
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
    if (err.message === "INVITATION_EMAIL_ALREADY_REGISTERED") {
      res.status(409).json({
        error: "INVITATION_EMAIL_ALREADY_REGISTERED",
        code: "INVITATION_EMAIL_ALREADY_REGISTERED",
        message: "User with this email is already registered.",
      });
      return;
    }
    if (err.message === "INVITATION_ALREADY_EXISTS") {
      res.status(409).json({
        error: "INVITATION_ALREADY_EXISTS",
        code: "INVITATION_ALREADY_EXISTS",
        message: "A pending invitation already exists for this email.",
      });
      return;
    }
    res.status(500).json({ error: err.message || "Erro ao criar convite" });
  }
});

// GET /:crecheId/invitations (authenticated creche_admin / master_admin)
router.get("/:crecheId/invitations", requireRole("master_admin", "creche_admin"), async (req: AuthRequest, res) => {
  const id = parseInt(String(req.params.crecheId));
  if (req.user?.crecheId !== id && req.user?.role !== "master_admin") {
    res.status(403).json({ error: "Sem permissão" });
    return;
  }
  const invitations = await db
    .select({
      id: crecheInvitationsTable.id,
      crecheId: crecheInvitationsTable.crecheId,
      email: crecheInvitationsTable.email,
      role: crecheInvitationsTable.role,
      status: crecheInvitationsTable.status,
      invitedByUserId: crecheInvitationsTable.invitedByUserId,
      expiresAt: crecheInvitationsTable.expiresAt,
      acceptedAt: crecheInvitationsTable.acceptedAt,
      revokedAt: crecheInvitationsTable.revokedAt,
      createdAt: crecheInvitationsTable.createdAt,
    })
    .from(crecheInvitationsTable)
    .where(eq(crecheInvitationsTable.crecheId, id))
    .orderBy(sql`${crecheInvitationsTable.createdAt} DESC`);

  res.json(invitations);
});

// POST /:crecheId/invitations/:invitationId/revoke (authenticated creche_admin / master_admin)
router.post("/:crecheId/invitations/:invitationId/revoke", requireRole("master_admin", "creche_admin"), async (req: AuthRequest, res) => {
  const id = parseInt(String(req.params.crecheId));
  const invitationId = parseInt(String(req.params.invitationId));
  if (req.user?.crecheId !== id && req.user?.role !== "master_admin") {
    res.status(403).json({ error: "Sem permissão" });
    return;
  }

  try {
    const revoked = await db.transaction(async (tx) => {
      await acquireTenantOperationalLock(id, tx);

      const [updated] = await tx
        .update(crecheInvitationsTable)
        .set({
          status: "revoked",
          revokedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(crecheInvitationsTable.id, invitationId),
            eq(crecheInvitationsTable.crecheId, id),
            eq(crecheInvitationsTable.status, "pending"),
          ),
        )
        .returning();

      return updated;
    });

    if (!revoked) {
      res.status(409).json({
        error: "INVITATION_NOT_REVOCABLE",
        code: "INVITATION_NOT_REVOCABLE",
        message: "Convite não encontrado ou já finalizado/revogado/expirado.",
      });
      return;
    }

    res.json({ ok: true, message: "Convite revogado com sucesso.", invitation: revoked });
  } catch (err: any) {
    if (err instanceof TenantArchivedError || err?.code === "tenant_archived" || err?.message === "tenant_archived") {
      res.status(403).json({ error: "tenant_archived", code: "tenant_archived", message: "Esta creche foi arquivada. Operações desabilitadas." });
      return;
    }
    res.status(500).json({ error: err.message || "Erro ao revogar convite" });
  }
});

const acceptInvitationSchema = z.object({
  token: z.string().min(1, "token é obrigatório"),
  name: z.string().min(1, "name é obrigatório"),
  password: z.string().min(6, "senha deve ter ao menos 6 caracteres"),
});

// Exported public handler for POST /creches/:crecheId/invitations/:invitationId/accept
export async function acceptInvitationHandler(req: Request, res: Response) {
  const crecheId = parseInt(String(req.params.crecheId));
  const invitationId = parseInt(String(req.params.invitationId));
  if (!crecheId || isNaN(crecheId) || !invitationId || isNaN(invitationId)) {
    res.status(400).json({ error: "Parâmetros inválidos" });
    return;
  }

  const parsed = acceptInvitationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten().fieldErrors });
    return;
  }

  const { token, name, password } = parsed.data;

  try {
    const newUser = await db.transaction(async (tx) => {
      await acquireTenantOperationalLock(crecheId, tx);

      // Verify tenant existence and status (ACC-GUARD-01)
      const [creche] = await tx
        .select({ id: crechesTable.id, status: crechesTable.status })
        .from(crechesTable)
        .where(eq(crechesTable.id, crecheId))
        .limit(1);

      if (!creche) {
        throw new Error("CRECHE_NOT_FOUND");
      }

      if (creche.status === "archived") {
        throw new TenantArchivedError();
      }

      // Enforce subscription state mirroring canonical requireActiveSubscription semantics (ACC-GUARD-02..04)
      const [sub] = await tx
        .select({
          status: subscriptionsTable.status,
          trialEndsAt: subscriptionsTable.trialEndsAt,
        })
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.crecheId, crecheId))
        .limit(1);

      if (!sub) {
        const err: any = new Error("Nenhuma assinatura encontrada. Assine um plano para continuar.");
        err.code = "subscription_missing";
        err.statusCode = 402;
        err.subscriptionStatus = "missing";
        throw err;
      }

      if (sub.status === "trial" && sub.trialEndsAt && new Date(sub.trialEndsAt) < new Date()) {
        const err: any = new Error("O período de teste encerrou. Assine um plano para continuar usando o sistema.");
        err.code = "trial_expired";
        err.statusCode = 402;
        err.subscriptionStatus = "trial_expired";
        throw err;
      }

      const BLOCKED_STATUSES = new Set(["suspended", "cancelled"]);
      if (BLOCKED_STATUSES.has(sub.status)) {
        const err: any = new Error("A assinatura da creche está inativa. Regularize o pagamento para continuar.");
        err.code = sub.status === "suspended" ? "subscription_suspended" : "subscription_inactive";
        err.statusCode = 402;
        err.subscriptionStatus = sub.status;
        throw err;
      }

      // Lock invitation row FOR UPDATE
      const [invitation] = await tx
        .select()
        .from(crecheInvitationsTable)
        .where(
          and(
            eq(crecheInvitationsTable.id, invitationId),
            eq(crecheInvitationsTable.crecheId, crecheId),
          ),
        )
        .for("update")
        .limit(1);

      if (!invitation) {
        throw new Error("INVITATION_NOT_FOUND");
      }

      if (invitation.status !== "pending") {
        throw new Error("INVITATION_NOT_PENDING");
      }

      if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
        await tx
          .update(crecheInvitationsTable)
          .set({ status: "expired", updatedAt: new Date() })
          .where(eq(crecheInvitationsTable.id, invitationId));
        throw new Error("INVITATION_EXPIRED");
      }

      // Timing safe token comparison
      const computedHash = crypto.createHash("sha256").update(token).digest("hex");
      const hashBuf = Buffer.from(computedHash, "hex");
      const storedBuf = Buffer.from(invitation.token, "hex");
      if (hashBuf.length !== storedBuf.length || !crypto.timingSafeEqual(hashBuf, storedBuf)) {
        throw new Error("INVITATION_INVALID_TOKEN");
      }

      // Check if user already exists in usersTable (DEC-C3-INV-03)
      const [existingUser] = await tx
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.email, invitation.email.toLowerCase().trim()))
        .limit(1);

      if (existingUser) {
        throw new Error("INVITATION_EMAIL_ALREADY_REGISTERED");
      }

      // Insert new active user (DEC-C3-INV-04)
      const [created] = await tx
        .insert(usersTable)
        .values({
          name,
          email: invitation.email.toLowerCase().trim(),
          passwordHash: hashPassword(password),
          role: invitation.role as "creche_admin" | "staff" | "tutor",
          crecheId,
          mustChangePassword: false,
          isActive: true,
        })
        .returning();

      // CAS transition pending -> accepted
      await tx
        .update(crecheInvitationsTable)
        .set({
          status: "accepted",
          acceptedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(crecheInvitationsTable.id, invitationId),
            eq(crecheInvitationsTable.status, "pending"),
          ),
        );

      return created;
    });

    res.status(201).json({
      ok: true,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        crecheId: newUser.crecheId,
        isActive: newUser.isActive,
      },
    });
  } catch (err: any) {
    if (err instanceof TenantArchivedError || err?.code === "tenant_archived" || err?.message === "tenant_archived") {
      res.status(403).json({ error: "tenant_archived", code: "tenant_archived", message: "Esta creche foi arquivada. Operações desabilitadas." });
      return;
    }
    if (err?.statusCode === 402) {
      res.status(402).json({
        error: err.code,
        message: err.message,
        status: err.subscriptionStatus,
      });
      return;
    }
    if (err.message === "CRECHE_NOT_FOUND") {
      res.status(404).json({ error: "CRECHE_NOT_FOUND", code: "CRECHE_NOT_FOUND", message: "Creche não encontrada." });
      return;
    }
    if (err.message === "INVITATION_NOT_FOUND") {
      res.status(404).json({ error: "INVITATION_NOT_FOUND", code: "INVITATION_NOT_FOUND", message: "Convite não encontrado." });
      return;
    }
    if (err.message === "INVITATION_NOT_PENDING") {
      res.status(409).json({ error: "INVITATION_NOT_PENDING", code: "INVITATION_NOT_PENDING", message: "Convite não está mais pendente." });
      return;
    }
    if (err.message === "INVITATION_EXPIRED") {
      try {
        await db
          .update(crecheInvitationsTable)
          .set({ status: "expired", updatedAt: new Date() })
          .where(eq(crecheInvitationsTable.id, invitationId));
      } catch (_) {}
      res.status(410).json({ error: "INVITATION_EXPIRED", code: "INVITATION_EXPIRED", message: "Convite expirou." });
      return;
    }
    if (err.message === "INVITATION_INVALID_TOKEN") {
      res.status(401).json({ error: "INVITATION_INVALID_TOKEN", code: "INVITATION_INVALID_TOKEN", message: "Token de convite inválido." });
      return;
    }
    if (err.message === "INVITATION_EMAIL_ALREADY_REGISTERED") {
      res.status(409).json({ error: "INVITATION_EMAIL_ALREADY_REGISTERED", code: "INVITATION_EMAIL_ALREADY_REGISTERED", message: "Email já cadastrado na plataforma." });
      return;
    }
    res.status(500).json({ error: err.message || "Erro ao aceitar convite" });
  }
}

export default router;

