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
  tutorCreditsTable,
  bookingCreditsTable,
  financialAuditLogsTable,
} from "@workspace/db/schema";
import { eq, and, desc, gte, gt, sql, or, isNull, asc } from "drizzle-orm";
import { authenticate, type AuthRequest } from "../middlewares/authenticate.js";
import { requireActiveSubscription } from "../middlewares/requireActiveSubscription.js";
import { requireCrecheMembership } from "../middlewares/requireCrecheMembership.js";
import { logFinancialAudit } from "../services/audit.js";
import { hasOverdueInvoices, calculateDueDate } from "../services/billing.js";
import { sendPushToUser, sendPushToRole } from "../lib/push.js";

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
        .orderBy(desc(bookingsTable.startDate))
        .limit(pageSize)
        .offset(offset),

      db
        .select({ total: sql<number>`count(*)` })
        .from(bookingsTable)
        .where(and(...conditions)),
    ]);

    res.json({
      items: data,
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

      // Calcula duração (dias). Se endDate não for passado ou for igual, é 1 dia.
      const start = new Date(startDate);
      const end = endDate ? new Date(endDate) : new Date(startDate);
      const durationDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 3600 * 24)) + 1);

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
  } catch (err) {
    next(err);
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
        if (req.user.role === "tutor") {
          if (status !== "cancel_requested") {
            throw new Error("Tutores só podem solicitar cancelamento de reservas.");
          }
          if (existing.tutorId !== req.user.id) {
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

        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          const dateStr = d.toISOString().split("T")[0];
          
          // 1. Tentar pegar carona (Piggyback)
          const piggybackCandidates = await tx
            .select({
              creditId: bookingCreditsTable.tutorCreditId,
              maxPets: tutorCreditsTable.maxPetsPerDay,
              usedPetsCount: sql<number>`count(DISTINCT ${bookingsTable.petId})`
            })
            .from(bookingCreditsTable)
            .innerJoin(tutorCreditsTable, eq(bookingCreditsTable.tutorCreditId, tutorCreditsTable.id))
            .innerJoin(bookingsTable, eq(bookingCreditsTable.bookingId, bookingsTable.id))
            .where(and(
              eq(bookingsTable.tutorId, existing.tutorId),
              eq(bookingsTable.crecheId, crecheId),
              eq(bookingCreditsTable.consumedDate, dateStr),
              isNull(bookingCreditsTable.restoredAt),
              gt(tutorCreditsTable.maxPetsPerDay, 1),
              existing.packageMaxPets != null ? eq(tutorCreditsTable.maxPetsPerDay, existing.packageMaxPets) : undefined
            ))
            .groupBy(bookingCreditsTable.tutorCreditId, tutorCreditsTable.maxPetsPerDay);
            
          let piggybackedCreditId: number | null = null;
          for (const cand of piggybackCandidates) {
            if (Number(cand.usedPetsCount) < cand.maxPets) {
              piggybackedCreditId = cand.creditId;
              break;
            }
          }
          
          if (piggybackedCreditId) {
            await tx.insert(bookingCreditsTable).values({
              bookingId: bookingId,
              tutorCreditId: piggybackedCreditId,
              creditsConsumed: 0,
              consumedDate: dateStr,
            });
            totalPiggybacked++;
            continue;
          }

          // 2. Não conseguiu carona, consumir saldo normal
          const validCredits = await tx
            .select()
            .from(tutorCreditsTable)
            .where(
              and(
                eq(tutorCreditsTable.tutorId, existing.tutorId),
                eq(tutorCreditsTable.crecheId, crecheId),
                existing.packageMaxPets != null ? eq(tutorCreditsTable.maxPetsPerDay, existing.packageMaxPets) : undefined,
                sql`${tutorCreditsTable.usedCredits} < ${tutorCreditsTable.totalCredits}`,
                or(isNull(tutorCreditsTable.expirationDate), gte(tutorCreditsTable.expirationDate, new Date().toISOString().split("T")[0]))
              )
            )
            .orderBy(asc(tutorCreditsTable.expirationDate), asc(tutorCreditsTable.createdAt))
            .limit(1)
            .for("update");

          if (validCredits.length > 0) {
            const creditPack = validCredits[0];
            await tx.update(tutorCreditsTable)
              .set({ usedCredits: sql`${tutorCreditsTable.usedCredits} + 1` })
              .where(eq(tutorCreditsTable.id, creditPack.id));
            
            await tx.insert(bookingCreditsTable).values({
              bookingId: bookingId,
              tutorCreditId: creditPack.id,
              creditsConsumed: 1,
              consumedDate: dateStr,
            });
            totalConsumedNormal++;
          } else {
            // 3. Sem saldo. Faturar.
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
            throw new Error(`Saldo insuficiente e não foi possível faturar diárias excedentes: O serviço '${existing.type === "day_use" ? "Day Use / Creche" : existing.type}' não está cadastrado no catálogo de preços.`);
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
          }
          
          const subtotal = unitPrice * daysToBill;
          if (subtotal > 0) {
            const [tutor] = await tx.select({ mensalidadeDia: usersTable.mensalidadeDia }).from(usersTable).where(eq(usersTable.id, existing.tutorId!)).limit(1);
            const [invoice] = await tx.insert(invoicesTable).values({
              crecheId,
              tutorId: existing.tutorId,
              bookingId,
              amount: String(subtotal),
              status: "pending",
              dueDate: calculateDueDate(tutor?.mensalidadeDia, new Date(existing.startDate)),
            }).returning();
            await tx.insert(invoiceItemsTable).values({
              invoiceId: invoice.id,
              description: catalogueItem ? catalogueItem.name : existing.type,
              amount: String(unitPrice),
              quantity: daysToBill,
            });
          }
          
          updates.price = subtotal;
        } else {
          updates.price = 0;
        }
        
        await logFinancialAudit({
          crecheId,
          userId: req.user.id,
          action: "credits_deduct",
          referenceId: bookingId,
          referenceType: "bookings",
          details: `Reserva confirmada: ${totalConsumedNormal} diárias consumidas, ${totalPiggybacked} diárias via pacote multi-pet (carona), e ${daysToBill} diárias faturadas como excedentes.`
        }, tx);
      }

      // Handle cancellation logic
      if (status === "cancelled" && existing.status !== "cancelled") {
        // 1. Fetch consumed credits
        const consumed = await tx
          .select()
          .from(bookingCreditsTable)
          .where(and(eq(bookingCreditsTable.bookingId, bookingId), isNull(bookingCreditsTable.restoredAt)));

        // 2. Restore credits
        for (const c of consumed) {
          let shouldRestoreToTutor = true;

          if (c.creditsConsumed > 0 && c.consumedDate) {
            const [child] = await tx.select().from(bookingCreditsTable)
              .where(and(
                eq(bookingCreditsTable.tutorCreditId, c.tutorCreditId),
                eq(bookingCreditsTable.consumedDate, c.consumedDate),
                eq(bookingCreditsTable.creditsConsumed, 0),
                isNull(bookingCreditsTable.restoredAt),
                sql`${bookingCreditsTable.id} != ${c.id}`
              )).limit(1);

            if (child) {
              await tx.update(bookingCreditsTable)
                .set({ creditsConsumed: c.creditsConsumed })
                .where(eq(bookingCreditsTable.id, child.id));
                
              shouldRestoreToTutor = false;
            }
          }

          if (shouldRestoreToTutor) {
            await tx.update(tutorCreditsTable)
              .set({ usedCredits: sql`${tutorCreditsTable.usedCredits} - ${c.creditsConsumed}` })
              .where(eq(tutorCreditsTable.id, c.tutorCreditId));
          }

          await tx.update(bookingCreditsTable)
            .set({ restoredAt: new Date() })
            .where(eq(bookingCreditsTable.id, c.id));
        }

        // 3. Cancel pending invoices linked to this booking
        await tx.update(invoicesTable)
          .set({ status: "voided" })
          .where(and(eq(invoicesTable.bookingId, bookingId), eq(invoicesTable.status, "pending")));
      }
        await logFinancialAudit({
          crecheId,
          userId: req.user.id,
          action: "credits_deduct", // using available enum value
          referenceId: bookingId,
          referenceType: "bookings",
          details: "Estorno de créditos devido a cancelamento da reserva."
        }, tx);


      const [booking] = await tx
        .update(bookingsTable)
        .set(updates)
        .where(eq(bookingsTable.id, bookingId))
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
    sendPushToRole(crecheId, "creche_admin", {
      title: `🚗 Tutor a caminho — ${petName}`,
      body: `${senderName} está vindo com ${petName}${etaText}.`,
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
      body: `${senderName} está vindo com ${petName}${etaText}.`,
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
    // type "drop_off" = creche vai buscar o pet na casa do tutor; "pickup" = creche vai levar o pet de volta
    const crecheTypeLabel = type === "drop_off" ? "buscar" : "trazer";
    if (booking.tutorId) {
      sendPushToUser(booking.tutorId, {
        title: `🚗 Creche a caminho — ${petName}`,
        body: `A creche está vindo ${crecheTypeLabel} ${petName}${etaText}.`,
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

      // 2. Coletar Base Price e Consumables
      const basePrice = Number(existing.price || "0");
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

      let totalAmount = basePrice;
      for (const item of consumables) {
        totalAmount += Number(item.chargedPrice) * item.quantity;
      }

      // 3. Verificar Créditos do Tutor (se tem crédito, deduzimos da diária base)
      let creditsUsed = 0;
      if (existing.tutorId && basePrice > 0) {
        const [activeCredits] = await tx
          .select()
          .from(tutorCreditsTable)
          .where(
            and(
              eq(tutorCreditsTable.crecheId, crecheId),
              eq(tutorCreditsTable.tutorId, existing.tutorId),
              sql`${tutorCreditsTable.totalCredits} > ${tutorCreditsTable.usedCredits}`,
              or(
                isNull(tutorCreditsTable.expirationDate),
                gte(
                  tutorCreditsTable.expirationDate,
                  new Date().toISOString().split("T")[0],
                ),
              ),
            ),
          )
          .limit(1);

        if (activeCredits) {
          creditsUsed = 1;
          totalAmount -= basePrice; // Desconta o valor base, tutor só paga consumíveis
          await tx
            .update(tutorCreditsTable)
            .set({ usedCredits: sql`${tutorCreditsTable.usedCredits} + 1` })
            .where(eq(tutorCreditsTable.id, activeCredits.id));
        }
      }

      // 4. Gerar Fatura se houver valor ou se usou crédito
      if (totalAmount > 0 || creditsUsed > 0) {
        const [tutor] = await tx.select({ mensalidadeDia: usersTable.mensalidadeDia }).from(usersTable).where(eq(usersTable.id, existing.tutorId!)).limit(1);

        const [invoice] = await tx
          .insert(invoicesTable)
          .values({
            crecheId,
            tutorId: existing.tutorId!,
            amount: String(totalAmount),
            status: totalAmount === 0 ? "paid" : "pending",
            dueDate: calculateDueDate(tutor?.mensalidadeDia, new Date()),
          })
          .returning();

        // 4.1 Inserir Item Base (Reserva)
        await tx.insert(invoiceItemsTable).values({
          invoiceId: invoice.id,
          description: `Reserva #${bookingId} (${creditsUsed > 0 ? "Pacote de Diárias" : existing.type === "day_use" ? "Day Use" : existing.type})`,
          quantity: 1,
          amount: String(creditsUsed > 0 ? 0 : basePrice),
        });

        // 4.2 Inserir Itens Consumíveis
        for (const item of consumables) {
          await tx.insert(invoiceItemsTable).values({
            invoiceId: invoice.id,
            description: item.itemName || `Consumível #${item.itemId}`,
            quantity: item.quantity,
            amount: item.chargedPrice,
          });
        }

        // 5. Auditoria
        await logFinancialAudit({
          crecheId,
          userId: req.user!.id,
          action: "invoice_create",
          referenceId: invoice.id,
          referenceType: "invoices",
          details: `Fatura #${invoice.id} gerada automaticamente no check-out da reserva #${bookingId}. Total: ${totalAmount}. Créditos usados: ${creditsUsed}.`,
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
    const serviceLabel = typeLabels[booking.type] ?? "Serviço";
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
