import { Router } from "express";
import { db } from "@workspace/db";
import { petsTable, usersTable, vaccinesTable, medicationsTable } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";

const router = Router({ mergeParams: true });
router.use(authenticate);

router.get("/", async (req: AuthRequest, res) => {
  const crecheId = parseInt(req.params.crecheId);
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
    isCheckedIn: petsTable.isCheckedIn,
    feedingSchedule: petsTable.feedingSchedule,
    status: petsTable.status,
    createdAt: petsTable.createdAt,
  })
    .from(petsTable)
    .leftJoin(usersTable, eq(petsTable.tutorId, usersTable.id))
    .where(and(...conditions));

  res.json(pets);
});

router.post("/", async (req: AuthRequest, res) => {
  const crecheId = parseInt(req.params.crecheId);
  const { tutorId, name, species, breed, birthDate, gender, weight, color, temperament, allergies, specialNeeds, photoUrl, feedingSchedule } = req.body;
  const [pet] = await db.insert(petsTable).values({
    crecheId, tutorId, name, species, breed, birthDate, gender: gender || "unknown",
    weight, color, temperament, allergies, specialNeeds, photoUrl, feedingSchedule,
  }).returning();
  res.status(201).json({ ...pet, tutorName: null });
});

router.get("/:petId", async (req: AuthRequest, res) => {
  const crecheId = parseInt(req.params.crecheId);
  const petId = parseInt(req.params.petId);
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
    isCheckedIn: petsTable.isCheckedIn,
    feedingSchedule: petsTable.feedingSchedule,
    status: petsTable.status,
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
  const crecheId = parseInt(req.params.crecheId);
  const petId = parseInt(req.params.petId);
  const { name, breed, birthDate, weight, color, temperament, allergies, specialNeeds, photoUrl, feedingSchedule, status } = req.body;
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
  if (status !== undefined) updates.status = status;
  const [pet] = await db.update(petsTable).set(updates)
    .where(and(eq(petsTable.crecheId, crecheId), eq(petsTable.id, petId))).returning();
  res.json({ ...pet, tutorName: null });
});

router.get("/:petId/vaccines", async (req: AuthRequest, res) => {
  const crecheId = parseInt(req.params.crecheId);
  const petId = parseInt(req.params.petId);
  const vaccines = await db.select().from(vaccinesTable)
    .where(and(eq(vaccinesTable.crecheId, crecheId), eq(vaccinesTable.petId, petId)));
  res.json(vaccines);
});

router.post("/:petId/vaccines", async (req: AuthRequest, res) => {
  const crecheId = parseInt(req.params.crecheId);
  const petId = parseInt(req.params.petId);
  const { name, appliedDate, nextDueDate, veterinarian, notes, receiptUrl } = req.body;
  const [vaccine] = await db.insert(vaccinesTable).values({
    petId, crecheId, name, appliedDate, nextDueDate, veterinarian, notes, receiptUrl,
  }).returning();
  res.status(201).json(vaccine);
});

router.get("/:petId/medications", async (req: AuthRequest, res) => {
  const crecheId = parseInt(req.params.crecheId);
  const petId = parseInt(req.params.petId);
  const meds = await db.select().from(medicationsTable)
    .where(and(eq(medicationsTable.crecheId, crecheId), eq(medicationsTable.petId, petId)));
  res.json(meds);
});

router.post("/:petId/medications", async (req: AuthRequest, res) => {
  const crecheId = parseInt(req.params.crecheId);
  const petId = parseInt(req.params.petId);
  const { name, dosage, frequency, startDate, endDate, times, notes } = req.body;
  const [med] = await db.insert(medicationsTable).values({
    petId, crecheId, name, dosage, frequency, startDate, endDate, times: times || [], notes,
  }).returning();
  res.status(201).json(med);
});

router.post("/:petId/medications/:medicationId/administer", async (req: AuthRequest, res) => {
  const crecheId = parseInt(req.params.crecheId);
  const petId = parseInt(req.params.petId);
  const medicationId = parseInt(req.params.medicationId);
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

router.get("/:petId/timeline", async (req: AuthRequest, res) => {
  const crecheId = parseInt(req.params.crecheId);
  const petId = parseInt(req.params.petId);
  const { db: dbConn } = await import("@workspace/db");
  const { timelineEventsTable } = await import("@workspace/db/schema");
  const events = await dbConn.select({
    id: timelineEventsTable.id,
    crecheId: timelineEventsTable.crecheId,
    petId: timelineEventsTable.petId,
    authorId: timelineEventsTable.authorId,
    authorName: usersTable.name,
    type: timelineEventsTable.type,
    content: timelineEventsTable.content,
    mediaUrl: timelineEventsTable.mediaUrl,
    mediaType: timelineEventsTable.mediaType,
    createdAt: timelineEventsTable.createdAt,
  })
    .from(timelineEventsTable)
    .leftJoin(usersTable, eq(timelineEventsTable.authorId, usersTable.id))
    .where(and(eq(timelineEventsTable.crecheId, crecheId), eq(timelineEventsTable.petId, petId)))
    .orderBy(sql`${timelineEventsTable.createdAt} DESC`);
  res.json(events);
});

router.post("/:petId/timeline", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const crecheId = parseInt(req.params.crecheId);
  const petId = parseInt(req.params.petId);
  const { db: dbConn } = await import("@workspace/db");
  const { timelineEventsTable } = await import("@workspace/db/schema");
  const { type, content, mediaUrl, mediaType } = req.body;
  const [event] = await dbConn.insert(timelineEventsTable).values({
    crecheId, petId, authorId: req.user.id, type, content, mediaUrl, mediaType,
  }).returning();
  res.status(201).json({ ...event, authorName: req.user.name });
});

router.get("/:petId/walks", async (req: AuthRequest, res) => {
  const crecheId = parseInt(req.params.crecheId);
  const petId = parseInt(req.params.petId);
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
  const crecheId = parseInt(req.params.crecheId);
  const petId = parseInt(req.params.petId);
  const { db: dbConn } = await import("@workspace/db");
  const { walksTable } = await import("@workspace/db/schema");
  const { staffId, notes } = req.body;
  const [walk] = await dbConn.insert(walksTable).values({
    petId, crecheId, staffId: staffId || req.user?.id, notes, startTime: new Date(),
  }).returning();
  res.status(201).json({ ...walk, staffName: req.user?.name });
});

router.post("/:petId/walks/:walkId/end", async (req: AuthRequest, res) => {
  const crecheId = parseInt(req.params.crecheId);
  const petId = parseInt(req.params.petId);
  const walkId = parseInt(req.params.walkId);
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

export default router;
