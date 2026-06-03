import { Router } from "express";
import { db } from "@workspace/db";
import { chatMessagesTable, usersTable, petsTable } from "@workspace/db/schema";
import { eq, and, ne, desc, isNull, isNotNull, inArray, lt, sql } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { requireCrecheMembership } from "../middlewares/requireCrecheMembership.js";
import { sendPushToUsers } from "../lib/push.js";

const router = Router({ mergeParams: true });
router.use(authenticate);
router.use(requireCrecheMembership);

// ─────────────────────────────────────────────────────────────
// GET /conversations — list of tutor conversations
// Staff/admin: all tutors of the creche, sorted by lastAt DESC
// Tutor: only their own conversation
// ─────────────────────────────────────────────────────────────
router.get("/conversations", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const crecheId = parseInt(String(req.params.crecheId));

  let tutors: { id: number; name: string }[];
  if (req.user.role === "tutor") {
    tutors = [{ id: req.user.id, name: req.user.name }];
  } else {
    tutors = await db
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(and(
        eq(usersTable.crecheId, crecheId),
        eq(usersTable.role, "tutor"),
      ));
  }

  if (!tutors.length) { res.json([]); return; }

  const tutorIds = tutors.map((t) => t.id);

  const allPets = await db
    .select({ id: petsTable.id, name: petsTable.name, tutorId: petsTable.tutorId })
    .from(petsTable)
    .where(and(
      eq(petsTable.crecheId, crecheId),
      isNotNull(petsTable.tutorId),
    ));

  const lastMsgRows = await db.execute(sql`
    SELECT DISTINCT ON (tutor_id)
      tutor_id,
      content,
      created_at AS last_at
    FROM chat_messages
    WHERE creche_id = ${crecheId}
      AND tutor_id IS NOT NULL
    ORDER BY tutor_id, created_at DESC
  `);
  const lastMsgMap = new Map<number, { content: string; lastAt: Date }>();
  for (const r of lastMsgRows.rows as any[]) {
    lastMsgMap.set(Number(r.tutor_id), { content: r.content, lastAt: r.last_at });
  }

  const unreadConditions: any[] = [
    eq(chatMessagesTable.crecheId, crecheId),
    ne(chatMessagesTable.senderId, req.user.id),
    isNull(chatMessagesTable.readAt),
    isNotNull(chatMessagesTable.tutorId),
    inArray(chatMessagesTable.tutorId, tutorIds),
  ];
  const unreadRows = await db
    .select({ tutorId: chatMessagesTable.tutorId })
    .from(chatMessagesTable)
    .where(and(...unreadConditions));
  const unreadMap = new Map<number, number>();
  for (const r of unreadRows) {
    if (r.tutorId != null) {
      unreadMap.set(r.tutorId, (unreadMap.get(r.tutorId) ?? 0) + 1);
    }
  }

  const conversations = tutors.map((tutor) => {
    const pets = allPets
      .filter((p) => p.tutorId === tutor.id)
      .map((p) => ({ id: p.id, name: p.name }));
    const last = lastMsgMap.get(tutor.id);
    return {
      tutorId: tutor.id,
      tutorName: tutor.name,
      pets,
      lastMessage: last?.content ?? null,
      lastAt: last?.lastAt ?? null,
      unread: unreadMap.get(tutor.id) ?? 0,
    };
  });

  conversations.sort((a, b) => {
    if (!a.lastAt && !b.lastAt) return 0;
    if (!a.lastAt) return 1;
    if (!b.lastAt) return -1;
    return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
  });

  res.json(conversations);
});

// ─────────────────────────────────────────────────────────────
// GET /unread — unread count grouped by tutorId
// ─────────────────────────────────────────────────────────────
router.get("/unread", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const crecheId = parseInt(String(req.params.crecheId));

  const baseConditions: any[] = [
    eq(chatMessagesTable.crecheId, crecheId),
    ne(chatMessagesTable.senderId, req.user.id),
    isNull(chatMessagesTable.readAt),
    isNotNull(chatMessagesTable.tutorId),
  ];

  let rows: { tutorId: number | null }[];
  if (req.user.role === "tutor") {
    rows = await db
      .select({ tutorId: chatMessagesTable.tutorId })
      .from(chatMessagesTable)
      .where(and(...baseConditions, eq(chatMessagesTable.tutorId, req.user.id)));
  } else {
    rows = await db
      .select({ tutorId: chatMessagesTable.tutorId })
      .from(chatMessagesTable)
      .where(and(...baseConditions));
  }

  const byTutor: Record<number, number> = {};
  for (const r of rows) {
    if (r.tutorId != null) {
      byTutor[r.tutorId] = (byTutor[r.tutorId] || 0) + 1;
    }
  }

  res.json({ total: rows.length, byTutor });
});

