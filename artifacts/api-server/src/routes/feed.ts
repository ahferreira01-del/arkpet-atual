import { Router } from "express";
import { and, desc, eq, sql, inArray, isNotNull } from "drizzle-orm";
import { type AuthRequest } from "../middlewares/authenticate.js";
import { 
  timelineEventsTable, 
  timelineEventPetsTable,
  timelineLikesTable,
  timelineViewsTable,
  timelineCommentsTable,
  petsTable, 
  usersTable 
} from "@workspace/db/schema";
import { db } from "@workspace/db";
import { sendPushToUser } from "../lib/push.js";

const router = Router({ mergeParams: true });

// Listar o Feed
router.get("/", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }
  const crecheId = parseInt(String(req.params.crecheId));
  const userId = req.user.id;
  const isTutor = req.user.role === "tutor";

  // Se for tutor, achar os pets dele
  let tutorPetIds: number[] = [];
  if (isTutor) {
    const tutorPets = await db.select({ id: petsTable.id }).from(petsTable)
      .where(and(eq(petsTable.crecheId, crecheId), eq(petsTable.tutorId, userId)));
    tutorPetIds = tutorPets.map(p => p.id);
    if (tutorPetIds.length === 0) {
      res.json([]);
      return;
    }
  }

  // Buscar todos os eventos da creche
  const events = await db.select({
    id: timelineEventsTable.id,
    crecheId: timelineEventsTable.crecheId,
    authorId: timelineEventsTable.authorId,
    authorName: usersTable.name,
    type: timelineEventsTable.type,
    content: timelineEventsTable.content,
    mediaUrl: timelineEventsTable.mediaUrl,
    mediaType: timelineEventsTable.mediaType,
    createdAt: timelineEventsTable.createdAt,
    likeCount: sql<number>`(SELECT COUNT(*) FROM timeline_likes WHERE event_id = ${timelineEventsTable.id})::int`,
    commentCount: sql<number>`(SELECT COUNT(*) FROM timeline_comments WHERE event_id = ${timelineEventsTable.id})::int`,
    viewCount: sql<number>`(SELECT COUNT(*) FROM timeline_views WHERE event_id = ${timelineEventsTable.id})::int`,
    isLikedByUser: sql<boolean>`EXISTS(SELECT 1 FROM timeline_likes WHERE event_id = ${timelineEventsTable.id} AND user_id = ${userId})`,
    isViewedByUser: sql<boolean>`EXISTS(SELECT 1 FROM timeline_views WHERE event_id = ${timelineEventsTable.id} AND user_id = ${userId})`,
  })
  .from(timelineEventsTable)
  .leftJoin(usersTable, eq(timelineEventsTable.authorId, usersTable.id))
  .where(eq(timelineEventsTable.crecheId, crecheId))
  .orderBy(desc(timelineEventsTable.createdAt))
  .limit(50); // limit for now

  // Pegar os pets marcados em cada evento
  const eventIds = events.map(e => e.id);
  let eventPets: any[] = [];
  if (eventIds.length > 0) {
    eventPets = await db.select({
      eventId: timelineEventPetsTable.eventId,
      petId: petsTable.id,
      petName: petsTable.name,
      petPhoto: petsTable.photoUrl
    })
    .from(timelineEventPetsTable)
    .innerJoin(petsTable, eq(timelineEventPetsTable.petId, petsTable.id))
    .where(inArray(timelineEventPetsTable.eventId, eventIds));
  }

  // Agrupar e filtrar para tutores
  let feed = events.map(e => {
    const pets = eventPets.filter(ep => ep.eventId === e.id);
    return { ...e, pets };
  });

  if (isTutor) {
    // Manter apenas eventos onde pelo menos 1 pet do tutor está marcado
    feed = feed.filter(e => e.pets.some(p => tutorPetIds.includes(p.petId)));
    
    // Filtrar a lista de pets para mostrar APENAS os pets do tutor no evento
    feed = feed.map(e => ({
      ...e,
      pets: e.pets.filter(p => tutorPetIds.includes(p.petId))
    }));
  }

  res.json(feed);
});

