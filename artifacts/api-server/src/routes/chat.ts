import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { chatMessagesTable, usersTable, petsTable } from "@workspace/db/schema";
import { eq, and, ne, desc, isNull, isNotNull, inArray, lt, sql } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { requireCrecheMembership } from "../middlewares/requireCrecheMembership.js";
import { sendPushToUsers } from "../lib/push.js";
import { acquireTenantOperationalLock, TenantArchivedError } from "../services/tenantLifecycleLock.js";
import { parseCanonicalPrivateObjectPath } from "../lib/objectAuthorization.js";

const sendMessageSchema = z.object({
  tutorId: z.number({ required_error: "tutorId é obrigatório" }).int().positive("tutorId inválido"),
  content: z.string().optional().nullable(),
  petId: z.number().int().positive("petId inválido").optional().nullable(),
  mediaUrl: z.string().refine(
    (v) => {
      const parsed = parseCanonicalPrivateObjectPath(v);
      return parsed.ok;
    },
    { message: "mediaUrl deve ser um caminho de armazenamento canônico (/objects/uploads/c<crecheId>/<uuid>.<ext>)" }
  ).optional().nullable(),
}).refine(
  (d) => (d.content && d.content.trim().length > 0) || d.mediaUrl,
  { message: "content ou mediaUrl é obrigatório" }
);

const markReadSchema = z.object({
  tutorId: z.number({ required_error: "tutorId é obrigatório" }).int().positive("tutorId inválido"),
});

/**
 * Validates target tutor for a given creche and user role.
 * - For tutors: only their own user.id is allowed (foreign tutorId -> 403 Forbidden).
 * - For staff / creche_admin / master_admin: target tutor must exist in usersTable with role='tutor' and crecheId=crecheId (-> 404 Not Found if not).
 */
async function validateTargetTutor(
  crecheId: number,
  targetTutorId: number,
  user: { id: number; role: string }
): Promise<{ ok: true; tutorId: number } | { ok: false; status: 400 | 403 | 404; error: string }> {
  if (isNaN(targetTutorId) || targetTutorId <= 0) {
    return { ok: false, status: 400, error: "ID de tutor inválido" };
  }

  if (user.role === "tutor") {
    if (targetTutorId !== user.id) {
      return { ok: false, status: 403, error: "Acesso não autorizado à conversa de outro tutor" };
    }
    return { ok: true, tutorId: user.id };
  }

  // staff / creche_admin / master_admin
  const [tutor] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.id, targetTutorId),
        eq(usersTable.role, "tutor"),
        eq(usersTable.crecheId, crecheId)
      )
    )
    .limit(1);

  if (!tutor) {
    return { ok: false, status: 404, error: "Tutor não encontrado nesta creche" };
  }

  return { ok: true, tutorId: tutor.id };
}

/**
 * Validates chat media canonical path format and tenant ownership.
 * Fails closed if mediaUrl is not canonical or does not belong to the conversation creche.
 */
async function validateChatMedia(
  crecheId: number,
  mediaUrl?: string | null
): Promise<{ ok: true } | { ok: false; status: 400; error: string; code: string }> {
  if (!mediaUrl) return { ok: true };
  const parsed = parseCanonicalPrivateObjectPath(mediaUrl);
  if (!parsed.ok || parsed.pathCrecheId !== crecheId) {
    return {
      ok: false,
      status: 400,
      error: "mediaUrl inválido ou não pertence a esta creche",
      code: "CROSS_TENANT_MEDIA_FORBIDDEN",
    };
  }
  return { ok: true };
}

/**
 * Validates petId ownership and creche tenant boundaries.
 */
