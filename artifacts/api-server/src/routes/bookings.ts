import { SQLWrapper } from "drizzle-orm";
import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { db } from "@workspace/db";
import {
  bookingsTable,
  petsTable,
  usersTable,
  crechesTable,
  bookingConsumablesTable,
  catalogueItemsTable,
  invoicesTable,
  invoiceItemsTable,
  bookingCreditsTable,
  financialAuditLogsTable,
  tutorServiceCreditsTable,
} from "@workspace/db/schema";
import { eq, and, desc, gte, gt, sql, or, isNull, asc } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { normalizeServiceType } from "../utils/service-name.js";
import { requireActiveSubscription } from "../middlewares/requireActiveSubscription.js";
import { requireCrecheMembership } from "../middlewares/requireCrecheMembership.js";
import { logFinancialAudit } from "../services/audit.js";
import { hasOverdueInvoices, BillingService } from "../services/billing.js";
import { sendPushToUser, sendPushToRole } from "../lib/push.js";
// Fase 7: API interna do CreditService — Booking não conhece mais as tabelas financeiras
import {
  consumePackageCredits,
  consumeServiceCreditsForBooking,
  restoreBookingPackageCredits,
  restoreBookingServiceCredits,
} from "../services/credits.js";

const router = Router({ mergeParams: true });
router.use(authenticate);
router.use(requireCrecheMembership);

async function getBookingWithNames(booking: typeof bookingsTable.$inferSelect) {
  const [pet] = await db
    .select({ name: petsTable.name })
    .from(petsTable)
    .where(eq(petsTable.id, booking.petId))
    .limit(1);
  const [tutor] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, booking.tutorId))
    .limit(1);
  return {
    ...booking,
    petName: pet?.name ?? null,
    tutorName: tutor?.name ?? null,
  };
}

// Pagination Helper
function getPaginationParams(query: Record<string, any>) {
  const page = Math.max(1, parseInt((query.page as string) || "1"));
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt((query.pageSize as string) || "20")),
  );
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const crecheId = parseInt(String(req.params.crecheId));
    const { status, type, date, page: qPage, pageSize: qPageSize, petId, tutorId } = req.query;
    let conditions: SQLWrapper[] = [eq(bookingsTable.crecheId, crecheId)];
    if (date) {
      // Filtrar apenas o startDate
      conditions.push(eq(bookingsTable.startDate, date as string));
    }
    if (req.user?.role === "tutor") {
      conditions.push(eq(bookingsTable.tutorId, req.user.id));
    } else if (tutorId && tutorId !== "null" && tutorId !== "undefined") {
      conditions.push(eq(bookingsTable.tutorId, parseInt(tutorId as string)));
    }
    
    if (petId && petId !== "null" && petId !== "undefined") {
      conditions.push(eq(bookingsTable.petId, parseInt(petId as string)));
    }

    if (status && status !== "all") {
      if (status === "active_pending") {
        conditions.push(
          or(
            eq(bookingsTable.status, "active"),
            eq(bookingsTable.status, "pending"),
          )!,
        );
      } else {
        conditions.push(eq(bookingsTable.status, status as any));
      }
    }
    if (type)
      conditions.push(
        eq(
          bookingsTable.type,
          type as
            | "day_use"
            | "lodging"
            | "banho"
            | "hospedagem_banho"
            | "visita"
            | "pacote_4dias"
            | "pacote_8dias"
            | "pacote_20dias"
            | "visita_taxi"
            | "creche_taxi",
        ),
      );

    const { page, pageSize, offset } = getPaginationParams(req.query);

    const [data, [{ total }]] = await Promise.all([
      db
        .select({
          id: bookingsTable.id,
          crecheId: bookingsTable.crecheId,
          petId: bookingsTable.petId,
          petName: petsTable.name,
          tutorId: bookingsTable.tutorId,
          tutorName: usersTable.name,
          type: bookingsTable.type,
          status: bookingsTable.status,
          startDate: bookingsTable.startDate,
          endDate: bookingsTable.endDate,
          checkInTime: bookingsTable.checkInTime,
          checkOutTime: bookingsTable.checkOutTime,
          notes: bookingsTable.notes,
          isRecurring: bookingsTable.isRecurring,
          recurringDays: bookingsTable.recurringDays,
          price: bookingsTable.price,
          onTheWayType: bookingsTable.onTheWayType,
          onTheWayEtaMinutes: bookingsTable.onTheWayEtaMinutes,
          onTheWayAt: bookingsTable.onTheWayAt,
          hasPersonalItems: bookingsTable.hasPersonalItems,
          personalItemsPhotoUrl: bookingsTable.personalItemsPhotoUrl,
          createdAt: bookingsTable.createdAt,
        })
        .from(bookingsTable)
        .leftJoin(petsTable, eq(bookingsTable.petId, petsTable.id))
        .leftJoin(usersTable, eq(bookingsTable.tutorId, usersTable.id))
        .where(and(...conditions))
        .orderBy(
          // Pending first, then confirmed, then cancel_requested, then active, then the rest
          sql`CASE ${bookingsTable.status}
            WHEN 'pending'          THEN 0
            WHEN 'confirmed'        THEN 1
            WHEN 'cancel_requested' THEN 2
            WHEN 'active'           THEN 3
            WHEN 'completed'        THEN 4
            WHEN 'cancelled'        THEN 5
            ELSE 6 END`,
          desc(bookingsTable.startDate),
        )
        .limit(pageSize)
        .offset(offset),

      db
        .select({ total: sql<number>`count(*)` })
        .from(bookingsTable)
        .where(and(...conditions)),
    ]);

    res.json({
      data,               // chave canônica (nova)
      items: data,        // alias de compatibilidade retroativa
      total: Number(total),
      page,
      pageSize,
      totalPages: Math.ceil(Number(total) / pageSize),
    });
  } catch (err: any) {
    console.error("DEBUG ERROR GET /bookings:", err);
    next(err);
  }
});

