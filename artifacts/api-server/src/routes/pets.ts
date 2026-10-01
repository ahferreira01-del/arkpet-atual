import { Router } from "express";
import { db } from "@workspace/db";
import { petsTable, usersTable, vaccinesTable, medicationsTable, crechesTable, bookingsTable } from "@workspace/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { requireActiveSubscription } from "../middlewares/requireActiveSubscription.js";
import { requireCrecheMembership } from "../middlewares/requireCrecheMembership.js";
import { acquireTenantOperationalLock, TenantArchivedError } from "../services/tenantLifecycleLock.js";
import { checkQuota, checkCreationQuota } from "../services/entitlementsService.js";

const router = Router({ mergeParams: true });
router.use(authenticate);
router.use(requireCrecheMembership);

router.get("/", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const { status, tutorId } = req.query;

  let conditions = [eq(petsTable.crecheId, crecheId)];
  if (req.user?.role === "tutor") {
    conditions.push(eq(petsTable.tutorId, req.user.id));
  } else if (tutorId) {
    conditions.push(eq(petsTable.tutorId, parseInt(tutorId as string)));
  }
  if (status === "checked_in") {
    conditions.push(eq(petsTable.isCheckedIn, true));
  } else if (status === "active") {
    conditions.push(eq(petsTable.status, "active"));
  }

  const pets = await db.select({
    id: petsTable.id,
    crecheId: petsTable.crecheId,
    tutorId: petsTable.tutorId,
    tutorName: usersTable.name,
    name: petsTable.name,
    species: petsTable.species,
    breed: petsTable.breed,
    birthDate: petsTable.birthDate,
    gender: petsTable.gender,
    weight: petsTable.weight,
    color: petsTable.color,
    temperament: petsTable.temperament,
    allergies: petsTable.allergies,
    specialNeeds: petsTable.specialNeeds,
    photoUrl: petsTable.photoUrl,
    lastCheckinPhotoUrl: petsTable.lastCheckinPhotoUrl,
    isCheckedIn: petsTable.isCheckedIn,
    feedingSchedule: petsTable.feedingSchedule,
    walkSchedule: petsTable.walkSchedule,
    qrToken: petsTable.qrToken,
    status: petsTable.status,
    isCastrated: petsTable.isCastrated,
    createdAt: petsTable.createdAt,
  })
    .from(petsTable)
    .leftJoin(usersTable, eq(petsTable.tutorId, usersTable.id))
    .where(and(...conditions));

  // Attach the active confirmed booking ID to each pet so the frontend
  // can do check-in without a separate round-trip.
  const petIds = pets.map((p) => p.id);
  let activeBookingMap: Record<number, number> = {};
  if (petIds.length > 0) {
    const activeBookings = await db
      .select({ id: bookingsTable.id, petId: bookingsTable.petId })
      .from(bookingsTable)
      .where(
        and(
          eq(bookingsTable.crecheId, crecheId),
          eq(bookingsTable.status, "confirmed"),
          inArray(bookingsTable.petId, petIds),
        ),
      );
    for (const b of activeBookings) {
      activeBookingMap[b.petId] = b.id;
    }
  }

  const items = pets.map((p) => ({
    ...p,
    activeBookingId: activeBookingMap[p.id] ?? null,
  }));

  res.json({ items, total: items.length });
});

