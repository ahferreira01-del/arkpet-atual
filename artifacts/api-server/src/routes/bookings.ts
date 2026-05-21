import { Router } from "express";
import { db } from "@workspace/db";
import { bookingsTable, petsTable, usersTable, crechesTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { sendPushToUser, sendPushToRole } from "../lib/push.js";

const router = Router({ mergeParams: true });
router.use(authenticate);

async function getBookingWithNames(booking: typeof bookingsTable.$inferSelect) {
  const [pet] = await db.select({ name: petsTable.name }).from(petsTable).where(eq(petsTable.id, booking.petId)).limit(1);
  const [tutor] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, booking.tutorId)).limit(1);
  return { ...booking, petName: pet?.name ?? null, tutorName: tutor?.name ?? null };
}

router.get("/", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const { status, type } = req.query;
  let conditions: any[] = [eq(bookingsTable.crecheId, crecheId)];
  if (req.user?.role === "tutor") conditions.push(eq(bookingsTable.tutorId, req.user.id));
  if (status) conditions.push(eq(bookingsTable.status, status as any));
  if (type) conditions.push(eq(bookingsTable.type, type as any));
  const bookings = await db.select().from(bookingsTable).where(and(...conditions)).orderBy(bookingsTable.startDate);
  const enriched = await Promise.all(bookings.map(getBookingWithNames));
  res.json(enriched);
});

router.post("/", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const crecheId = parseInt(String(req.params.crecheId));
  const { petId, type, startDate, endDate, notes, isRecurring, recurringDays, price } = req.body;
  const [pet] = await db.select().from(petsTable).where(eq(petsTable.id, petId)).limit(1);
  const tutorId = req.user.role === "tutor" ? req.user.id : (pet?.tutorId ?? req.user.id);
  const [booking] = await db.insert(bookingsTable).values({
    crecheId, petId, tutorId, type, startDate, endDate, notes,
    isRecurring: isRecurring || false, recurringDays, price,
  }).returning();
  const enriched = await getBookingWithNames(booking);

  const typeLabels: Record<string, string> = {
    lodging: "Hospedagem", banho: "Banho", hospedagem_banho: "Hospedagem + Banho",
    day_use: "Day Use", visita: "Visita", pacote_4dias: "Pacote 4 Dias",
    pacote_8dias: "Pacote 8 Dias", pacote_20dias: "Pacote 20 Dias",
    visita_taxi: "Visita + Táxi", creche_taxi: "Creche + Táxi",
  };
  const typeLabel = typeLabels[type] ?? type;
  const petName = enriched.petName ?? "Pet";

  // Notify admins of the creche
  sendPushToRole(crecheId, "creche_admin", {
    title: `Nova Reserva — ${petName}`,
    body: `${typeLabel} solicitado por ${enriched.tutorName ?? "tutor"}. Verifique as reservas.`,
    tag: `booking-new-${booking.id}`,
    data: { type: "booking", bookingId: booking.id, crecheId },
  }).catch(() => {});

  // Notify tutor (if booking was created by staff/admin)
  if (req.user.role !== "tutor" && tutorId !== req.user.id) {
    sendPushToUser(tutorId, {
      title: `Reserva criada — ${petName}`,
      body: `Uma reserva de ${typeLabel} foi criada para ${petName}.`,
      tag: `booking-created-${booking.id}`,
      data: { type: "booking", bookingId: booking.id },
    }).catch(() => {});
  }

  res.status(201).json(enriched);
});

router.get("/:bookingId", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const bookingId = parseInt(String(req.params.bookingId));
  const [booking] = await db.select().from(bookingsTable)
    .where(and(eq(bookingsTable.crecheId, crecheId), eq(bookingsTable.id, bookingId))).limit(1);
  if (!booking) { res.status(404).json({ error: "Not found" }); return; }
  res.json(await getBookingWithNames(booking));
});

