import { Router } from "express";
import { db } from "@workspace/db";
import { petsTable, usersTable, vaccinesTable, medicationsTable, crechesTable, bookingsTable } from "@workspace/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { checkPetLimit } from "../middlewares/checkPetLimit.js";
import { requireActiveSubscription } from "../middlewares/requireActiveSubscription.js";
import { requireCrecheMembership } from "../middlewares/requireCrecheMembership.js";

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

router.post("/", requireActiveSubscription, checkPetLimit, async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const { tutorId, name, species, breed, birthDate, gender, weight, color, temperament, allergies, specialNeeds, photoUrl, feedingSchedule, walkSchedule } = req.body;
  const [pet] = await db.insert(petsTable).values({
    crecheId, tutorId, name, species, breed, birthDate, gender: gender || "unknown",
    weight, color, temperament, allergies, specialNeeds, photoUrl, feedingSchedule, walkSchedule,
  }).returning();
  const [tutor] = tutorId
    ? await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, tutorId)).limit(1)
    : [{ name: null }];
  res.status(201).json({ ...pet, tutorName: tutor?.name ?? null });
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

router.get("/:petId", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const petId = parseInt(String(req.params.petId));
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
    .where(and(eq(petsTable.crecheId, crecheId), eq(petsTable.id, petId)))
    .limit(1);
  if (!pet) { res.status(404).json({ error: "Pet not found" }); return; }
  res.json(pet);
});

router.put("/:petId", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const petId = parseInt(String(req.params.petId));
  const { name, breed, birthDate, weight, color, temperament, allergies, specialNeeds, photoUrl, feedingSchedule, walkSchedule, status, isCastrated } = req.body;
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (breed !== undefined) updates.breed = breed;
  if (birthDate !== undefined) updates.birthDate = birthDate;
  if (weight !== undefined) updates.weight = weight;
  if (color !== undefined) updates.color = color;
  if (temperament !== undefined) updates.temperament = temperament;
  if (allergies !== undefined) updates.allergies = allergies;
  if (specialNeeds !== undefined) updates.specialNeeds = specialNeeds;
  if (photoUrl !== undefined) updates.photoUrl = photoUrl;
  if (feedingSchedule !== undefined) updates.feedingSchedule = feedingSchedule;
  if (walkSchedule !== undefined) updates.walkSchedule = walkSchedule;
  if (status !== undefined) updates.status = status;
  if (isCastrated !== undefined) updates.isCastrated = isCastrated;
  const [pet] = await db.update(petsTable).set(updates)
    .where(and(eq(petsTable.crecheId, crecheId), eq(petsTable.id, petId))).returning();
  const [tutor] = pet?.tutorId
    ? await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, pet.tutorId)).limit(1)
    : [{ name: null }];
  res.json({ ...pet, tutorName: tutor?.name ?? null });

  // Fire-and-forget: if a care plan changed while the pet is checked in,
  // regenerate today's tasks immediately so staff see them without waiting for midnight.
  if (pet?.isCheckedIn && (feedingSchedule !== undefined || walkSchedule !== undefined)) {
    import("../lib/scheduler.js")
      .then(({ generateTasksForPetToday }) => generateTasksForPetToday(petId, crecheId))
      .catch((err: unknown) => console.error("[pets] plan task regen failed:", err));
  }
});

router.get("/:petId/vaccines", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const petId = parseInt(String(req.params.petId));
  const vaccines = await db.select().from(vaccinesTable)
    .where(and(eq(vaccinesTable.crecheId, crecheId), eq(vaccinesTable.petId, petId)));
  res.json(vaccines);
});

router.post("/:petId/vaccines", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const petId = parseInt(String(req.params.petId));
  const { name, appliedDate, nextDueDate, veterinarian, notes, receiptUrl } = req.body;
  const [vaccine] = await db.insert(vaccinesTable).values({
    petId, crecheId, name, appliedDate, nextDueDate, veterinarian, notes, receiptUrl,
  }).returning();
  res.status(201).json(vaccine);
});

router.get("/:petId/medications", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const petId = parseInt(String(req.params.petId));
  const meds = await db.select().from(medicationsTable)
    .where(and(eq(medicationsTable.crecheId, crecheId), eq(medicationsTable.petId, petId)));
  res.json(meds);
});