router.post("/", requireActiveSubscription, async (req: AuthRequest, res) => {
  try {
    const crecheId = parseInt(String(req.params.crecheId), 10);
    if (isNaN(crecheId) || crecheId <= 0) {
      res.status(400).json({ error: "ID de creche inválido." });
      return;
    }
    const { tutorId, name, species, breed, birthDate, gender, weight, color, temperament, allergies, specialNeeds, photoUrl, feedingSchedule, walkSchedule, status } = req.body;

    // Tutors can only register pets for themselves
    let effectiveTutorId: number;
    if (req.user?.role === "tutor") {
      effectiveTutorId = req.user.id;
    } else {
      effectiveTutorId = parseInt(String(tutorId), 10);
      if (isNaN(effectiveTutorId) || effectiveTutorId <= 0) {
        res.status(400).json({ error: "tutorId válido é obrigatório." });
        return;
      }
    }

    const result = await db.transaction(async (tx) => {
      await acquireTenantOperationalLock(crecheId, tx);

      const targetStatus = status || "active";
      if (targetStatus === "active") {
        const quota = await checkCreationQuota(tx, { crecheId, resource: "pets", requestedDelta: 1 });
        if (!quota.allowed) {
          const err: any = new Error(quota.enforcementReason ?? `Pet limit of ${quota.limit} reached. Current active: ${quota.used}.`);
          err.code = "PET_LIMIT_EXCEEDED";
          err.statusCode = 403;
          err.current = quota.used;
          err.limit = quota.limit;
          throw err;
        }
      }

      const [pet] = await tx.insert(petsTable).values({
        crecheId, tutorId: effectiveTutorId, name, species, breed, birthDate, gender: gender || "unknown",
        weight, color, temperament, allergies, specialNeeds, photoUrl, feedingSchedule, walkSchedule,
        status: targetStatus,
      }).returning();

      const [tutor] = effectiveTutorId
        ? await tx.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, effectiveTutorId)).limit(1)
        : [{ name: null }];

      return { ...pet, tutorName: tutor?.name ?? null };
    });

    res.status(201).json(result);
  } catch (err: any) {
    if (err instanceof TenantArchivedError || err?.code === "tenant_archived" || err?.message === "tenant_archived") {
      res.status(403).json({ error: "tenant_archived", code: "tenant_archived", message: "Esta creche foi arquivada. Operações desabilitadas." });
      return;
    }
    if (err?.code === "PET_LIMIT_EXCEEDED" || err?.statusCode === 403) {
      res.status(403).json({
        error: "PET_LIMIT_EXCEEDED",
        code: "PET_LIMIT_EXCEEDED",
        message: err.message,
        current: err.current,
        limit: err.limit,
      });
      return;
    }
    res.status(500).json({ error: err.message || "Erro ao criar pet" });
  }
});

router.get("/by-qr/:token", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const token = String(req.params.token);
  const [pet] = await db.select({
    id: petsTable.id,
    crecheId: petsTable.crecheId,
    tutorId: petsTable.tutorId,
    tutorName: usersTable.name,
    name: petsTable.name,
    species: petsTable.species,
    breed: petsTable.breed,
    photoUrl: petsTable.photoUrl,
    isCheckedIn: petsTable.isCheckedIn,
    qrToken: petsTable.qrToken,
    status: petsTable.status,
  })
    .from(petsTable)
    .leftJoin(usersTable, eq(petsTable.tutorId, usersTable.id))
    .where(and(eq(petsTable.qrToken, token), eq(petsTable.crecheId, crecheId)))
    .limit(1);

  if (!pet) {
    res.status(404).json({ error: "Pet não encontrado para este QR Code." });
    return;
  }

  const bookings = await db.select().from(
    (await import("@workspace/db/schema")).bookingsTable
  ).where(
    and(
      eq((await import("@workspace/db/schema")).bookingsTable.petId, pet.id),
      eq((await import("@workspace/db/schema")).bookingsTable.status, "confirmed"),
    )
  ).limit(1);

  res.json({ ...pet, hasActiveBooking: bookings.length > 0, bookingId: bookings[0]?.id ?? null });
});

async function verifyPetAccess(crecheId: number, petId: number, user: AuthRequest["user"]): Promise<boolean> {
  const conditions = [eq(petsTable.crecheId, crecheId), eq(petsTable.id, petId)];
  if (user?.role === "tutor") {
    conditions.push(eq(petsTable.tutorId, user.id));
  }
  const [pet] = await db.select({ id: petsTable.id }).from(petsTable).where(and(...conditions)).limit(1);
  return !!pet;
}

