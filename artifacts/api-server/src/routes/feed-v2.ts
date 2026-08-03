import { Router } from "express";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  timelineEventsTable,
  timelineEventPetsTable,
  timelineLikesTable,
  timelineViewsTable,
  timelineCommentsTable,
  petsTable,
  usersTable,
} from "@workspace/db/schema";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { PushFeedNotificationService } from "../lib/notifications/PushFeedNotificationService.js";
import type { IFeedNotificationService } from "../lib/notifications/IFeedNotificationService.js";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MediaItemDTO {
  objectPath: string;
  type: "photo" | "video";
  order: number;
}

interface FeedPostDTO {
  id: number;
  type: string;
  content: string | null;
  mediaItems: MediaItemDTO[];
  author: { id: number; name: string };
  pets: Array<{ petId: number; petName: string }>;
  createdAt: string;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  isLiked: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

const ALLOWED_MEDIA_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "video/mp4", "video/quicktime", "video/webm"]);
const MAX_IMAGE_BYTES = 10_000_000;
const MAX_VIDEO_BYTES = 100_000_000;

// ── Service (injectable, swap to queue later) ─────────────────────────────────

const notificationService: IFeedNotificationService = new PushFeedNotificationService();

// ── DTO builder ───────────────────────────────────────────────────────────────

function buildMediaItems(
  mediaUrl: string | null | undefined,
  mediaType: string | null | undefined,
): MediaItemDTO[] {
  // Only emit a media item for properly stored object-storage paths.
  // Old V1 rows have raw base64 strings as mediaUrl; skip them so the
  // frontend never receives an invalid objectPath and the Service Worker
  // never tries new URL(base64String) which throws and kills the fetch handler.
  if (!mediaUrl || !mediaType) return [];
  if (!mediaUrl.startsWith("/objects/")) return [];
  const type = mediaType === "video" ? "video" : "photo";
  return [{ objectPath: mediaUrl, type, order: 0 }];
}

async function buildPostDTO(
  event: {
    id: number;
    authorId: number;
    authorName: string | null;
    type: string;
    content: string | null;
    mediaUrl: string | null;
    mediaType: string | null;
    createdAt: Date;
  },
  pets: Array<{ petId: number; petName: string }>,
  likeCount: number,
  commentCount: number,
  viewCount: number,
  isLiked: boolean,
): Promise<FeedPostDTO> {
  return {
    id: event.id,
    type: event.type,
    content: event.content,
    mediaItems: buildMediaItems(event.mediaUrl, event.mediaType),
    author: { id: event.authorId, name: event.authorName ?? "Desconhecido" },
    pets,
    createdAt: event.createdAt.toISOString(),
    likeCount,
    commentCount,
    viewCount,
    isLiked,
  };
}

// ── Aggregate helpers ─────────────────────────────────────────────────────────

async function fetchAggregates(eventIds: number[], userId: number) {
  if (eventIds.length === 0) {
    return { likeMap: {}, commentMap: {}, viewMap: {}, likedSet: new Set<number>() };
  }

  // Single query: one pass over each table per event_id, returned as one row per
  // event. Eliminates 3 of the 4 round-trips the old implementation made.
  const rows = await db.execute(sql`
    WITH
      lk AS (
        SELECT event_id,
               COUNT(*)::int                                             AS like_count,
               COUNT(*) FILTER (WHERE user_id = ${userId})::int         AS user_liked
        FROM   timeline_likes
        WHERE  event_id = ANY(${sql.raw(`ARRAY[${eventIds.join(",")}]::int[]`)})
        GROUP BY event_id
      ),
      cm AS (
        SELECT event_id, COUNT(*)::int AS comment_count
        FROM   timeline_comments
        WHERE  event_id = ANY(${sql.raw(`ARRAY[${eventIds.join(",")}]::int[]`)})
        GROUP BY event_id
      ),
      vw AS (
        SELECT event_id, COUNT(*)::int AS view_count
        FROM   timeline_views
        WHERE  event_id = ANY(${sql.raw(`ARRAY[${eventIds.join(",")}]::int[]`)})
        GROUP BY event_id
      ),
      ids AS (SELECT unnest(${sql.raw(`ARRAY[${eventIds.join(",")}]::int[]`)}) AS event_id)
    SELECT
      ids.event_id,
      COALESCE(lk.like_count, 0)    AS like_count,
      COALESCE(lk.user_liked, 0)    AS user_liked,
      COALESCE(cm.comment_count, 0) AS comment_count,
      COALESCE(vw.view_count, 0)    AS view_count
    FROM ids
    LEFT JOIN lk ON lk.event_id = ids.event_id
    LEFT JOIN cm ON cm.event_id = ids.event_id
    LEFT JOIN vw ON vw.event_id = ids.event_id
  `);

  const likeMap:    Record<number, number>  = {};
  const commentMap: Record<number, number>  = {};
  const viewMap:    Record<number, number>  = {};
  const likedSet = new Set<number>();

  for (const r of rows.rows as any[]) {
    const id = Number(r.event_id);
    likeMap[id]    = Number(r.like_count);
    commentMap[id] = Number(r.comment_count);
    viewMap[id]    = Number(r.view_count);
    if (Number(r.user_liked) > 0) likedSet.add(id);
  }

  return { likeMap, commentMap, viewMap, likedSet };
}

