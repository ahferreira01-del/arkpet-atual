import { Router } from "express";
import { db } from "@workspace/db";
import { chatMessagesTable, usersTable } from "@workspace/db/schema";
import { eq, and, ne, desc } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { sendPushToUsers } from "../lib/push.js";

const router = Router({ mergeParams: true });
router.use(authenticate);

router.get("/", async (req: AuthRequest, res) => {
  const crecheId = parseInt(req.params.crecheId);
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

router.post("/", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const crecheId = parseInt(req.params.crecheId);
  const { petId, content, mediaUrl } = req.body;
  const [msg] = await db.insert(chatMessagesTable).values({
    crecheId, petId, senderId: req.user.id, content, mediaUrl,
  }).returning();

  // Notify all other users in this creche
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