router.get("/:petId", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId), 10);
  const petId = parseInt(String(req.params.petId), 10);
  if (isNaN(crecheId) || crecheId <= 0 || isNaN(petId) || petId <= 0) {
    res.status(400).json({ error: "Identificador inválido." });
    return;
  }

  const conditions = [eq(petsTable.crecheId, crecheId), eq(petsTable.id, petId)];
  if (req.user?.role === "tutor") {
    conditions.push(eq(petsTable.tutorId, req.user.id));
  }

  const [pet] = await db.select({
    id: petsTable.id,
    crecheId: petsTable.crecheId,
    tutorId: petsTable.tutorId,
    tutorName: usersTable.name,
    name: petsTable.name,
    species: petsTable.species,
    breed: petsTable.breed,
    birthDate: petsTable.birthDate,
    gender: petsTable.gender,
    weight: petsTable.weight,
    color: petsTable.color,
    temperament: petsTable.temperament,
    allergies: petsTable.allergies,
    specialNeeds: petsTable.specialNeeds,
    photoUrl: petsTable.photoUrl,
    lastCheckinPhotoUrl: petsTable.lastCheckinPhotoUrl,
    isCheckedIn: petsTable.isCheckedIn,
    feedingSchedule: petsTable.feedingSchedule,
    walkSchedule: petsTable.walkSchedule,
    qrToken: petsTable.qrToken,
    status: petsTable.status,
    isCastrated: petsTable.isCastrated,
    createdAt: petsTable.createdAt,
  })
    .from(petsTable)
    .leftJoin(usersTable, eq(petsTable.tutorId, usersTable.id))
    .where(and(...conditions))
    .limit(1);
  if (!pet) { res.status(404).json({ error: "Pet not found" }); return; }
  res.json(pet);
});

router.put("/:petId", async (req: AuthRequest, res) => {
  try {
    const crecheId = parseInt(String(req.params.crecheId), 10);
    const petId = parseInt(String(req.params.petId), 10);
    if (isNaN(crecheId) || crecheId <= 0 || isNaN(petId) || petId <= 0) {
      res.status(400).json({ error: "Identificador inválido." });
      return;
    }

    const result = await db.transaction(async (tx) => {
      await acquireTenantOperationalLock(crecheId, tx);

      // Verify pet existence and ownership
      const findConditions = [eq(petsTable.crecheId, crecheId), eq(petsTable.id, petId)];
      if (req.user?.role === "tutor") {
        findConditions.push(eq(petsTable.tutorId, req.user.id));
      }
      const [existingPet] = await tx.select().from(petsTable).where(and(...findConditions)).limit(1);
      if (!existingPet) {
        return { notFound: true };
      }

      const { name, breed, birthDate, weight, color, temperament, allergies, specialNeeds, photoUrl, feedingSchedule, walkSchedule, status, isCastrated } = req.body;
      const updates: Record<string, unknown> = {};

      // Profile fields: permitted for tutor, staff, creche_admin, master_admin
      if (name !== undefined) updates.name = name;
      if (breed !== undefined) updates.breed = breed;
      if (birthDate !== undefined) updates.birthDate = birthDate;
      if (weight !== undefined) updates.weight = weight;
      if (color !== undefined) updates.color = color;
      if (temperament !== undefined) updates.temperament = temperament;
      if (allergies !== undefined) updates.allergies = allergies;
      if (specialNeeds !== undefined) updates.specialNeeds = specialNeeds;
      if (photoUrl !== undefined) updates.photoUrl = photoUrl;
      if (isCastrated !== undefined) updates.isCastrated = isCastrated;

      // Operational fields: restricted to staff, creche_admin, master_admin
      const isOperationalRole = ["staff", "creche_admin", "master_admin"].includes(req.user?.role ?? "");
      if (isOperationalRole) {
        if (feedingSchedule !== undefined) updates.feedingSchedule = feedingSchedule;
        if (walkSchedule !== undefined) updates.walkSchedule = walkSchedule;
        if (status !== undefined) updates.status = status;
      }

      if (existingPet.status !== "active" && updates.status === "active") {
        const quota = await checkCreationQuota(tx, { crecheId, resource: "pets", requestedDelta: 1 });
        if (!quota.allowed) {
          const err: any = new Error(quota.enforcementReason ?? `Pet limit of ${quota.limit} reached. Current active: ${quota.used}.`);
          err.code = "PET_LIMIT_EXCEEDED";
          err.statusCode = 403;
          err.current = quota.used;
          err.limit = quota.limit;
          throw err;
        }
      }

      let pet = existingPet;
      if (Object.keys(updates).length > 0) {
        const [updated] = await tx.update(petsTable).set(updates)
          .where(and(eq(petsTable.crecheId, crecheId), eq(petsTable.id, petId))).returning();
        if (updated) pet = updated;
      }

      const [tutor] = pet?.tutorId
        ? await tx.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, pet.tutorId)).limit(1)
        : [{ name: null }];

      return { pet, tutorName: tutor?.name ?? null, isOperationalRole, isCheckedIn: pet?.isCheckedIn, feedingSchedule, walkSchedule };
    });

    if (result.notFound) {
      res.status(404).json({ error: "Pet not found" });
      return;
    }

    res.json({ ...result.pet, tutorName: result.tutorName });

    // Fire-and-forget: if a care plan changed while the pet is checked in,
    // regenerate today's tasks immediately so staff see them without waiting for midnight.
    if (result.isOperationalRole && result.isCheckedIn && (result.feedingSchedule !== undefined || result.walkSchedule !== undefined)) {
      import("../lib/scheduler.js")
        .then(({ generateTasksForPetToday }) => generateTasksForPetToday(petId, crecheId))
        .catch((err: unknown) => console.error("[pets] plan task regen failed:", err));
    }
  } catch (err: any) {
    if (err instanceof TenantArchivedError || err?.code === "tenant_archived" || err?.message === "tenant_archived") {
      res.status(403).json({ error: "tenant_archived", code: "tenant_archived", message: "Esta creche foi arquivada. Operações desabilitadas." });
      return;
    }
    if (err?.code === "PET_LIMIT_EXCEEDED" || err?.statusCode === 403) {
      res.status(403).json({
        error: "PET_LIMIT_EXCEEDED",
        code: "PET_LIMIT_EXCEEDED",
        message: err.message,
        current: err.current,
        limit: err.limit,
      });
      return;
    }
    res.status(500).json({ error: err.message || "Erro ao atualizar pet" });
  }
});