// ── Router ────────────────────────────────────────────────────────────────────

const router = Router({ mergeParams: true });

// All routes in this file require authentication
router.use(authenticate);

// ─────────────────────────────────────────────────────────────────────────────
// GET / — Paginated feed list
// ?after=<cursor>   cursor-based pagination (id of last seen item)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }

  const crecheId = parseInt(String(req.params.crecheId), 10);
  const userId   = req.user.id;
  const isTutor  = req.user.role === "tutor";
  const cursor   = req.query.after ? parseInt(String(req.query.after), 10) : null;

  // Base event columns
  const eventCols = {
    id:         timelineEventsTable.id,
    crecheId:   timelineEventsTable.crecheId,
    authorId:   timelineEventsTable.authorId,
    authorName: usersTable.name,
    type:       timelineEventsTable.type,
    content:    timelineEventsTable.content,
    mediaUrl:   timelineEventsTable.mediaUrl,
    mediaType:  timelineEventsTable.mediaType,
    createdAt:  timelineEventsTable.createdAt,
  };

  let events: typeof eventCols extends infer T ? Awaited<ReturnType<typeof db.select>>: never[];

  if (isTutor) {
    // Resolve which pets belong to this tutor in this creche
    const tutorPets = await db
      .select({ id: petsTable.id })
      .from(petsTable)
      .where(and(eq(petsTable.crecheId, crecheId), eq(petsTable.tutorId, userId)));

    if (tutorPets.length === 0) {
      res.json({ posts: [], nextCursor: null });
      return;
    }

    const tutorPetIds = tutorPets.map((p) => p.id);

    // Fetch events that include at least one of the tutor's pets (DISTINCT to
    // avoid duplicates when multiple tutor pets are in the same post)
    const whereClause = and(
      eq(timelineEventsTable.crecheId, crecheId),
      inArray(timelineEventPetsTable.petId, tutorPetIds),
      cursor != null ? lt(timelineEventsTable.id, cursor) : undefined,
    );

    events = await db
      .selectDistinct(eventCols)
      .from(timelineEventsTable)
      .leftJoin(usersTable, eq(timelineEventsTable.authorId, usersTable.id))
      .innerJoin(
        timelineEventPetsTable,
        eq(timelineEventPetsTable.eventId, timelineEventsTable.id),
      )
      .where(whereClause)
      .orderBy(desc(timelineEventsTable.id))
      .limit(PAGE_SIZE + 1) as any;
  } else {
    const whereClause = and(
      eq(timelineEventsTable.crecheId, crecheId),
      cursor != null ? lt(timelineEventsTable.id, cursor) : undefined,
    );

    events = await db
      .select(eventCols)
      .from(timelineEventsTable)
      .leftJoin(usersTable, eq(timelineEventsTable.authorId, usersTable.id))
      .where(whereClause)
      .orderBy(desc(timelineEventsTable.id))
      .limit(PAGE_SIZE + 1) as any;
  }

  // Determine next cursor
  const hasMore = events.length > PAGE_SIZE;
  const page = hasMore ? events.slice(0, PAGE_SIZE) : events;
  const nextCursor = hasMore ? page[page.length - 1].id : null;

  if (page.length === 0) {
    res.json({ posts: [], nextCursor: null });
    return;
  }

  const eventIds = page.map((e: any) => e.id as number);

  // Batch-fetch all pets for these events
  const allPets = await db
    .select({
      eventId:  timelineEventPetsTable.eventId,
      petId:    petsTable.id,
      petName:  petsTable.name,
      tutorId:  petsTable.tutorId,
    })
    .from(timelineEventPetsTable)
    .innerJoin(petsTable, eq(timelineEventPetsTable.petId, petsTable.id))
    .where(inArray(timelineEventPetsTable.eventId, eventIds));

  // For tutors: reuse the pet IDs already resolved above (no second DB query)
  let tutorPetIdSet: Set<number> | null = null;
  if (isTutor) {
    tutorPetIdSet = new Set(tutorPetIds);
  }

  // Batch aggregates
  const { likeMap, commentMap, viewMap, likedSet } = await fetchAggregates(eventIds, userId);

  // Build DTOs
  const posts = await Promise.all(
    page.map(async (event: any) => {
      let pets = allPets
        .filter((p) => p.eventId === event.id)
        .map((p) => ({ petId: p.petId, petName: p.petName }));

      // Tutors see only their own pets in the card
      if (tutorPetIdSet) {
        pets = pets.filter((p) => tutorPetIdSet!.has(p.petId));
      }

      return buildPostDTO(
        event,
        pets,
        likeMap[event.id]    ?? 0,
        commentMap[event.id] ?? 0,
        viewMap[event.id]    ?? 0,
        likedSet.has(event.id),
      );
    }),
  );

  res.json({ posts, nextCursor });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST / — Create a new post (staff / creche_admin only)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }
  if (req.user.role === "tutor") { res.status(403).json({ error: "Tutores não podem publicar" }); return; }

  const crecheId = parseInt(String(req.params.crecheId), 10);
  const userId   = req.user.id;
  const { type, content, mediaUrl, mediaType, petIds } = req.body as {
    type?: string;
    content?: string;
    mediaUrl?: string;
    mediaType?: string;
    petIds?: number[];
  };

  // Validation
  if (!Array.isArray(petIds) || petIds.length === 0) {
    res.status(400).json({ error: "Selecione pelo menos um pet." });
    return;
  }

  if (!content?.trim() && !mediaUrl) {
    res.status(400).json({ error: "Informe uma legenda ou selecione uma mídia." });
    return;
  }

  const validTypes = ["photo", "video", "note", "play", "walk", "feeding", "medication", "health", "check_in", "check_out"];
  const resolvedType = type ?? (mediaType === "video" ? "video" : mediaUrl ? "photo" : "note");
  if (!validTypes.includes(resolvedType)) {
    res.status(400).json({ error: "Tipo de publicação inválido." });
    return;
  }

  // Backend media validation
  if (mediaUrl && mediaType) {
    if (!["photo", "video"].includes(mediaType)) {
      res.status(400).json({ error: "Tipo de mídia inválido." });
      return;
    }
    if (!mediaUrl.startsWith("/objects/")) {
      res.status(400).json({ error: "URL de mídia inválida." });
      return;
    }
  }

  // Persist event + pet relations in a transaction
  const [event] = await db.transaction(async (tx) => {
    const [newEvent] = await tx
      .insert(timelineEventsTable)
      .values({
        crecheId,
        authorId: userId,
        type: resolvedType as any,
        content:  content?.trim() || null,
        mediaUrl:  mediaUrl  || null,
        mediaType: (mediaType as any) || null,
      })
      .returning();

    if (petIds.length > 0) {
      await tx.insert(timelineEventPetsTable).values(
        petIds.map((petId) => ({ eventId: newEvent.id, petId })),
      );
    }

    return [newEvent];
  });

  // Build full DTO so the frontend can prepend immediately without a second GET
  const pets = await db
    .select({ petId: petsTable.id, petName: petsTable.name })
    .from(timelineEventPetsTable)
    .innerJoin(petsTable, eq(timelineEventPetsTable.petId, petsTable.id))
    .where(eq(timelineEventPetsTable.eventId, event.id));

  const dto = await buildPostDTO(
    { ...event, authorName: req.user.name },
    pets,
    0, 0, 0, false,
  );

  // HTTP 201 sent immediately — push notifications dispatched after
  res.status(201).json({ post: dto });

  notificationService.onPostPublished({
    postId:     event.id,
    type:       event.type,
    authorName: req.user.name,
    crecheId,
    petIds,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:id — Fetch details for a specific event (backward compatibility for V1 frontend)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:id", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }
  const crecheId = parseInt(String(req.params.crecheId), 10);
  const eventId  = parseInt(String(req.params.id), 10);
  const userId   = req.user.id;

  const [event] = await db
    .select({
      id:          timelineEventsTable.id,
      crecheId:    timelineEventsTable.crecheId,
      authorId:    timelineEventsTable.authorId,
      authorName:  usersTable.name,
      type:        timelineEventsTable.type,
      content:     timelineEventsTable.content,
      mediaUrl:    timelineEventsTable.mediaUrl,
      mediaType:   timelineEventsTable.mediaType,
      createdAt:   timelineEventsTable.createdAt,
      likeCount:   sql<number>`(SELECT COUNT(*) FROM timeline_likes WHERE event_id = ${timelineEventsTable.id})::int`,
      isLikedByUser: sql<boolean>`EXISTS(SELECT 1 FROM timeline_likes WHERE event_id = ${timelineEventsTable.id} AND user_id = ${userId})`,
    })
    .from(timelineEventsTable)
    .leftJoin(usersTable, eq(timelineEventsTable.authorId, usersTable.id))
    .where(and(eq(timelineEventsTable.id, eventId), eq(timelineEventsTable.crecheId, crecheId)))
    .limit(1);

  if (!event) { res.status(404).json({ error: "Evento não encontrado" }); return; }

  const pets = await db
    .select({ petId: petsTable.id, petName: petsTable.name, petPhoto: petsTable.photoUrl })
    .from(timelineEventPetsTable)
    .innerJoin(petsTable, eq(timelineEventPetsTable.petId, petsTable.id))
    .where(eq(timelineEventPetsTable.eventId, eventId));

  let mediaUrl: string | null | undefined = event.mediaUrl;
  if (mediaUrl && mediaUrl.startsWith("/objects/")) {
    mediaUrl = `/api/storage${mediaUrl}`;
  }

  res.json({ ...event, mediaUrl, pets });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /:id — Edit caption (author or creche_admin)
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/:id", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }
  if (req.user.role === "tutor") { res.status(403).json({ error: "Sem permissão" }); return; }

  const crecheId = parseInt(String(req.params.crecheId), 10);
  const eventId  = parseInt(String(req.params.id), 10);
  const { content } = req.body as { content?: string };

  if (content === undefined) {
    res.status(400).json({ error: "Campo 'content' obrigatório" });
    return;
  }

  const [existing] = await db
    .select({ authorId: timelineEventsTable.authorId })
    .from(timelineEventsTable)
    .where(and(eq(timelineEventsTable.id, eventId), eq(timelineEventsTable.crecheId, crecheId)))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Publicação não encontrada" }); return; }

  if (req.user.role !== "creche_admin" && existing.authorId !== req.user.id) {
    res.status(403).json({ error: "Sem permissão para editar esta publicação" });
    return;
  }

  const [updated] = await db
    .update(timelineEventsTable)
    .set({ content: content.trim() || null })
    .where(and(eq(timelineEventsTable.id, eventId), eq(timelineEventsTable.crecheId, crecheId)))
    .returning();

  res.json({ ok: true, content: updated.content });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:id — Delete post (staff / creche_admin only)
// ─────────────────────────────────────────────────────────────────────────────
router.delete("/:id", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }
  if (req.user.role === "tutor") { res.status(403).json({ error: "Sem permissão" }); return; }

  const crecheId = parseInt(String(req.params.crecheId), 10);
  const eventId  = parseInt(String(req.params.id), 10);

  const [existing] = await db
    .select({ id: timelineEventsTable.id })
    .from(timelineEventsTable)
    .where(and(eq(timelineEventsTable.id, eventId), eq(timelineEventsTable.crecheId, crecheId)))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Publicação não encontrada" }); return; }

  // Wrap all deletes in a transaction to prevent orphans
  await db.transaction(async (tx) => {
    await tx.delete(timelineEventPetsTable).where(eq(timelineEventPetsTable.eventId, eventId));
    await tx.delete(timelineLikesTable).where(eq(timelineLikesTable.eventId, eventId));
    await tx.delete(timelineViewsTable).where(eq(timelineViewsTable.eventId, eventId));
    await tx.delete(timelineCommentsTable).where(eq(timelineCommentsTable.eventId, eventId));
    await tx.delete(timelineEventsTable).where(eq(timelineEventsTable.id, eventId));
  });

  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/like — Toggle like (all authenticated users)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/:id/like", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }

  const eventId = parseInt(String(req.params.id), 10);
  const userId  = req.user.id;

  const [existing] = await db
    .select({ id: timelineLikesTable.id })
    .from(timelineLikesTable)
    .where(and(eq(timelineLikesTable.eventId, eventId), eq(timelineLikesTable.userId, userId)))
    .limit(1);

  if (existing) {
    await db
      .delete(timelineLikesTable)
      .where(and(eq(timelineLikesTable.eventId, eventId), eq(timelineLikesTable.userId, userId)));
  } else {
    await db.insert(timelineLikesTable).values({ eventId, userId });
  }

  const [countRow] = await db
    .select({ cnt: sql<number>`cast(count(*) as int)` })
    .from(timelineLikesTable)
    .where(eq(timelineLikesTable.eventId, eventId));

  res.json({ liked: !existing, likeCount: countRow?.cnt ?? 0 });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/view — Record view (all authenticated users, idempotent)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/:id/view", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }

  const eventId = parseInt(String(req.params.id), 10);
  const userId  = req.user.id;

  const [existing] = await db
    .select({ id: timelineViewsTable.eventId })
    .from(timelineViewsTable)
    .where(and(eq(timelineViewsTable.eventId, eventId), eq(timelineViewsTable.userId, userId)))
    .limit(1);

  if (!existing) {
    await db.insert(timelineViewsTable).values({ eventId, userId });
  }

  res.json({ viewed: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:id/comments — List comments (all authenticated)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:id/comments", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }

  const eventId = parseInt(String(req.params.id), 10);

  const comments = await db
    .select({
      id:        timelineCommentsTable.id,
      eventId:   timelineCommentsTable.eventId,
      userId:    timelineCommentsTable.userId,
      userName:  usersTable.name,
      content:   timelineCommentsTable.content,
      createdAt: timelineCommentsTable.createdAt,
    })
    .from(timelineCommentsTable)
    .leftJoin(usersTable, eq(timelineCommentsTable.userId, usersTable.id))
    .where(eq(timelineCommentsTable.eventId, eventId))
    .orderBy(timelineCommentsTable.createdAt);

  res.json(comments);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/comments — Add comment (all authenticated)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/:id/comments", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }

  const eventId = parseInt(String(req.params.id), 10);
  const userId  = req.user.id;
  const { content } = req.body as { content?: string };

  if (!content?.trim()) {
    res.status(400).json({ error: "Comentário não pode estar vazio" });
    return;
  }

  const [comment] = await db
    .insert(timelineCommentsTable)
    .values({ eventId, userId, content: content.trim() })
    .returning();

  // Return comment with author name
  const [withAuthor] = await db
    .select({
      id:        timelineCommentsTable.id,
      eventId:   timelineCommentsTable.eventId,
      userId:    timelineCommentsTable.userId,
      userName:  usersTable.name,
      content:   timelineCommentsTable.content,
      createdAt: timelineCommentsTable.createdAt,
    })
    .from(timelineCommentsTable)
    .leftJoin(usersTable, eq(timelineCommentsTable.userId, usersTable.id))
    .where(eq(timelineCommentsTable.id, comment.id))
    .limit(1);

  // Return updated comment count so the caller can update the UI optimistically
  const [countRow] = await db
    .select({ cnt: sql<number>`cast(count(*) as int)` })
    .from(timelineCommentsTable)
    .where(eq(timelineCommentsTable.eventId, eventId));

  res.status(201).json({ comment: withAuthor, commentCount: countRow?.cnt ?? 0 });
});

export default router;