router.post("/", requireActiveSubscription, async (req: AuthRequest, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const crecheId = parseInt(String(req.params.crecheId));
  const {
    petId,
    type,
    startDate,
    endDate,
    notes,
    isRecurring,
    recurringDays,
    packageMaxPets,
  } = req.body;

  try {
    const enriched = await db.transaction(async (tx) => {
      const [pet] = await tx
        .select()
        .from(petsTable)
        .where(eq(petsTable.id, petId))
        .limit(1);

      if (!pet) throw new Error("Pet não encontrado");

      const tutorId = req.user!.role === "tutor" ? req.user!.id : (pet.tutorId ?? req.user!.id);

      if (await hasOverdueInvoices(tutorId)) {
        throw new Error("Este tutor possui faturas em atraso. Regularize a situação para realizar novos agendamentos.");
      }

      // Calcula duração (noites). Se endDate não for passado ou for igual, é 1 dia.
      // Não somar +1: today→tomorrow = 1 noite.
      const start = new Date(startDate);
      const end = endDate ? new Date(endDate) : new Date(startDate);
      const durationDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 3600 * 24)));

      // 1. Criar o Booking com preço zero provisoriamente
      const [booking] = await tx
        .insert(bookingsTable)
        .values({
          crecheId,
          petId,
          tutorId,
          type,
          startDate,
          endDate,
          notes,
          isRecurring: isRecurring || false,
          recurringDays,
          packageMaxPets,
          price: 0,
        })
        .returning();

      // Lógica de consumo de créditos movida para a rota PUT (status = confirmed)

      // Prepara objeto enriquecido para retornar
      const [tutorRec] = await tx.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, tutorId)).limit(1);
      return {
        ...booking,
        petName: pet.name,
        tutorName: tutorRec?.name ?? null,
      };
    });

    const typeLabels: Record<string, string> = {
      lodging: "Hospedagem",
      banho: "Banho",
      hospedagem_banho: "Hospedagem + Banho",
      day_use: "Day Use",
      visita: "Visita",
      pacote_4dias: "Pacote 4 Dias",
      pacote_8dias: "Pacote 8 Dias",
      pacote_20dias: "Pacote 20 Dias",
      visita_taxi: "Visita + Táxi",
      creche_taxi: "Creche + Táxi",
    };
    const typeLabel = typeLabels[type] ?? type;
    const petName = enriched.petName ?? "Pet";

    sendPushToRole(crecheId, "creche_admin", {
      title: `Nova Reserva — ${petName}`,
      body: `${typeLabel} solicitado por ${enriched.tutorName ?? "tutor"}. Verifique as reservas.`,
      tag: `booking-new-${enriched.id}`,
      data: {
        type: "booking",
        bookingId: enriched.id,
        petId: enriched.petId,
        crecheId,
      },
    }).catch(() => {});

    if (req.user.role !== "tutor" && enriched.tutorId !== req.user.id) {
      sendPushToUser(enriched.tutorId, {
        title: `Reserva criada — ${petName}`,
        body: `Uma reserva de ${typeLabel} foi criada para ${petName}.`,
        tag: `booking-created-${enriched.id}`,
        data: { type: "booking", bookingId: enriched.id, petId: enriched.petId },
      }).catch(() => {});
    }

    res.status(201).json(enriched);
  } catch (err: any) {
    if (err.message) {
      res.status(400).json({ error: err.message });
    } else {
      next(err);
    }
  }
});

router.get("/:bookingId", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const bookingId = parseInt(String(req.params.bookingId));
  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(
      and(
        eq(bookingsTable.crecheId, crecheId),
        eq(bookingsTable.id, bookingId),
      ),
    )
    .limit(1);
  if (!booking) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(await getBookingWithNames(booking));
});