router.get("/:petId/vaccines", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const petId = parseInt(String(req.params.petId));
  const hasAccess = await verifyPetAccess(crecheId, petId, req.user);
  if (!hasAccess) { res.status(404).json({ error: "Pet not found" }); return; }

  const vaccines = await db.select().from(vaccinesTable)
    .where(and(eq(vaccinesTable.crecheId, crecheId), eq(vaccinesTable.petId, petId)));
  res.json(vaccines);
});

router.post("/:petId/vaccines", async (req: AuthRequest, res) => {
  try {
    const crecheId = parseInt(String(req.params.crecheId));
    const petId = parseInt(String(req.params.petId));
    const hasAccess = await verifyPetAccess(crecheId, petId, req.user);
    if (!hasAccess) { res.status(404).json({ error: "Pet not found" }); return; }

    const { name, appliedDate, nextDueDate, veterinarian, notes, receiptUrl } = req.body;
    const vaccine = await db.transaction(async (tx) => {
      await acquireTenantOperationalLock(crecheId, tx);
      const [v] = await tx.insert(vaccinesTable).values({
        petId, crecheId, name, appliedDate, nextDueDate, veterinarian, notes, receiptUrl,
      }).returning();
      return v;
    });

    res.status(201).json(vaccine);
  } catch (err: any) {
    if (err instanceof TenantArchivedError || err?.code === "tenant_archived" || err?.message === "tenant_archived") {
      res.status(403).json({ error: "tenant_archived", code: "tenant_archived", message: "Esta creche foi arquivada. Operações desabilitadas." });
      return;
    }
    res.status(500).json({ error: err.message || "Erro ao registrar vacina" });
  }
});

router.get("/:petId/medications", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const petId = parseInt(String(req.params.petId));
  const hasAccess = await verifyPetAccess(crecheId, petId, req.user);
  if (!hasAccess) { res.status(404).json({ error: "Pet not found" }); return; }

  const meds = await db.select().from(medicationsTable)
    .where(and(eq(medicationsTable.crecheId, crecheId), eq(medicationsTable.petId, petId)));
  res.json(meds);
});

