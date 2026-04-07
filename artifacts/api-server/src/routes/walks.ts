import { Router } from "express";
import { db } from "@workspace/db";
import { walksTable, petsTable, usersTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";

const router = Router({ mergeParams: true });
router.use(authenticate);

router.get("/", async (req: AuthRequest, res) => {
  const crecheId = parseInt(req.params.crecheId);
  const petId = req.params.petId ? parseInt(req.params.petId) : (req.query.petId ? parseInt(req.query.petId as string) : null);
  const conditions: any[] = [eq(walksTable.crecheId, crecheId)];
  if (petId) conditions.push(eq(walksTable.petId, petId));

  const walks = await db.select({
    id: walksTable.id,
    petId: walksTable.petId,
    petName: petsTable.name,
    crecheId: walksTable.crecheId,
    staffId: walksTable.staffId,
    staffName: usersTable.name,
    startedAt: walksTable.startTime,
    endedAt: walksTable.endTime,
    durationMinutes: walksTable.durationMinutes,
    notes: walksTable.notes,
    status: walksTable.status,
  })
    .from(walksTable)
    .leftJoin(petsTable, eq(walksTable.petId, petsTable.id))
    .leftJoin(usersTable, eq(walksTable.staffId, usersTable.id))
    .where(and(...conditions))
    .orderBy(walksTable.startTime);
  res.json(walks);
});

router.post("/", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const crecheId = parseInt(req.params.crecheId);
  const { petId } = req.body;
  if (!petId) { res.status(400).json({ error: "petId is required" }); return; }
  const [walk] = await db.insert(walksTable).values({
    crecheId,
    petId: parseInt(petId),
    staffId: req.user.id,
    startTime: new Date(),
    status: "in_progress",
  }).returning();
  const [pet] = await db.select({ name: petsTable.name }).from(petsTable).where(eq(petsTable.id, petId)).limit(1);
  res.status(201).json({ ...walk, petName: pet?.name ?? null, staffName: req.user.name, startedAt: walk.startTime, endedAt: walk.endTime });
});

router.put("/:walkId/end", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const crecheId = parseInt(req.params.crecheId);
  const walkId = parseInt(req.params.walkId);
  const { notes } = req.body || {};
  const endTime = new Date();
  const [existing] = await db.select().from(walksTable).where(and(eq(walksTable.id, walkId), eq(walksTable.crecheId, crecheId))).limit(1);
  if (!existing) { res.status(404).json({ error: "Walk not found" }); return; }
  const duration = existing.startTime ? Math.round((endTime.getTime() - existing.startTime.getTime()) / 60000) : null;
  const [walk] = await db.update(walksTable).set({
    endTime, status: "completed", durationMinutes: duration ?? undefined, notes,
  }).where(and(eq(walksTable.id, walkId), eq(walksTable.crecheId, crecheId))).returning();
  const [pet] = await db.select({ name: petsTable.name }).from(petsTable).where(eq(petsTable.id, walk.petId)).limit(1);
  res.json({ ...walk, petName: pet?.name ?? null, staffName: req.user.name, startedAt: walk.startTime, endedAt: walk.endTime });
});

export default router;
