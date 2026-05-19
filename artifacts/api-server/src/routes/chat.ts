import { Router } from "express";
import { db } from "@workspace/db";
import { chatMessagesTable, usersTable, petsTable } from "@workspace/db/schema";
import { eq, and, ne, desc, isNull, inArray } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { sendPushToUsers } from "../lib/push.js";

const router = Router({ mergeParams: true });
router.use(authenticate);

// GET /unread — total unread count for current user
router.get("/unread", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const crecheId = parseInt(String(req.params.crecheId));

  const rows = await db.select({ id: chatMessagesTable.id, petId: chatMessagesTable.petId })
    .from(chatMessagesTable)
    .where(and(
      eq(chatMessagesTable.crecheId, crecheId),
      ne(chatMessagesTable.senderId, req.user.id),
      isNull(chatMessagesTable.readAt),
    ));

  // For tutors: only count messages for their own pets
  let unreadRows = rows;
  if (req.user.role === "tutor") {
    const tutorPets = await db.select({ id: petsTable.id })
      .from(petsTable)
      .where(and(eq(petsTable.crecheId, crecheId), eq(petsTable.tutorId, req.user.id)));
    const petIds = new Set(tutorPets.map((p) => p.id));
    unreadRows = rows.filter((r) => r.petId != null && petIds.has(r.petId));
  }

  // Group unread by petId
  const byPet: Record<number, number> = {};
  for (const r of unreadRows) {
    const key = r.petId ?? 0;
    byPet[key] = (byPet[key] || 0) + 1;
  }

  res.json({ total: unreadRows.length, byPet });
});

// POST /mark-read — mark all messages in a pet conversation as read
router.post("/mark-read", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const crecheId = parseInt(String(req.params.crecheId));
  const { petId } = req.body;

  const conditions: any[] = [
    eq(chatMessagesTable.crecheId, crecheId),
    ne(chatMessagesTable.senderId, req.user.id),
    isNull(chatMessagesTable.readAt),
  ];
  if (petId) conditions.push(eq(chatMessagesTable.petId, parseInt(petId)));

  await db.update(chatMessagesTable)
    .set({ readAt: new Date() })
    .where(and(...conditions));

  res.json({ ok: true });
});

// GET / — list messages
router.get("/", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const { petId, limit } = req.query;
  let conditions: any[] = [eq(chatMessagesTable.crecheId, crecheId)];
  if (petId) conditions.push(eq(chatMessagesTable.petId, parseInt(petId as string)));

  const messages = await db.select({
    id: chatMessagesTable.id,
    crecheId: chatMessagesTable.crecheId,
    petId: chatMessagesTable.petId,
    senderId: chatMessagesTable.senderId,
    senderName: usersTable.name,
    senderRole: usersTable.role,
    content: chatMessagesTable.content,
    mediaUrl: chatMessagesTable.mediaUrl,
    readAt: chatMessagesTable.readAt,
    createdAt: chatMessagesTable.createdAt,
  })
    .from(chatMessagesTable)
    .leftJoin(usersTable, eq(chatMessagesTable.senderId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(parseInt(limit as string) || 50);
  res.json(messages.reverse());
});

// POST / — send message
router.post("/", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const crecheId = parseInt(String(req.params.crecheId));
  const { petId, content, mediaUrl } = req.body;
  const [msg] = await db.insert(chatMessagesTable).values({
    crecheId, petId, senderId: req.user.id, content, mediaUrl,
  }).returning();

  const otherUsers = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(and(
      eq(usersTable.crecheId, crecheId),
      ne(usersTable.id, req.user.id),
    ));

  if (otherUsers.length) {
    const preview = content?.length > 60 ? content.slice(0, 57) + "..." : content;
    sendPushToUsers(
      otherUsers.map((u) => u.id),
      {
        title: `💬 ${req.user.name}`,
        body: preview || "Enviou uma mídia.",
        tag: `chat-${crecheId}-${petId ?? "geral"}`,
        data: { type: "chat", crecheId, petId: petId ?? null },
      }
    ).catch(() => {});
  }

  res.status(201).json({ ...msg, senderName: req.user.name, senderRole: req.user.role });
});

export default router;