router.post("/:petId/medications", async (req: AuthRequest, res) => {
  try {
    const crecheId = parseInt(String(req.params.crecheId));
    const petId = parseInt(String(req.params.petId));
    const hasAccess = await verifyPetAccess(crecheId, petId, req.user);
    if (!hasAccess) { res.status(404).json({ error: "Pet not found" }); return; }

    const { name, dosage, frequency, startDate, endDate, times, notes } = req.body;

    const { med, isCheckedIn } = await db.transaction(async (tx) => {
      await acquireTenantOperationalLock(crecheId, tx);

      const [m] = await tx.insert(medicationsTable).values({
        petId, crecheId, name, dosage, frequency, startDate, endDate, times: times || [], notes,
      }).returning();

      // If pet is checked in, trigger today's task regeneration
      const [pet] = await tx.select({ isCheckedIn: petsTable.isCheckedIn })
        .from(petsTable)
        .where(and(eq(petsTable.id, petId), eq(petsTable.crecheId, crecheId)))
        .limit(1);

      return { med: m, isCheckedIn: pet?.isCheckedIn };
    });

    if (isCheckedIn) {
      import("../lib/scheduler.js")
        .then(({ generateTasksForPetToday }) => generateTasksForPetToday(petId, crecheId))
        .catch((err: unknown) => console.error("[pets] medication task regen failed:", err));
    }

    res.status(201).json(med);
  } catch (err: any) {
    if (err instanceof TenantArchivedError || err?.code === "tenant_archived" || err?.message === "tenant_archived") {
      res.status(403).json({ error: "tenant_archived", code: "tenant_archived", message: "Esta creche foi arquivada. Operações desabilitadas." });
      return;
    }
    res.status(500).json({ error: err.message || "Erro ao registrar medicação" });
  }
});

router.post("/:petId/medications/:medicationId/administer", async (req: AuthRequest, res) => {
  try {
    if (req.user?.role === "tutor") { res.status(403).json({ error: "Sem permissão" }); return; }
    const crecheId = parseInt(String(req.params.crecheId));
    const petId = parseInt(String(req.params.petId));
    const medicationId = parseInt(String(req.params.medicationId));
    const { administeredBy, notes } = req.body;

    const med = await db.transaction(async (tx) => {
      await acquireTenantOperationalLock(crecheId, tx);

      const [m] = await tx.update(medicationsTable).set({
        lastAdministered: new Date(),
        administeredBy: administeredBy || req.user?.name,
        notes,
      }).where(and(
        eq(medicationsTable.id, medicationId),
        eq(medicationsTable.petId, petId),
        eq(medicationsTable.crecheId, crecheId)
      )).returning();

      return m;
    });

    res.json(med);
  } catch (err: any) {
    if (err instanceof TenantArchivedError || err?.code === "tenant_archived" || err?.message === "tenant_archived") {
      res.status(403).json({ error: "tenant_archived", code: "tenant_archived", message: "Esta creche foi arquivada. Operações desabilitadas." });
      return;
    }
    res.status(500).json({ error: err.message || "Erro ao administrar medicação" });
  }
});

router.get("/:petId/walks", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const petId = parseInt(String(req.params.petId));
  const hasAccess = await verifyPetAccess(crecheId, petId, req.user);
  if (!hasAccess) { res.status(404).json({ error: "Pet not found" }); return; }

  const { db: dbConn } = await import("@workspace/db");
  const { walksTable } = await import("@workspace/db/schema");
  const walks = await dbConn.select({
    id: walksTable.id,
    petId: walksTable.petId,
    crecheId: walksTable.crecheId,
    staffId: walksTable.staffId,
    staffName: usersTable.name,
    startTime: walksTable.startTime,
    endTime: walksTable.endTime,
    durationMinutes: walksTable.durationMinutes,
    notes: walksTable.notes,
    status: walksTable.status,
    createdAt: walksTable.createdAt,
  })
    .from(walksTable)
    .leftJoin(usersTable, eq(walksTable.staffId, usersTable.id))
    .where(and(eq(walksTable.crecheId, crecheId), eq(walksTable.petId, petId)));
  res.json(walks);
});

router.post("/:petId/walks", async (req: AuthRequest, res) => {
  try {
    if (req.user?.role === "tutor") { res.status(403).json({ error: "Sem permissão" }); return; }
    const crecheId = parseInt(String(req.params.crecheId));
    const petId = parseInt(String(req.params.petId));
    const { walksTable } = await import("@workspace/db/schema");
    const { staffId, notes } = req.body;

    const walk = await db.transaction(async (tx) => {
      await acquireTenantOperationalLock(crecheId, tx);

      const [w] = await tx.insert(walksTable).values({
        petId, crecheId, staffId: staffId || req.user?.id, notes, startTime: new Date(),
      }).returning();
      return w;
    });

    res.status(201).json({ ...walk, staffName: req.user?.name });
  } catch (err: any) {
    if (err instanceof TenantArchivedError || err?.code === "tenant_archived" || err?.message === "tenant_archived") {
      res.status(403).json({ error: "tenant_archived", code: "tenant_archived", message: "Esta creche foi arquivada. Operações desabilitadas." });
      return;
    }
    res.status(500).json({ error: err.message || "Erro ao registrar passeio" });
  }
});