router.put("/:bookingId", async (req: AuthRequest, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const crecheId = parseInt(String(req.params.crecheId));
  const bookingId = parseInt(String(req.params.bookingId));
  const { status, notes, price } = req.body;
  const updates: Record<string, unknown> = {};

  try {
    const enriched = await db.transaction(async (tx) => {
      // Fetch existing booking upfront
      const [existing] = await tx
        .select()
        .from(bookingsTable)
        .where(
          and(
            eq(bookingsTable.id, bookingId),
            eq(bookingsTable.crecheId, crecheId),
          ),
        )
        .limit(1)
        .for("update");

      if (!existing) {
        throw new Error("Reserva não encontrada.");
      }

      if (status !== undefined) {
        if (req.user!.role === "tutor") {
          if (status !== "cancel_requested") {
            throw new Error("Tutores só podem solicitar cancelamento de reservas.");
          }
          if (existing.tutorId !== req.user!.id) {
            throw new Error("Reserva não encontrada.");
          }
          if (!["pending", "confirmed"].includes(existing.status)) {
            throw new Error("Só é possível solicitar cancelamento de reservas pendentes ou confirmadas.");
          }
        }
        updates.status = status;
      }
      if (notes !== undefined) updates.notes = notes;
      if (price !== undefined) updates.price = price;

      // Handle acceptance logic (Deduction of credits)
      if (status === "confirmed" && existing.status === "pending") {
        const start = new Date(existing.startDate);
        const end = existing.endDate ? new Date(existing.endDate) : new Date(existing.startDate);
        
        let totalPiggybacked = 0;
        let totalConsumedNormal = 0;
        let daysToBill = 0;

        // Fase 7: CreditService.consumePackageCredits — Booking não conhece mais tabelas de créditos
        if (existing.packageMaxPets != null) {
          const result = await consumePackageCredits(
            bookingId,
            existing.tutorId!,
            crecheId,
            start,
            end,
            existing.packageMaxPets!,
            tx
          );
          totalPiggybacked = result.totalPiggybacked;
          totalConsumedNormal = result.totalConsumedNormal;
          daysToBill = result.daysToBill;
        } else {
          // Avulso/lodging: todos os dias são faturados
          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            daysToBill++;
          }
        }

        if (daysToBill > 0) {
          // Search both services AND packages so items like "Day use" (package)
          // are found. Also filter is_active to exclude deactivated items.
          const allItems = await tx
            .select()
            .from(catalogueItemsTable)
            .where(and(
              eq(catalogueItemsTable.crecheId, crecheId),
              eq(catalogueItemsTable.isActive, true),
            ));

          // 1. Exact name match: "Day use" → "day_use" === existing.type
          let catalogueItem = allItems.find(
            i => i.name.toLowerCase().replace(/\s+/g, "_") === existing.type,
          );

          // 2. Keyword fallback for day_use type
          if (!catalogueItem && existing.type === "day_use") {
            catalogueItem = allItems.find(i => {
              const name = i.name.toLowerCase();
              return (
                name.includes("creche") ||
                name.includes("day") ||
                name.includes("diária") ||
                name.includes("diaria") ||
                name.includes("hosped") ||
                name.includes("estadia") ||
                name.includes("pernoite") ||
                name.includes("hotel")
              );
            });
          }

          if (!catalogueItem) {
            // No matching catalogue item — confirm the booking with price = 0 and log a warning.
            // This is intentionally non-fatal: refusing to confirm because of a missing price
            // configuration would block the admin from managing bookings entirely.
            console.warn(
              `[bookings] confirm: no catalogue item found for type="${existing.type}" ` +
              `(crecheId=${crecheId}). Confirming with price=0.`
            );
            updates.price = 0;
            daysToBill = 0; // skip billing block below
          }

          let unitPrice = 0;
          if (catalogueItem) {
             const [pet] = await tx.select().from(petsTable).where(eq(petsTable.id, existing.petId)).limit(1);
             if (pet?.size === 'small' && catalogueItem.priceSmall) {
               unitPrice = Number(catalogueItem.priceSmall);
             } else if (pet?.size === 'medium' && catalogueItem.priceMedium) {
               unitPrice = Number(catalogueItem.priceMedium);
             } else if (pet?.size === 'large' && catalogueItem.priceLarge) {
               unitPrice = Number(catalogueItem.priceLarge);
             } else {
               unitPrice = Number(catalogueItem.basePrice);
             }
             
             // Fase 7: CreditService.consumeServiceCreditsForBooking
             // Rastreia consumo em booking_service_credits para restauração no cancelamento (Fase 5)
             if (catalogueItem.type === "service" && daysToBill > 0) {
               daysToBill = await consumeServiceCreditsForBooking(
                 bookingId,
                 existing.tutorId!,
                 crecheId,
                 catalogueItem,
                 daysToBill,
                 req.user!.id,
                 tx
               );
             }
          }
          
          const subtotal = unitPrice * daysToBill;
          if (subtotal > 0) {
            await BillingService.addCharge({
              crecheId,
              tutorId: existing.tutorId!,
              amount: unitPrice,
              quantity: daysToBill,
              description: catalogueItem ? catalogueItem.name : existing.type,
              type: existing.type,
              petId: existing.petId,
              bookingId: bookingId,
              itemDate: new Date(existing.startDate),
              tx: tx,
              userId: req.user!.id,
              // Fase 14: snapshot para rastreabilidade e recuperação sem Catalogue
              catalogueItemId: catalogueItem?.id,
            });
          }
          
          updates.price = subtotal;
        } else {
          updates.price = 0;
        }
        
        await logFinancialAudit({
          crecheId,
          userId: req.user!.id,
          action: "credits_deduct",
          referenceId: bookingId,
          referenceType: "bookings",
          details: `Reserva confirmada: ${totalConsumedNormal} diárias consumidas, ${totalPiggybacked} diárias via pacote multi-pet (carona), e ${daysToBill} diárias faturadas como excedentes.`
        }, tx);
      }

      // Handle cancellation logic
      if (status === "cancelled" && existing.status !== "cancelled") {
        // Fase 4+7: CreditService restaura créditos de pacote (com piggyback) e serviço
        // usando GREATEST(0, ...) para evitar saldos negativos (underflow protection)
        await restoreBookingPackageCredits(bookingId, tx, crecheId);
        await restoreBookingServiceCredits(bookingId, tx, crecheId);

        // Cancelar faturas pendentes vinculadas à reserva
        await tx.update(invoicesTable)
          .set({ status: "voided" })
          .where(and(eq(invoicesTable.bookingId, bookingId), eq(invoicesTable.status, "pending")));

        // Fase 12: audit log movido para dentro do bloco (antes executava em todo status change)
        await logFinancialAudit({
          crecheId,
          userId: req.user!.id,
          action: "credits_deduct",
          referenceId: bookingId,
          referenceType: "bookings",
          details: "Estorno de créditos devido a cancelamento da reserva."
        }, tx);
      }


      const [booking] = await tx
        .update(bookingsTable)
        .set(updates)
        .where(and(eq(bookingsTable.id, bookingId), eq(bookingsTable.crecheId, crecheId)))
        .returning();

      // Enriquecer
      const [pet] = await tx.select({ name: petsTable.name }).from(petsTable).where(eq(petsTable.id, booking.petId)).limit(1);
      const [tutor] = await tx.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, booking.tutorId)).limit(1);
      
      return {
        ...booking,
        petName: pet?.name,
        tutorName: tutor?.name,
        _prevStatus: existing.status
      };
    });

    const { _prevStatus, ...bookingWithoutPrev } = enriched;
    const booking = bookingWithoutPrev;
    const prevStatus = _prevStatus;

    // Push notifications
    if (status) {
      if (status === "cancel_requested" && booking.tutorId) {
        sendPushToRole(crecheId, "creche_admin", {
          title: `⚠️ Cancelamento solicitado — ${enriched.petName ?? "Pet"}`,
          body: `${enriched.tutorName ?? "Tutor"} solicitou o cancelamento da reserva de ${enriched.petName ?? "Pet"}.`,
          tag: `booking-cancel-req-${booking.id}`,
          data: { type: "booking", bookingId: booking.id, petId: booking.petId, crecheId },
        }).catch(() => {});
      } else if (booking.tutorId) {
        if (prevStatus === "cancel_requested" && status === "confirmed") {
          sendPushToUser(booking.tutorId, {
            title: `❌ Cancelamento recusado`,
            body: `A creche recusou o cancelamento da reserva de ${enriched.petName ?? "seu pet"}. A reserva segue confirmada.`,
            tag: `booking-cancel-rejected-${booking.id}`,
            data: { type: "booking", bookingId: booking.id, petId: booking.petId },
          }).catch(() => {});
        } else if (prevStatus === "cancel_requested" && status === "cancelled") {
          sendPushToUser(booking.tutorId, {
            title: `✅ Cancelamento aprovado`,
            body: `A creche aprovou o cancelamento da reserva de ${enriched.petName ?? "seu pet"}.`,
            tag: `booking-status-${booking.id}`,
            data: { type: "booking", bookingId: booking.id, petId: booking.petId },
          }).catch(() => {});
        } else {
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
              data: { type: "booking", bookingId: booking.id, petId: booking.petId },
            }).catch(() => {});
          }
        }
      }
    }

    res.json(enriched);
  } catch (err: any) {
    if (err.message === "Tutores só podem solicitar cancelamento de reservas." || 
        err.message === "Reserva não encontrada." ||
        err.message === "Só é possível solicitar cancelamento de reservas pendentes ou confirmadas.") {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

router.post("/:bookingId/on-the-way", async (req: AuthRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const crecheId = parseInt(String(req.params.crecheId));
  const bookingId = parseInt(String(req.params.bookingId));
  const { type, etaMinutes } = req.body;

  if (!["drop_off", "pickup"].includes(type)) {
    res.status(400).json({ error: "type deve ser 'drop_off' ou 'pickup'" });
    return;
  }

  const [booking] = await db
    .update(bookingsTable)
    .set({
      onTheWayType: type,
      onTheWayEtaMinutes: etaMinutes ? parseInt(etaMinutes) : null,
      onTheWayAt: new Date(),
    })
    .where(
      and(
        eq(bookingsTable.crecheId, crecheId),
        eq(bookingsTable.id, bookingId),
      ),
    )
    .returning();

  const enriched = await getBookingWithNames(booking);
  const etaText = etaMinutes ? ` (aprox. ${etaMinutes} min)` : "";
  const petName = enriched.petName ?? "um pet";
  const senderName = req.user.name ?? "Alguém";

  if (req.user.role === "tutor") {
    // Tutor está a caminho → avisar creche (admins e staff)
    const tutorBody = type === "drop_off"
      ? `${senderName} está a caminho para deixar ${petName}${etaText}.`
      : `${senderName} está a caminho para buscar ${petName}${etaText}.`;
    sendPushToRole(crecheId, "creche_admin", {
      title: `🚗 Tutor a caminho — ${petName}`,
      body: tutorBody,
      tag: `on-the-way-${booking.id}`,
      data: {
        type: "booking",
        bookingId: booking.id,
        petId: booking.petId,
        crecheId,
      },
    }).catch(() => {});
    sendPushToRole(crecheId, "staff", {
      title: `🚗 Tutor a caminho — ${petName}`,
      body: tutorBody,
      tag: `on-the-way-${booking.id}`,
      data: {
        type: "booking",
        bookingId: booking.id,
        petId: booking.petId,
        crecheId,
      },
    }).catch(() => {});
  } else {
    // Creche (admin/staff) está a caminho → avisar tutor
    // drop_off = creche vai levar o pet ao tutor; pickup = creche vai buscar o pet no tutor
    const crecheBody = type === "drop_off"
      ? `A creche está a caminho para levar ${petName}${etaText}.`
      : `A creche está a caminho para buscar ${petName}${etaText}.`;
    if (booking.tutorId) {
      sendPushToUser(booking.tutorId, {
        title: `🚗 Creche a caminho — ${petName}`,
        body: crecheBody,
        tag: `on-the-way-${booking.id}`,
        data: { type: "booking", bookingId: booking.id, petId: booking.petId },
      }).catch(() => {});
    }
  }

  res.json(enriched);
});

router.post("/:bookingId/confirm-arrival", async (req: AuthRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const crecheId = parseInt(String(req.params.crecheId));
  const bookingId = parseInt(String(req.params.bookingId));

  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(
      and(
        eq(bookingsTable.crecheId, crecheId),
        eq(bookingsTable.id, bookingId),
      ),
    )
    .limit(1);
  if (!booking) {
    res.status(404).json({ error: "Reserva não encontrada" });
    return;
  }

  if (booking.tutorId) {
    const enriched = await getBookingWithNames(booking);
    const typeLabel = booking.onTheWayType === "pickup" ? "buscar" : "trazer";
    sendPushToUser(booking.tutorId, {
      title: `✅ Creche confirma sua chegada`,
      body: `A creche está te esperando para ${typeLabel} ${enriched.petName ?? "seu pet"}.`,
      tag: `arrival-confirmed-${booking.id}`,
      data: { type: "booking", bookingId: booking.id, petId: booking.petId },
    }).catch(() => {});
  }

  res.json({ message: "Confirmação enviada ao tutor" });
});

router.post("/:bookingId/personal-items", async (req: AuthRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Não autenticado" });
    return;
  }
  const crecheId = parseInt(String(req.params.crecheId));
  const bookingId = parseInt(String(req.params.bookingId));
  const { hasItems, photoUrl } = req.body;

  if (typeof hasItems !== "boolean") {
    res.status(400).json({ error: "hasItems (boolean) é obrigatório" });
    return;
  }
  if (hasItems && !photoUrl) {
    res.status(400).json({ error: "photoUrl é obrigatório quando há itens" });
    return;
  }

  const [booking] = await db
    .update(bookingsTable)
    .set({
      hasPersonalItems: hasItems,
      personalItemsPhotoUrl: hasItems ? photoUrl : null,
    })
    .where(
      and(
        eq(bookingsTable.crecheId, crecheId),
        eq(bookingsTable.id, bookingId),
      ),
    )
    .returning();

  if (hasItems && photoUrl && booking?.petId) {
    await db
      .update(petsTable)
      .set({ lastCheckinPhotoUrl: photoUrl })
      .where(eq(petsTable.id, booking.petId));
  }

  res.json(await getBookingWithNames(booking));
});

router.post("/:bookingId/checkin", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const bookingId = parseInt(String(req.params.bookingId));

  // Fetch booking first to get petId and validate status
  const [existingBooking] = await db
    .select()
    .from(bookingsTable)
    .where(
      and(
        eq(bookingsTable.crecheId, crecheId),
        eq(bookingsTable.id, bookingId),
      ),
    )
    .limit(1);
  if (!existingBooking) {
    res.status(404).json({ error: "Reserva não encontrada" });
    return;
  }
  if (existingBooking.status !== "confirmed") {
    res
      .status(400)
      .json({ error: "Apenas reservas confirmadas podem realizar check-in." });
    return;
  }

  // Check for expired rabies vaccine
  const { vaccinesTable } = await import("@workspace/db/schema");
  const { ilike, or, lte } = await import("drizzle-orm");
  const [expiredVaccine] = await db
    .select()
    .from(vaccinesTable)
    .where(
      and(
        eq(vaccinesTable.petId, existingBooking.petId),
        or(
          ilike(vaccinesTable.name, "%antirr%"),
          ilike(vaccinesTable.name, "%raiva%"),
        ),
        lte(vaccinesTable.nextDueDate, new Date().toISOString().split("T")[0]),
      ),
    )
    .limit(1);

  if (expiredVaccine) {
    res.status(403).json({
      error:
        "Vacina antirrábica vencida. Check-in bloqueado por razões de saúde e segurança.",
      code: "VACCINE_EXPIRED",
    });
    return;
  }

  // Block if pet already has an active check-in
  const [alreadyActive] = await db
    .select({ id: bookingsTable.id })
    .from(bookingsTable)
    .where(
      and(
        eq(bookingsTable.crecheId, crecheId),
        eq(bookingsTable.petId, existingBooking.petId),
        eq(bookingsTable.status, "active"),
      ),
    )
    .limit(1);
  if (alreadyActive) {
    res
      .status(409)
      .json({
        error:
          "Este pet já possui um check-in ativo. Realize o check-out antes de fazer um novo.",
      });
    return;
  }

  // Proceed: check-in + clear on-the-way state
  const [booking] = await db
    .update(bookingsTable)
    .set({
      status: "active",
      checkInTime: new Date(),
      onTheWayType: null,
      onTheWayEtaMinutes: null,
      onTheWayAt: null,
    })
    .where(
      and(
        eq(bookingsTable.crecheId, crecheId),
        eq(bookingsTable.id, bookingId),
      ),
    )
    .returning();

  await db
    .update(petsTable)
    .set({ isCheckedIn: true })
    .where(eq(petsTable.id, booking.petId));
  await db
    .update(crechesTable)
    .set({
      currentOccupancy: db.$count(
        petsTable,
        and(eq(petsTable.crecheId, crecheId), eq(petsTable.isCheckedIn, true)),
      ) as any,
    })
    .where(eq(crechesTable.id, crecheId));

  const enriched = await getBookingWithNames(booking);

  // Generate tasks for this pet today (fire-and-forget)
  import("../lib/scheduler.js")
    .then(({ generateTasksForPetToday }) => {
      generateTasksForPetToday(booking.petId, crecheId).catch(() => {});
    })
    .catch(() => {});

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

  try {
    const [existing] = await db
      .select()
      .from(bookingsTable)
      .where(
        and(
          eq(bookingsTable.crecheId, crecheId),
          eq(bookingsTable.id, bookingId),
        ),
      )
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Reserva não encontrada" });
      return;
    }

    // Engine Financeira
    await db.transaction(async (tx) => {
      // 1. Atualizar o booking
      await tx
        .update(bookingsTable)
        .set({
          status: "completed",
          checkOutTime: new Date(),
          onTheWayType: null,
          onTheWayEtaMinutes: null,
          onTheWayAt: null,
        })
        .where(
          and(
            eq(bookingsTable.crecheId, crecheId),
            eq(bookingsTable.id, bookingId),
          ),
        );

      await tx
        .update(petsTable)
        .set({ isCheckedIn: false })
        .where(eq(petsTable.id, existing.petId));

      // 2. Coletar Consumables
      // Nota: o preço base da reserva foi faturado na confirmação (consumePackageCredits +
      // BillingService.addCharge). O check-out fatura apenas os consumíveis adicionados
      // durante a estadia para evitar cobrança duplicada do valor base.
      const consumables = await tx
        .select({
          itemId: bookingConsumablesTable.itemId,
          quantity: bookingConsumablesTable.quantity,
          chargedPrice: bookingConsumablesTable.chargedPrice,
          itemName: catalogueItemsTable.name,
        })
        .from(bookingConsumablesTable)
        .leftJoin(catalogueItemsTable, eq(bookingConsumablesTable.itemId, catalogueItemsTable.id))
        .where(eq(bookingConsumablesTable.bookingId, bookingId));

      // 3. Faturar apenas consumíveis no check-out.
      // ATENÇÃO: o preço base da reserva é faturado na confirmação (via BillingService.addCharge
      // na fase de confirmação). Faturar novamente aqui causaria cobrança em duplicidade.
      // Os créditos de pacote também são consumidos na confirmação via consumePackageCredits.
      const consumableCharges = consumables.filter(item => Number(item.chargedPrice) > 0);
      if (consumableCharges.length > 0 && existing.tutorId) {
        let firstInvoiceId: number | null = null;
        for (const item of consumableCharges) {
          const invoiceId = await BillingService.addCharge({
            crecheId,
            tutorId: existing.tutorId,
            amount: Number(item.chargedPrice),
            quantity: item.quantity,
            description: item.itemName || `Consumível #${item.itemId}`,
            type: "consumable",
            petId: existing.petId,
            bookingId: bookingId,
            itemDate: new Date(),
            tx: tx,
          });
          if (firstInvoiceId === null) firstInvoiceId = invoiceId;
        }

        // 5. Auditoria
        await logFinancialAudit({
          crecheId,
          userId: req.user!.id,
          action: "invoice_create",
          referenceId: firstInvoiceId!,
          referenceType: "invoices",
          details: `Check-out da reserva #${bookingId}. ${consumableCharges.length} consumível(is) faturado(s) no check-out.`,
        }, tx);
      }
    });

    // Buscar o booking atualizado para retornar
    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(
        and(
          eq(bookingsTable.crecheId, crecheId),
          eq(bookingsTable.id, bookingId),
        ),
      )
      .limit(1);
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
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Finaliza um serviço específico sem fazer checkout do pet (pet permanece presente)
// Se não houver outra reserva ativa para o pet, atualiza isCheckedIn para false automaticamente.
router.post("/:bookingId/complete-service", async (req: AuthRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (req.user.role === "tutor") {
    res.status(403).json({ error: "Sem permissão" });
    return;
  }
  const crecheId = parseInt(String(req.params.crecheId));
  const bookingId = parseInt(String(req.params.bookingId));

  const [booking] = await db
    .update(bookingsTable)
    .set({
      status: "completed",
      checkOutTime: new Date(),
    })
    .where(
      and(
        eq(bookingsTable.crecheId, crecheId),
        eq(bookingsTable.id, bookingId),
      ),
    )
    .returning();

  if (!booking) {
    res.status(404).json({ error: "Reserva não encontrada" });
    return;
  }

  // If no other active booking exists for this pet, release it from the creche
  const [otherActive] = await db
    .select({ id: bookingsTable.id })
    .from(bookingsTable)
    .where(
      and(
        eq(bookingsTable.crecheId, crecheId),
        eq(bookingsTable.petId, booking.petId),
        eq(bookingsTable.status, "active"),
      ),
    )
    .limit(1);

  if (!otherActive) {
    await db
      .update(petsTable)
      .set({ isCheckedIn: false })
      .where(eq(petsTable.id, booking.petId));
    await db
      .update(crechesTable)
      .set({
        currentOccupancy: db.$count(
          petsTable,
          and(
            eq(petsTable.crecheId, crecheId),
            eq(petsTable.isCheckedIn, true),
          ),
        ) as any,
      })
      .where(eq(crechesTable.id, crecheId));
  }

  const enriched = await getBookingWithNames(booking);

  // Notify tutor that the specific service was completed (pet stays)
  if (booking.tutorId) {
    const typeLabels: Record<string, string> = {
      banho: "Banho",
      hospedagem_banho: "Hospedagem + Banho",
      visita: "Visita",
      day_use: "Day Use",
      lodging: "Hospedagem",
      pacote_4dias: "Pacote 4 Dias",
      pacote_8dias: "Pacote 8 Dias",
      pacote_20dias: "Pacote 20 Dias",
      visita_taxi: "Visita + Táxi",
      creche_taxi: "Creche + Táxi",
    };
    // Convert unknown slugs (e.g. "banho_tosa", "creche_diaria") into human-readable
    // labels so push notifications and invoice descriptions are never shown as raw slugs.
    const serviceLabel = typeLabels[booking.type] ??
      String(booking.type)
        .split("_")
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    sendPushToUser(booking.tutorId, {
      title: `✅ ${serviceLabel} concluído — ${enriched.petName ?? "Seu pet"}`,
      body: `O serviço de ${serviceLabel} de ${enriched.petName ?? "seu pet"} foi finalizado. O pet continua na creche.`,
      tag: `service-done-${booking.id}`,
      data: { type: "booking", bookingId: booking.id, petId: booking.petId },
    }).catch(() => {});
  }

  res.json(enriched);
});

// ==========================================
// CONSUMÍVEIS (ADICIONAIS) DA RESERVA
// ==========================================

router.get("/:bookingId/consumables", async (req: AuthRequest, res) => {
  const crecheId = parseInt(String(req.params.crecheId));
  const bookingId = parseInt(String(req.params.bookingId));
  try {
    // Validar se booking pertence à creche e se o tutor pode ver
    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(
        and(
          eq(bookingsTable.id, bookingId),
          eq(bookingsTable.crecheId, crecheId),
        ),
      );
    if (!booking) {
      res.status(404).json({ error: "Reserva não encontrada" });
      return;
    }
    if (req.user!.role === "tutor" && booking.tutorId !== req.user!.id) {
      res.status(403).json({ error: "Sem acesso" });
      return;
    }

    const items = await db
      .select({
        id: bookingConsumablesTable.id,
        quantity: bookingConsumablesTable.quantity,
        chargedPrice: bookingConsumablesTable.chargedPrice,
        createdAt: bookingConsumablesTable.createdAt,
        item: {
          id: catalogueItemsTable.id,
          name: catalogueItemsTable.name,
          type: catalogueItemsTable.type,
        },
      })
      .from(bookingConsumablesTable)
      .innerJoin(
        catalogueItemsTable,
        eq(bookingConsumablesTable.itemId, catalogueItemsTable.id),
      )
      .where(eq(bookingConsumablesTable.bookingId, bookingId));

    res.json(items);
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/:bookingId/consumables", async (req: AuthRequest, res) => {
  if (req.user!.role === "tutor") {
    res.status(403).json({ error: "Apenas staff" });
    return;
  }
  const crecheId = parseInt(String(req.params.crecheId));
  const bookingId = parseInt(String(req.params.bookingId));
  const { itemId, quantity } = req.body;

  try {
    const [booking] = await db
      .select()
      .from(bookingsTable)
      .where(
        and(
          eq(bookingsTable.id, bookingId),
          eq(bookingsTable.crecheId, crecheId),
        ),
      );
    if (!booking) {
      res.status(404).json({ error: "Reserva não encontrada" });
      return;
    }

    const [item] = await db
      .select()
      .from(catalogueItemsTable)
      .where(
        and(
          eq(catalogueItemsTable.id, itemId),
          eq(catalogueItemsTable.crecheId, crecheId),
        ),
      );
    if (!item) {
      res.status(404).json({ error: "Item não encontrado no catálogo" });
      return;
    }

    // Se o serviço depender do porte do pet, precisaríamos buscar o pet. Simplificado para usar basePrice:
    let price = Number(item.basePrice);

    if (item.type === "service") {
      const [pet] = await db
        .select()
        .from(petsTable)
        .where(eq(petsTable.id, booking.petId));
      if (pet && pet.size) {
        if (pet.size === "small" && item.priceSmall)
          price = Number(item.priceSmall);
        else if (pet.size === "medium" && item.priceMedium)
          price = Number(item.priceMedium);
        else if (pet.size === "large" && item.priceLarge)
          price = Number(item.priceLarge);
      }
    }

    const [consumable] = await db
      .insert(bookingConsumablesTable)
      .values({
        bookingId,
        itemId,
        quantity: quantity || 1,
        chargedPrice: String(price),
        addedBy: req.user!.id,
      })
      .returning();

    if (item.type === "product" && item.trackStock) {
      await db
        .update(catalogueItemsTable)
        .set({
          stockQuantity: sql`${catalogueItemsTable.stockQuantity} - ${quantity || 1}`,
        })
        .where(eq(catalogueItemsTable.id, itemId));

      await logFinancialAudit({
        crecheId,
        userId: req.user!.id,
        action: "stock_adjustment",
        referenceId: itemId,
        referenceType: "catalogue_items",
        details: `Estoque reduzido em ${quantity || 1} para consumo na reserva #${bookingId}`,
      }, db);
    }

    res.json(consumable);
  } catch (err: unknown) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete(
  "/:bookingId/consumables/:consumableId",
  async (req: AuthRequest, res) => {
    if (req.user!.role === "tutor") {
      res.status(403).json({ error: "Apenas staff" });
      return;
    }
    const consumableId = parseInt(String(req.params.consumableId));

    try {
      const [consumable] = await db
        .delete(bookingConsumablesTable)
        .where(eq(bookingConsumablesTable.id, consumableId))
        .returning();

      if (consumable) {
        const [item] = await db
          .select()
          .from(catalogueItemsTable)
          .where(eq(catalogueItemsTable.id, consumable.itemId));
        if (item && item.type === "product" && item.trackStock) {
          await db
            .update(catalogueItemsTable)
            .set({
              stockQuantity: sql`${catalogueItemsTable.stockQuantity} + ${consumable.quantity}`,
            })
            .where(eq(catalogueItemsTable.id, consumable.itemId));
        }
      }

      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(500).json({ error: String(err) });
    }
  },
);

export default router;
