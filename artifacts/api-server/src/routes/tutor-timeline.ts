import { Router } from "express";
import { db } from "@workspace/db";
import { timelineEventsTable, petsTable, usersTable } from "@workspace/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { requireCrecheMembership } from "../middlewares/requireCrecheMembership.js";

const router = Router({ mergeParams: true });
router.use(authenticate);
router.use(requireCrecheMembership);

/**
 * GET /api/creches/:crecheId/tutor-timeline?tutorId=X&limit=N
 *
 * Returns timeline events for ALL pets belonging to a tutor in a single
 * optimised JOIN query — no client-side filtering needed.
 * If tutorId is omitted, falls back to the authenticated user's id.
 */
router.get("/", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const tutorId = req.query.tutorId
    ? parseInt(String(req.query.tutorId))
    : req.user?.id;
  const limit = req.query.limit
    ? Math.min(parseInt(String(req.query.limit)), 100)
    : 50;
  const userId = req.user?.id ?? 0;

  if (!tutorId) {
    res.status(400).json({ error: "tutorId is required" });
    return;
  }

  const events = await db
    .select({
      id: timelineEventsTable.id,
      petId: timelineEventsTable.petId,
      petName: petsTable.name,
      petPhotoUrl: petsTable.photoUrl,
      authorId: timelineEventsTable.authorId,
      authorName: usersTable.name,
      type: timelineEventsTable.type,
      content: timelineEventsTable.content,
      mediaUrl: timelineEventsTable.mediaUrl,
      mediaType: timelineEventsTable.mediaType,
      createdAt: timelineEventsTable.createdAt,
      likeCount: sql<number>`(SELECT COUNT(*) FROM timeline_likes WHERE event_id = ${timelineEventsTable.id})::int`,
      isLikedByUser: sql<boolean>`EXISTS(SELECT 1 FROM timeline_likes WHERE event_id = ${timelineEventsTable.id} AND user_id = ${userId})`,
    })
    .from(timelineEventsTable)
    .innerJoin(
      petsTable,
      and(
        eq(timelineEventsTable.petId, petsTable.id),
        eq(petsTable.tutorId, tutorId)
      )
    )
    .leftJoin(usersTable, eq(timelineEventsTable.authorId, usersTable.id))
    .where(eq(timelineEventsTable.crecheId, crecheId))
    .orderBy(desc(timelineEventsTable.createdAt))
    .limit(limit);

  res.json(events);
});

export default router;