router.post("/:petId/walks/:walkId/end", async (req: AuthRequest, res) => {
  try {
    if (req.user?.role === "tutor") { res.status(403).json({ error: "Sem permissão" }); return; }
    const crecheId = parseInt(String(req.params.crecheId));
    const petId = parseInt(String(req.params.petId));
    const walkId = parseInt(String(req.params.walkId));
    const { walksTable } = await import("@workspace/db/schema");
    const now = new Date();

    const walk = await db.transaction(async (tx) => {
      await acquireTenantOperationalLock(crecheId, tx);

      const [existing] = await tx.select().from(walksTable).where(eq(walksTable.id, walkId)).limit(1);
      const duration = existing ? Math.round((now.getTime() - new Date(existing.startTime).getTime()) / 60000) : 0;
      const [w] = await tx.update(walksTable).set({
        endTime: now, status: "completed", durationMinutes: duration,
      }).where(and(eq(walksTable.id, walkId), eq(walksTable.petId, petId), eq(walksTable.crecheId, crecheId))).returning();
      return w;
    });

    res.json({ ...walk, staffName: req.user?.name });
  } catch (err: any) {
    if (err instanceof TenantArchivedError || err?.code === "tenant_archived" || err?.message === "tenant_archived") {
      res.status(403).json({ error: "tenant_archived", code: "tenant_archived", message: "Esta creche foi arquivada. Operações desabilitadas." });
      return;
    }
    res.status(500).json({ error: err.message || "Erro ao finalizar passeio" });
  }
});

// Force-checkout: libera um pet preso (isCheckedIn=true sem reserva ativa).
// Útil quando complete-service ou outro bug deixou o pet travado na creche.
router.post("/:petId/force-checkout", async (req: AuthRequest, res) => {
  try {
    if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
    if (req.user.role === "tutor") { res.status(403).json({ error: "Sem permissão" }); return; }
    const crecheId = parseInt(String(req.params.crecheId));
    const petId = parseInt(String(req.params.petId));

    const result = await db.transaction(async (tx) => {
      await acquireTenantOperationalLock(crecheId, tx);

      const [pet] = await tx.select({ id: petsTable.id, isCheckedIn: petsTable.isCheckedIn })
        .from(petsTable)
        .where(and(eq(petsTable.id, petId), eq(petsTable.crecheId, crecheId)))
        .limit(1);

      if (!pet) return { status: 404, error: "Pet não encontrado" };
      if (!pet.isCheckedIn) return { status: 400, error: "Pet não está marcado como presente" };

      // Only allow if there's no active booking (if there is, use regular checkout)
      const [activeBooking] = await tx.select({ id: bookingsTable.id })
        .from(bookingsTable)
        .where(and(
          eq(bookingsTable.crecheId, crecheId),
          eq(bookingsTable.petId, petId),
          eq(bookingsTable.status, "active"),
        )).limit(1);

      if (activeBooking) {
        return { status: 409, error: "Pet possui reserva ativa. Use o check-out normal." };
      }

      await tx.update(petsTable).set({ isCheckedIn: false }).where(eq(petsTable.id, petId));
      await tx.update(crechesTable).set({
        currentOccupancy: tx.$count(petsTable, and(eq(petsTable.crecheId, crecheId), eq(petsTable.isCheckedIn, true))) as any,
      }).where(eq(crechesTable.id, crecheId));

      return { status: 200, ok: true, petId };
    });

    if (result.status !== 200) {
      res.status(result.status!).json({ error: result.error });
      return;
    }

    res.json({ ok: true, petId: result.petId });
  } catch (err: any) {
    if (err instanceof TenantArchivedError || err?.code === "tenant_archived" || err?.message === "tenant_archived") {
      res.status(403).json({ error: "tenant_archived", code: "tenant_archived", message: "Esta creche foi arquivada. Operações desabilitadas." });
      return;
    }
    res.status(500).json({ error: err.message || "Erro no force-checkout" });
  }
});

export default router;