// ─────────────────────────────────────────────────────────────
// POST /mark-read — mark conversation as read by tutorId
// ─────────────────────────────────────────────────────────────
router.post("/mark-read", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const crecheId = parseInt(String(req.params.crecheId));
  const { tutorId } = req.body;

  if (!tutorId) { res.status(400).json({ error: "tutorId required" }); return; }

  await db.update(chatMessagesTable)
    .set({ readAt: new Date() })
    .where(and(
      eq(chatMessagesTable.crecheId, crecheId),
      eq(chatMessagesTable.tutorId, parseInt(String(tutorId))),
      ne(chatMessagesTable.senderId, req.user.id),
      isNull(chatMessagesTable.readAt),
    ));

  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────
// GET / — list messages by tutorId with cursor-based pagination
// ?tutorId=X&cursor=<lastId>&limit=50
// Returns messages in ascending order (oldest first)
// cursor = lowest id seen → load older messages above
// ─────────────────────────────────────────────────────────────
router.get("/", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const crecheId = parseInt(String(req.params.crecheId));
  const { tutorId, cursor, limit } = req.query;

  const conditions: any[] = [
    eq(chatMessagesTable.crecheId, crecheId),
    isNotNull(chatMessagesTable.tutorId),
  ];
  if (tutorId) conditions.push(eq(chatMessagesTable.tutorId, parseInt(tutorId as string)));
  // Tutor: only own conversation
  if (req.user.role === "tutor") conditions.push(eq(chatMessagesTable.tutorId, req.user.id));
  // cursor: load older messages (id < cursor)
  if (cursor) conditions.push(lt(chatMessagesTable.id, parseInt(cursor as string)));

  const pageSize = parseInt(limit as string) || 50;

  const messages = await db.select({
    id: chatMessagesTable.id,
    crecheId: chatMessagesTable.crecheId,
    tutorId: chatMessagesTable.tutorId,
    petId: chatMessagesTable.petId,
    senderId: chatMessagesTable.senderId,
    senderName: usersTable.name,
    senderRole: usersTable.role,
    petName: petsTable.name,
    content: chatMessagesTable.content,
    mediaUrl: chatMessagesTable.mediaUrl,
    readAt: chatMessagesTable.readAt,
    createdAt: chatMessagesTable.createdAt,
  })
    .from(chatMessagesTable)
    .leftJoin(usersTable, eq(chatMessagesTable.senderId, usersTable.id))
    .leftJoin(petsTable, eq(chatMessagesTable.petId, petsTable.id))
    .where(and(...conditions))
    .orderBy(desc(chatMessagesTable.id))
    .limit(pageSize);

  res.json(messages.reverse());
});

// ─────────────────────────────────────────────────────────────
// POST / — send a message
// Body: { tutorId, petId?, content, mediaUrl? }
// ─────────────────────────────────────────────────────────────
router.post("/", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const crecheId = parseInt(String(req.params.crecheId));
  const { tutorId, petId, content, mediaUrl } = req.body;

  if (!tutorId) { res.status(400).json({ error: "tutorId required" }); return; }

  const parsedTutorId = parseInt(String(tutorId));
  const parsedPetId = petId ? parseInt(String(petId)) : null;

  let petName: string | null = null;
  if (parsedPetId) {
    const [pet] = await db
      .select({ name: petsTable.name })
      .from(petsTable)
      .where(eq(petsTable.id, parsedPetId))
      .limit(1);
    petName = pet?.name ?? null;
  }

  const [msg] = await db.insert(chatMessagesTable).values({
    crecheId,
    tutorId: parsedTutorId,
    petId: parsedPetId,
    senderId: req.user.id,
    content,
    mediaUrl: mediaUrl ?? null,
  }).returning();

  const preview = content?.length > 60 ? content.slice(0, 57) + "..." : content;
  const pushTitle = petName
    ? `💬 ${req.user.name} → ${petName}`
    : `💬 ${req.user.name}`;

  const pushPayload = {
    title: pushTitle,
    body: preview || "Enviou uma mídia.",
    tag: `chat-${crecheId}-tutor-${parsedTutorId}`,
    data: { type: "chat", crecheId, tutorId: parsedTutorId, petId: parsedPetId ?? null },
  };

  if (req.user.role === "tutor") {
    // Tutor sends → notify all staff + admin in the creche
    const staffAndAdmin = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(
        eq(usersTable.crecheId, crecheId),
        ne(usersTable.id, req.user.id),
        ne(usersTable.role, "tutor"),
      ));
    if (staffAndAdmin.length) {
      sendPushToUsers(staffAndAdmin.map((u) => u.id), pushPayload).catch(() => {});
    }
  } else {
    // Staff/admin sends → notify the tutor only
    if (parsedTutorId !== req.user.id) {
      sendPushToUsers([parsedTutorId], pushPayload).catch(() => {});
    }
  }

  res.status(201).json({
    ...msg,
    senderName: req.user.name,
    senderRole: req.user.role,
    petName,
  });
});

export default router;
