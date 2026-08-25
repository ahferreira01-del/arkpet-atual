import { Router } from "express";
import { db } from "@workspace/db";
import {
  timelineEventsTable,
  timelineEventPetsTable,
  petsTable,
  usersTable,
  timelineLikesTable,
} from "@workspace/db/schema";
import { eq, and, desc, asc, inArray, sql } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { requireCrecheMembership } from "../middlewares/requireCrecheMembership.js";

const router = Router({ mergeParams: true });
router.use(authenticate);
router.use(requireCrecheMembership);

/**
 * GET /api/creches/:crecheId/tutor-timeline?tutorId=X&limit=N
 *
 * Returns timeline events for ALL pets belonging to a target tutor in a single
 * batch-aggregated query — unique per timeline_event.id.
 */
router.get("/", async (req: AuthRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }

  const crecheId = parseInt(String(req.params.crecheId), 10);
  if (Number.isNaN(crecheId) || crecheId <= 0) {
    res.status(400).json({ error: "ID de creche inválido" });
    return;
  }

  const limitParam = req.query.limit;
  let limit = 50;
  if (limitParam !== undefined) {
    const parsedLimit = parseInt(String(limitParam), 10);
    if (Number.isNaN(parsedLimit) || parsedLimit <= 0) {
      res.status(400).json({ error: "Parâmetro limit inválido" });
      return;
    }
    limit = Math.min(parsedLimit, 100);
  }

  let targetTutorId: number;

  // 1. Target Tutor Authorization & Resolution
  if (req.user.role === "tutor") {
    if (req.query.tutorId !== undefined) {
      const parsedTutorId = Number(req.query.tutorId);
      if (Number.isNaN(parsedTutorId) || !Number.isInteger(parsedTutorId) || parsedTutorId <= 0) {
        res.status(400).json({ error: "ID de tutor inválido" });
        return;
      }
      if (parsedTutorId !== req.user.id) {
        res.status(403).json({ error: "Acesso não autorizado à timeline de outro tutor" });
        return;
      }
    }
    targetTutorId = req.user.id;
  } else {
    // Staff, Creche Admin, Master Admin must supply an explicit tutorId
    if (req.query.tutorId === undefined) {
      res.status(400).json({ error: "tutorId é obrigatório para esta consulta" });
      return;
    }

    const parsedTutorId = Number(req.query.tutorId);
    if (Number.isNaN(parsedTutorId) || !Number.isInteger(parsedTutorId) || parsedTutorId <= 0) {
      res.status(400).json({ error: "ID de tutor inválido" });
      return;
    }

    const [targetUser] = await db
      .select({
        id: usersTable.id,
        role: usersTable.role,
        crecheId: usersTable.crecheId,
      })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.id, parsedTutorId),
          eq(usersTable.role, "tutor"),
          eq(usersTable.crecheId, crecheId),
        ),
      )
      .limit(1);

    if (!targetUser) {
      res.status(404).json({ error: "Tutor não encontrado nesta creche" });
      return;
    }

    targetTutorId = targetUser.id;
  }

  // 2. Fetch Unique Events (bounded by limit on unique timeline_events.id)
  const events = await db
    .select({
      id: timelineEventsTable.id,
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
    .where(
      and(
        eq(timelineEventsTable.crecheId, crecheId),
        sql`EXISTS (
          SELECT 1 FROM ${timelineEventPetsTable}
          INNER JOIN ${petsTable} ON ${timelineEventPetsTable.petId} = ${petsTable.id}
          WHERE ${timelineEventPetsTable.eventId} = ${timelineEventsTable.id}
            AND ${petsTable.tutorId} = ${targetTutorId}
        )`,
      ),
    )
    .orderBy(desc(timelineEventsTable.createdAt), desc(timelineEventsTable.id))
    .limit(limit);

  if (events.length === 0) {
    res.json([]);
    return;
  }

  const eventIds = events.map((e) => e.id);

  // 3. Batch-fetch only target tutor's pets for these events
  const eventPets = await db
    .select({
      eventId: timelineEventPetsTable.eventId,
      petId: petsTable.id,
      petName: petsTable.name,
      petPhotoUrl: petsTable.photoUrl,
    })
    .from(timelineEventPetsTable)
    .innerJoin(petsTable, eq(timelineEventPetsTable.petId, petsTable.id))
    .where(
      and(
        inArray(timelineEventPetsTable.eventId, eventIds),
        eq(petsTable.tutorId, targetTutorId),
      ),
    )
    .orderBy(asc(petsTable.id));

  // 4. Batch-fetch like aggregates
  const userId = req.user.id;
  const likesData = await db
    .select({
      eventId: timelineLikesTable.eventId,
      likeCount: sql<number>`COUNT(*)::int`,
      isLikedByUser: sql<boolean>`BOOL_OR(${timelineLikesTable.userId} = ${userId})`,
    })
    .from(timelineLikesTable)
    .where(inArray(timelineLikesTable.eventId, eventIds))
    .groupBy(timelineLikesTable.eventId);

  const likeMap: Record<number, { likeCount: number; isLikedByUser: boolean }> = {};
  for (const l of likesData) {
    likeMap[l.eventId] = {
      likeCount: l.likeCount,
      isLikedByUser: l.isLikedByUser ?? false,
    };
  }

  // 5. Aggregate pets per event and build DTOs
  const petsByEvent: Record<
    number,
    Array<{ petId: number; petName: string; petPhotoUrl: string | null }>
  > = {};
  for (const p of eventPets) {
    if (!petsByEvent[p.eventId]) {
      petsByEvent[p.eventId] = [];
    }
    petsByEvent[p.eventId].push(p);
  }

  const eventsForClient = events.map((event) => {
    const pets = petsByEvent[event.id] || [];
    const representativePet = pets[0] || {
      petId: 0,
      petName: "",
      petPhotoUrl: null,
    };

    // If 1 pet: exact petName. If > 1 pet: "Thor, Bob" (joined with ", ")
    const aggregatedPetName = pets.map((p) => p.petName).join(", ");

    const likeInfo = likeMap[event.id] || { likeCount: 0, isLikedByUser: false };

    return {
      id: event.id,
      petId: representativePet.petId,
      petName: aggregatedPetName,
      petPhotoUrl: representativePet.petPhotoUrl,
      authorId: event.authorId,
      authorName: event.authorName,
      type: event.type,
      content: event.content,
      mediaUrl:
        typeof event.mediaUrl === "string" && event.mediaUrl.startsWith("data:")
          ? null
          : event.mediaUrl,
      mediaType: event.mediaType,
      createdAt: event.createdAt,
      likeCount: likeInfo.likeCount,
      isLikedByUser: likeInfo.isLikedByUser,
      hasMedia: !!event.mediaUrl,
    };
  });

  res.json(eventsForClient);
});

export default router;