router.post("/:petId/medications", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const petId = parseInt(String(req.params.petId));
  const { name, dosage, frequency, startDate, endDate, times, notes } = req.body;
  const [med] = await db.insert(medicationsTable).values({
    petId, crecheId, name, dosage, frequency, startDate, endDate, times: times || [], notes,
  }).returning();
  res.status(201).json(med);
});

router.post("/:petId/medications/:medicationId/administer", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const petId = parseInt(String(req.params.petId));
  const medicationId = parseInt(String(req.params.medicationId));
  const { administeredBy, notes } = req.body;
  const [med] = await db.update(medicationsTable).set({
    lastAdministered: new Date(),
    administeredBy: administeredBy || req.user?.name,
    notes,
  }).where(and(
    eq(medicationsTable.id, medicationId),
    eq(medicationsTable.petId, petId),
    eq(medicationsTable.crecheId, crecheId)
  )).returning();
  res.json(med);
});


router.get("/:petId/walks", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const petId = parseInt(String(req.params.petId));
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
  const crecheId = parseInt(String(req.params.crecheId));
  const petId = parseInt(String(req.params.petId));
  const { db: dbConn } = await import("@workspace/db");
  const { walksTable } = await import("@workspace/db/schema");
  const { staffId, notes } = req.body;
  const [walk] = await dbConn.insert(walksTable).values({
    petId, crecheId, staffId: staffId || req.user?.id, notes, startTime: new Date(),
  }).returning();
  res.status(201).json({ ...walk, staffName: req.user?.name });
});

router.post("/:petId/walks/:walkId/end", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const petId = parseInt(String(req.params.petId));
  const walkId = parseInt(String(req.params.walkId));
  const { db: dbConn } = await import("@workspace/db");
  const { walksTable } = await import("@workspace/db/schema");
  const now = new Date();
  const [existing] = await dbConn.select().from(walksTable).where(eq(walksTable.id, walkId)).limit(1);
  const duration = existing ? Math.round((now.getTime() - new Date(existing.startTime).getTime()) / 60000) : 0;
  const [walk] = await dbConn.update(walksTable).set({
    endTime: now, status: "completed", durationMinutes: duration,
  }).where(and(eq(walksTable.id, walkId), eq(walksTable.petId, petId), eq(walksTable.crecheId, crecheId))).returning();
  res.json({ ...walk, staffName: req.user?.name });
});

// Force-checkout: libera um pet preso (isCheckedIn=true sem reserva ativa).
// Útil quando complete-service ou outro bug deixou o pet travado na creche.
router.post("/:petId/force-checkout", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (req.user.role === "tutor") { res.status(403).json({ error: "Sem permissão" }); return; }
  const crecheId = parseInt(String(req.params.crecheId));
  const petId = parseInt(String(req.params.petId));

  const [pet] = await db.select({ id: petsTable.id, isCheckedIn: petsTable.isCheckedIn })
    .from(petsTable)
    .where(and(eq(petsTable.id, petId), eq(petsTable.crecheId, crecheId)))
    .limit(1);

  if (!pet) { res.status(404).json({ error: "Pet não encontrado" }); return; }
  if (!pet.isCheckedIn) { res.status(400).json({ error: "Pet não está marcado como presente" }); return; }

  // Only allow if there's no active booking (if there is, use regular checkout)
  const [activeBooking] = await db.select({ id: bookingsTable.id })
    .from(bookingsTable)
    .where(and(
      eq(bookingsTable.crecheId, crecheId),
      eq(bookingsTable.petId, petId),
      eq(bookingsTable.status, "active"),
    )).limit(1);

  if (activeBooking) {
    res.status(409).json({ error: "Pet possui reserva ativa. Use o check-out normal." });
    return;
  }

  await db.update(petsTable).set({ isCheckedIn: false }).where(eq(petsTable.id, petId));
  await db.update(crechesTable).set({
    currentOccupancy: db.$count(petsTable, and(eq(petsTable.crecheId, crecheId), eq(petsTable.isCheckedIn, true))) as any,
  }).where(eq(crechesTable.id, crecheId));

  res.json({ ok: true, petId });
});

export default router;