async function validateChatPet(
  crecheId: number,
  targetTutorId: number,
  petId: number,
  executor: any = db
): Promise<{ ok: true; petName: string } | { ok: false; status: 400; error: string }> {
  const [pet] = await executor
    .select({ id: petsTable.id, name: petsTable.name })
    .from(petsTable)
    .where(
      and(
        eq(petsTable.id, petId),
        eq(petsTable.crecheId, crecheId),
        eq(petsTable.tutorId, targetTutorId)
      )
    )
    .limit(1);

  if (!pet) {
    return { ok: false, status: 400, error: "Pet inválido ou não pertence a este tutor nesta creche" };
  }
  return { ok: true, petName: pet.name };
}

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

  // Directional unread query for conversation list:
  // - Tutor: counts Team -> Tutor messages (senderId != tutorId)
  // - Team (Staff/Admin/Master): counts Tutor -> Team messages (senderId == tutorId)
  let unreadRows: { tutorId: number | null }[];
  if (req.user.role === "tutor") {
    unreadRows = await db
      .select({ tutorId: chatMessagesTable.tutorId })
      .from(chatMessagesTable)
      .where(and(
        eq(chatMessagesTable.crecheId, crecheId),
        eq(chatMessagesTable.tutorId, req.user.id),
        ne(chatMessagesTable.senderId, req.user.id),
        isNull(chatMessagesTable.readAt),
      ));
  } else {
    unreadRows = await db
      .select({ tutorId: chatMessagesTable.tutorId })
      .from(chatMessagesTable)
      .where(and(
        eq(chatMessagesTable.crecheId, crecheId),
        isNotNull(chatMessagesTable.tutorId),
        inArray(chatMessagesTable.tutorId, tutorIds),
        eq(chatMessagesTable.senderId, chatMessagesTable.tutorId),
        isNull(chatMessagesTable.readAt),
      ));
  }

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
// Directional unread logic:
// - Tutor: counts messages sent BY STAFF to this tutor (senderId != tutorId)
// - Team: counts messages sent BY TUTORS to the creche team (senderId == tutorId)
// ─────────────────────────────────────────────────────────────
router.get("/unread", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const crecheId = parseInt(String(req.params.crecheId));

  let rows: { tutorId: number | null }[];
  if (req.user.role === "tutor") {
    rows = await db
      .select({ tutorId: chatMessagesTable.tutorId })
      .from(chatMessagesTable)
      .where(and(
        eq(chatMessagesTable.crecheId, crecheId),
        eq(chatMessagesTable.tutorId, req.user.id),
        ne(chatMessagesTable.senderId, req.user.id),
        isNull(chatMessagesTable.readAt),
      ));
  } else {
    rows = await db
      .select({ tutorId: chatMessagesTable.tutorId })
      .from(chatMessagesTable)
      .where(and(
        eq(chatMessagesTable.crecheId, crecheId),
        isNotNull(chatMessagesTable.tutorId),
        eq(chatMessagesTable.senderId, chatMessagesTable.tutorId),
        isNull(chatMessagesTable.readAt),
      ));
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
// Directional read logic:
// - Tutor: marks only messages sent BY TEAM to the tutor (senderId != tutorId)
// - Team: marks only messages sent BY THE TUTOR to the team (senderId == tutorId)
// ─────────────────────────────────────────────────────────────
router.post("/mark-read", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const crecheId = parseInt(String(req.params.crecheId));

  const parsed = markReadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten().fieldErrors });
    return;
  }

  const validated = await validateTargetTutor(crecheId, parsed.data.tutorId, req.user);
  if (!validated.ok) {
    res.status(validated.status).json({ error: validated.error });
    return;
  }

  if (req.user.role === "tutor") {
    await db.update(chatMessagesTable)
      .set({ readAt: new Date() })
      .where(and(
        eq(chatMessagesTable.crecheId, crecheId),
        eq(chatMessagesTable.tutorId, req.user.id),
        ne(chatMessagesTable.senderId, req.user.id),
        isNull(chatMessagesTable.readAt),
      ));
  } else {
    await db.update(chatMessagesTable)
      .set({ readAt: new Date() })
      .where(and(
        eq(chatMessagesTable.crecheId, crecheId),
        eq(chatMessagesTable.tutorId, validated.tutorId),
        eq(chatMessagesTable.senderId, validated.tutorId),
        isNull(chatMessagesTable.readAt),
      ));
  }

  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────