router.put("/:bookingId", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const crecheId = parseInt(String(req.params.crecheId));
  const bookingId = parseInt(String(req.params.bookingId));
  const { status, notes, price } = req.body;
  const updates: Record<string, unknown> = {};

  if (status !== undefined) {
    if (req.user.role === "tutor") {
      // Tutors may only request cancellation on their own pending/confirmed bookings
      if (status !== "cancel_requested") {
        res.status(403).json({ error: "Tutores só podem solicitar cancelamento de reservas." });
        return;
      }
      const [existing] = await db.select().from(bookingsTable)
        .where(and(eq(bookingsTable.id, bookingId), eq(bookingsTable.crecheId, crecheId))).limit(1);
      if (!existing || existing.tutorId !== req.user.id) {
        res.status(403).json({ error: "Reserva não encontrada." });
        return;
      }
      if (!["pending", "confirmed"].includes(existing.status)) {
        res.status(400).json({ error: "Só é possível solicitar cancelamento de reservas pendentes ou confirmadas." });
        return;
      }
    }
    updates.status = status;
  }
  if (notes !== undefined) updates.notes = notes;
  if (price !== undefined) updates.price = price;
  const [booking] = await db.update(bookingsTable).set(updates)
    .where(and(eq(bookingsTable.crecheId, crecheId), eq(bookingsTable.id, bookingId))).returning();
  const enriched = await getBookingWithNames(booking);

  // Notify of status changes
  if (status) {
    if (status === "cancel_requested" && booking.tutorId) {
      // Notify creche admins that tutor requested cancellation
      sendPushToRole(crecheId, "creche_admin", {
        title: `⚠️ Cancelamento solicitado — ${enriched.petName ?? "Pet"}`,
        body: `${enriched.tutorName ?? "Tutor"} solicitou o cancelamento da reserva de ${enriched.petName ?? "Pet"}.`,
        tag: `booking-cancel-req-${booking.id}`,
        data: { type: "booking", bookingId: booking.id, crecheId },
      }).catch(() => {});
    } else if (booking.tutorId) {
      const statusLabels: Record<string, string> = {
        confirmed: "confirmada ✅",
        cancelled: "cancelada ❌",
        pending: "pendente ⏳",
      };
      const label = statusLabels[status];
      if (label) {
        sendPushToUser(booking.tutorId, {
          title: `Reserva ${label}`,
          body: `A reserva de ${enriched.petName ?? "seu pet"} foi ${label}.`,
          tag: `booking-status-${booking.id}`,
          data: { type: "booking", bookingId: booking.id },
        }).catch(() => {});
      }
    }
  }

  res.json(enriched);
});

router.post("/:bookingId/on-the-way", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const crecheId = parseInt(String(req.params.crecheId));
  const bookingId = parseInt(String(req.params.bookingId));
  const { type, etaMinutes } = req.body;

  if (!["drop_off", "pickup"].includes(type)) {
    res.status(400).json({ error: "type deve ser 'drop_off' ou 'pickup'" });
    return;
  }

  const [booking] = await db.update(bookingsTable).set({
    onTheWayType: type,
    onTheWayEtaMinutes: etaMinutes ? parseInt(etaMinutes) : null,
    onTheWayAt: new Date(),
  }).where(and(eq(bookingsTable.crecheId, crecheId), eq(bookingsTable.id, bookingId))).returning();

  const enriched = await getBookingWithNames(booking);
  const typeLabel = type === "drop_off" ? "levar" : "buscar";
  const etaText = etaMinutes ? ` (aprox. ${etaMinutes} min)` : "";
  const petName = enriched.petName ?? "um pet";

  // Notify creche admins
  sendPushToRole(crecheId, "creche_admin", {
    title: `🚗 Tutor a caminho — ${petName}`,
    body: `${enriched.tutorName ?? "Tutor"} está vindo ${typeLabel} ${petName}${etaText}.`,
    tag: `on-the-way-${booking.id}`,
    data: { type: "booking", bookingId: booking.id, crecheId },
  }).catch(() => {});

  res.json(enriched);
});