// Criar Post
router.post("/", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }
  if (req.user.role === "tutor") { res.status(403).json({ error: "Sem permissão" }); return; }
  
  const crecheId = parseInt(String(req.params.crecheId));
  const { type, content, mediaUrl, mediaType, petIds } = req.body;

  if (!petIds || !Array.isArray(petIds) || petIds.length === 0) {
    res.status(400).json({ error: "Selecione pelo menos um pet" });
    return;
  }

  const [event] = await db.insert(timelineEventsTable).values({
    crecheId,
    authorId: req.user.id,
    type,
    content,
    mediaUrl,
    mediaType,
  }).returning();

  const eventPetsToInsert = petIds.map((petId: number) => ({
    eventId: event.id,
    petId
  }));
  await db.insert(timelineEventPetsTable).values(eventPetsToInsert);

  // Enviar notificações
  const pets = await db.select().from(petsTable).where(inArray(petsTable.id, petIds));
  const typeLabels: Record<string, string> = {
    photo: "📸 Nova foto",
    note: "📝 Nova nota",
    play: "🎾 Momento de brincadeira",
    walk: "🦮 Passeio",
    feeding: "🍽️ Alimentação",
    medication: "💊 Medicação",
    health: "🩺 Registro de saúde",
    check_in: "✅ Check-in",
    check_out: "👋 Check-out",
  };
  const title = typeLabels[type] || "Atualização na creche";

  // Notify tutors exactly once
  const tutorIdsToNotify = new Set<number>();
  for (const p of pets) {
    if (p.tutorId) tutorIdsToNotify.add(p.tutorId);
  }

  for (const tutorId of tutorIdsToNotify) {
    // get pet names for this tutor that were involved
    const tutorPetsInvolved = pets.filter(p => p.tutorId === tutorId).map(p => p.name).join(", ");
    await sendPushToUser(tutorId, { title, body: `Atualização sobre ${tutorPetsInvolved}` });
  }

  res.json({ ok: true, event });
});

// Curtir Post
router.post("/:eventId/like", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }
  const eventId = parseInt(String(req.params.eventId));
  const userId = req.user.id;

  const existing = await db.select().from(timelineLikesTable)
    .where(and(eq(timelineLikesTable.eventId, eventId), eq(timelineLikesTable.userId, userId)))
    .limit(1);

  if (existing.length > 0) {
    await db.delete(timelineLikesTable)
      .where(and(eq(timelineLikesTable.eventId, eventId), eq(timelineLikesTable.userId, userId)));
    res.json({ liked: false });
  } else {
    await db.insert(timelineLikesTable).values({ eventId, userId });
    res.json({ liked: true });
  }
});

// Visualizar Post
router.post("/:eventId/view", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }
  const eventId = parseInt(String(req.params.eventId));
  const userId = req.user.id;

  const existing = await db.select().from(timelineViewsTable)
    .where(and(eq(timelineViewsTable.eventId, eventId), eq(timelineViewsTable.userId, userId)))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(timelineViewsTable).values({ eventId, userId });
  }
  res.json({ viewed: true });
});

// Comentários
router.get("/:eventId/comments", async (req: AuthRequest, res) => {
  const eventId = parseInt(String(req.params.eventId));
  const comments = await db.select({
    id: timelineCommentsTable.id,
    eventId: timelineCommentsTable.eventId,
    userId: timelineCommentsTable.userId,
    userName: usersTable.name,
    content: timelineCommentsTable.content,
    createdAt: timelineCommentsTable.createdAt,
  })
  .from(timelineCommentsTable)
  .leftJoin(usersTable, eq(timelineCommentsTable.userId, usersTable.id))
  .where(eq(timelineCommentsTable.eventId, eventId))
  .orderBy(timelineCommentsTable.createdAt);
  
  res.json(comments);
});

router.post("/:eventId/comments", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }
  const eventId = parseInt(String(req.params.eventId));
  const userId = req.user.id;
  const { content } = req.body;

  if (!content) { res.status(400).json({ error: "Comentário vazio" }); return; }

  const [comment] = await db.insert(timelineCommentsTable).values({
    eventId, userId, content
  }).returning();

  res.json({ ok: true, comment });
});

// Deletar
router.delete("/:eventId", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }
  if (req.user.role === "tutor") { res.status(403).json({ error: "Sem permissão" }); return; }
  
  const crecheId = parseInt(String(req.params.crecheId));
  const eventId = parseInt(String(req.params.eventId));
  
  await db.delete(timelineEventsTable).where(
    and(eq(timelineEventsTable.id, eventId), eq(timelineEventsTable.crecheId, crecheId))
  );
  // Cuidado: cascade ou deletar manualmente os likes/comments/pets
  await db.delete(timelineEventPetsTable).where(eq(timelineEventPetsTable.eventId, eventId));
  await db.delete(timelineLikesTable).where(eq(timelineLikesTable.eventId, eventId));
  await db.delete(timelineViewsTable).where(eq(timelineViewsTable.eventId, eventId));
  await db.delete(timelineCommentsTable).where(eq(timelineCommentsTable.eventId, eventId));
  
  res.json({ ok: true });
});

export default router;