// GET / — list messages by tutorId with cursor-based pagination
// ?tutorId=X&cursor=<lastId>&limit=50
// Returns messages in ascending order (oldest first)
// ─────────────────────────────────────────────────────────────
router.get("/", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const crecheId = parseInt(String(req.params.crecheId));
  const { tutorId, cursor, limit } = req.query;

  let targetTutorId: number;
  if (req.user.role === "tutor") {
    if (tutorId != null && String(tutorId).trim() !== "") {
      const parsedQueryTutor = parseInt(tutorId as string, 10);
      if (isNaN(parsedQueryTutor) || parsedQueryTutor !== req.user.id) {
        res.status(403).json({ error: "Acesso não autorizado à conversa de outro tutor" });
        return;
      }
    }
    targetTutorId = req.user.id;
  } else {
    // Operational roles (staff / admin / master) MUST provide tutorId
    if (!tutorId || isNaN(parseInt(tutorId as string, 10))) {
      res.status(400).json({ error: "tutorId é obrigatório" });
      return;
    }
    const validated = await validateTargetTutor(crecheId, parseInt(tutorId as string, 10), req.user);
    if (!validated.ok) {
      res.status(validated.status).json({ error: validated.error });
      return;
    }
    targetTutorId = validated.tutorId;
  }

  const conditions: any[] = [
    eq(chatMessagesTable.crecheId, crecheId),
    eq(chatMessagesTable.tutorId, targetTutorId),
  ];

  if (cursor) {
    const parsedCursor = parseInt(cursor as string, 10);
    if (!isNaN(parsedCursor) && parsedCursor > 0) {
      conditions.push(lt(chatMessagesTable.id, parsedCursor));
    }
  }

  const pageSize = Math.min(Math.max(parseInt(limit as string, 10) || 50, 1), 100);

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
  try {
    if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
    const crecheId = parseInt(String(req.params.crecheId));

    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Dados inválidos", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const { tutorId, petId, content, mediaUrl } = parsed.data;

    // Validate target tutor authorization
    const validated = await validateTargetTutor(crecheId, tutorId, req.user);
    if (!validated.ok) {
      res.status(validated.status).json({ error: validated.error });
      return;
    }
    const targetTutorId = validated.tutorId;

    // Validate media tenant match BEFORE transaction / insert (FOREIGN_TENANT_MEDIA_INSERT = 0)
    const mediaCheck = await validateChatMedia(crecheId, mediaUrl);
    if (!mediaCheck.ok) {
      res.status(mediaCheck.status).json({ error: mediaCheck.error, code: mediaCheck.code });
      return;
    }

    const result = await db.transaction(async (tx) => {
      await acquireTenantOperationalLock(crecheId, tx);

      // Validate petId if supplied: must belong to targetTutorId and crecheId
      let petName: string | null = null;
      const parsedPetId = petId ?? null;
      if (parsedPetId) {
        const petCheck = await validateChatPet(crecheId, targetTutorId, parsedPetId, tx);
        if (!petCheck.ok) {
          return { status: petCheck.status, error: petCheck.error };
        }
        petName = petCheck.petName;
      }

      // Insert message with authenticated user as senderId
      const [msg] = await tx.insert(chatMessagesTable).values({
        crecheId,
        tutorId: targetTutorId,
        petId: parsedPetId,
        senderId: req.user!.id,
        content: content ? content.trim() : "",
        mediaUrl: mediaUrl ?? null,
      }).returning();

      return { status: 201, msg, petName, targetTutorId, parsedPetId };
    });

    if (result.status !== 201) {
      res.status(result.status!).json({ error: result.error });
      return;
    }

    const { msg, petName, parsedPetId } = result;
    const safeContent = content ? content.trim() : null;
    const preview = safeContent && safeContent.length > 60 ? safeContent.slice(0, 57) + "..." : safeContent;
    const pushTitle = petName
      ? `💬 ${req.user.name} → ${petName}`
      : `💬 ${req.user.name}`;

    const pushPayload = {
      title: pushTitle,
      body: preview || "Enviou uma mídia.",
      tag: `chat-${crecheId}-tutor-${targetTutorId}`,
      data: { type: "chat", crecheId, tutorId: targetTutorId, petId: parsedPetId ?? null },
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
      if (targetTutorId !== req.user.id) {
        sendPushToUsers([targetTutorId], pushPayload).catch(() => {});
      }
    }

    res.status(201).json({
      ...msg,
      senderName: req.user.name,
      senderRole: req.user.role,
      petName,
    });
  } catch (err: any) {
    if (err instanceof TenantArchivedError || err?.code === "tenant_archived" || err?.message === "tenant_archived") {
      res.status(403).json({ error: "tenant_archived", code: "tenant_archived", message: "Esta creche foi arquivada. Operações desabilitadas." });
      return;
    }
    res.status(500).json({ error: err.message || "Erro ao enviar mensagem" });
  }
});

export {
  validateTargetTutor,
  validateChatPet,
  validateChatMedia,
  sendMessageSchema,
  markReadSchema,
};
export default router;