router.post("/:bookingId/confirm-arrival", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Not authenticated" }); return; }
  const crecheId = parseInt(String(req.params.crecheId));
  const bookingId = parseInt(String(req.params.bookingId));

  const [booking] = await db.select().from(bookingsTable)
    .where(and(eq(bookingsTable.crecheId, crecheId), eq(bookingsTable.id, bookingId))).limit(1);
  if (!booking) { res.status(404).json({ error: "Reserva não encontrada" }); return; }

  // Notify tutor that creche confirmed
  if (booking.tutorId) {
    const enriched = await getBookingWithNames(booking);
    const typeLabel = booking.onTheWayType === "pickup" ? "buscar" : "trazer";
    sendPushToUser(booking.tutorId, {
      title: `✅ Creche confirma sua chegada`,
      body: `A creche está te esperando para ${typeLabel} ${enriched.petName ?? "seu pet"}.`,
      tag: `arrival-confirmed-${booking.id}`,
      data: { type: "booking", bookingId: booking.id },
    }).catch(() => {});
  }

  res.json({ message: "Confirmação enviada ao tutor" });
});

router.post("/:bookingId/personal-items", async (req: AuthRequest, res) => {
  if (!req.user) { res.status(401).json({ error: "Não autenticado" }); return; }
  const crecheId = parseInt(String(req.params.crecheId));
  const bookingId = parseInt(String(req.params.bookingId));
  const { hasItems, photoUrl } = req.body;

  if (typeof hasItems !== "boolean") {
    res.status(400).json({ error: "hasItems (boolean) é obrigatório" }); return;
  }
  if (hasItems && !photoUrl) {
    res.status(400).json({ error: "photoUrl é obrigatório quando há itens" }); return;
  }

  const [booking] = await db.update(bookingsTable)
    .set({
      hasPersonalItems: hasItems,
      personalItemsPhotoUrl: hasItems ? photoUrl : null,
    })
    .where(and(eq(bookingsTable.crecheId, crecheId), eq(bookingsTable.id, bookingId)))
    .returning();

  if (hasItems && photoUrl && booking?.petId) {
    await db.update(petsTable)
      .set({ lastCheckinPhotoUrl: photoUrl })
      .where(eq(petsTable.id, booking.petId));
  }

  res.json(await getBookingWithNames(booking));
});

router.post("/:bookingId/checkin", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const bookingId = parseInt(String(req.params.bookingId));
  const [booking] = await db.update(bookingsTable).set({
    status: "active", checkInTime: new Date(),
  }).where(and(eq(bookingsTable.crecheId, crecheId), eq(bookingsTable.id, bookingId))).returning();
  await db.update(petsTable).set({ isCheckedIn: true }).where(eq(petsTable.id, booking.petId));
  await db.update(crechesTable).set({ currentOccupancy: db.$count(petsTable, and(eq(petsTable.crecheId, crecheId), eq(petsTable.isCheckedIn, true))) as any }).where(eq(crechesTable.id, crecheId));
  const enriched = await getBookingWithNames(booking);

  // Notify tutor of check-in
  if (booking.tutorId) {
    sendPushToUser(booking.tutorId, {
      title: `🐾 ${enriched.petName ?? "Seu pet"} fez check-in!`,
      body: `${enriched.petName ?? "Seu pet"} chegou à creche com segurança.`,
      tag: `checkin-${booking.id}`,
      data: { type: "checkin", bookingId: booking.id, petId: booking.petId },
    }).catch(() => {});
  }

  res.json(enriched);
});

router.post("/:bookingId/checkout", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const bookingId = parseInt(String(req.params.bookingId));
  const [booking] = await db.update(bookingsTable).set({
    status: "completed", checkOutTime: new Date(),
  }).where(and(eq(bookingsTable.crecheId, crecheId), eq(bookingsTable.id, bookingId))).returning();
  await db.update(petsTable).set({ isCheckedIn: false }).where(eq(petsTable.id, booking.petId));
  const enriched = await getBookingWithNames(booking);

  // Notify tutor of check-out
  if (booking.tutorId) {
    sendPushToUser(booking.tutorId, {
      title: `🏠 ${enriched.petName ?? "Seu pet"} fez check-out!`,
      body: `${enriched.petName ?? "Seu pet"} está pronto para ir para casa.`,
      tag: `checkout-${booking.id}`,
      data: { type: "checkout", bookingId: booking.id, petId: booking.petId },
    }).catch(() => {});
  }

  res.json(enriched);
});

export default router;
