import { db } from "@workspace/db";
import {
  tutorCreditsTable,
  tutorServiceCreditsTable,
  invoicesTable,
  invoiceItemsTable,
  catalogueItemsTable,
  bookingCreditsTable,
  bookingServiceCreditsTable,
  bookingsTable,
} from "@workspace/db/schema";
import { eq, and, or, sql, isNull, asc, gte, gt } from "drizzle-orm";
import { logFinancialAudit } from "./audit.js";
import { normalizeServiceType } from "../utils/service-name.js";

// ─────────────────────────────────────────────────────────────────────────────
// Fase 7: Tipos públicos da API interna do CreditService
// ─────────────────────────────────────────────────────────────────────────────

export interface ConsumePackageCreditsResult {
  totalPiggybacked: number;
  totalConsumedNormal: number;
  daysToBill: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// releasePurchasedCredits — Fase 2 (FOR UPDATE) + Fase 9 (sem regex)
// ─────────────────────────────────────────────────────────────────────────────

export async function releasePurchasedCredits(
  invoiceId: number,
  paidByUserId: number,
  tx: any
): Promise<void> {

  // Fase 2: lock pessimista — impede liberação dupla concorrente para o mesmo invoiceId
  const [invoice] = await tx
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, invoiceId))
    .for("update");

  if (!invoice) return;
  if (invoice.creditsReleased) return; // gate de idempotência

  const items = await tx
    .select()
    .from(invoiceItemsTable)
    .where(eq(invoiceItemsTable.invoiceId, invoiceId));

  // Fase 9: decisão baseada exclusivamente em itemType — sem regex
  const packageItems = items.filter((item: typeof invoiceItemsTable.$inferSelect) =>
    item.itemType === "package"
  );

  const serviceItems = items.filter((item: typeof invoiceItemsTable.$inferSelect) =>
    item.itemType === "service"
  );

  if (packageItems.length === 0 && serviceItems.length === 0) return;

  let creditsAdded = false;

  for (const packageItem of packageItems) {
    const [catItem] = await tx.select().from(catalogueItemsTable).where(
      and(
        eq(catalogueItemsTable.crecheId, invoice.crecheId),
        eq(catalogueItemsTable.name, packageItem.description)
      )
    ).limit(1);

    const baseCredits: number | null = catItem?.creditsAmount ?? null;
    if (!baseCredits || baseCredits <= 0) continue;

    const creditsAmount = baseCredits * (packageItem.quantity || 1);
    const maxPetsPerDay = catItem?.maxPetsPerDay ?? 1;

    const expirationDate = new Date();
    expirationDate.setFullYear(expirationDate.getFullYear() + 1);

    await tx.insert(tutorCreditsTable).values({
      crecheId: invoice.crecheId,
      tutorId: invoice.tutorId,
      totalCredits: creditsAmount,
      usedCredits: 0,
      maxPetsPerDay,
      expirationDate: expirationDate.toISOString().split("T")[0],
    });

    creditsAdded = true;
  }

  for (const serviceItem of serviceItems) {
    const catalogueItems = await tx.select().from(catalogueItemsTable).where(
      and(
        eq(catalogueItemsTable.crecheId, invoice.crecheId),
        eq(catalogueItemsTable.name, serviceItem.description),
        eq(catalogueItemsTable.type, "service")
      )
    ).limit(1);

    if (catalogueItems.length > 0) {
      await tx.insert(tutorServiceCreditsTable).values({
        crecheId: invoice.crecheId,
        tutorId: invoice.tutorId,
        catalogueItemId: catalogueItems[0].id,
        totalCredits: serviceItem.quantity || 1,
      });
      creditsAdded = true;
    }
  }

  if (!creditsAdded) return;

  await tx.update(invoicesTable)
    .set({ creditsReleased: true })
    .where(eq(invoicesTable.id, invoiceId));

  await logFinancialAudit({
    crecheId: invoice.crecheId,
    userId: paidByUserId,
    action: "credits_purchase",
    referenceId: invoiceId,
    referenceType: "invoices",
    details: `Créditos liberados para tutor #${invoice.tutorId} após pagamento da fatura #${invoiceId}.`,
  }, tx);
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 7: consumePackageCredits
// Extrai o loop de consumo/carona de diárias de packages do routes/bookings.ts.
// Retorna { totalPiggybacked, totalConsumedNormal, daysToBill }.
// ─────────────────────────────────────────────────────────────────────────────

export async function consumePackageCredits(
  bookingId: number,
  tutorId: number,
  crecheId: number,
  startDate: Date,
  endDate: Date,
  packageMaxPets: number,
  tx: any
): Promise<ConsumePackageCreditsResult> {
  let totalPiggybacked = 0;
  let totalConsumedNormal = 0;
  let daysToBill = 0;

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];

    // 1. Tentar carona (piggyback) — pacotes multi-pet
    const piggybackCandidates = await tx
      .select({
        creditId: bookingCreditsTable.tutorCreditId,
        maxPets: tutorCreditsTable.maxPetsPerDay,
        usedPetsCount: sql<number>`count(DISTINCT ${bookingsTable.petId})`,
      })
      .from(bookingCreditsTable)
      .innerJoin(tutorCreditsTable, eq(bookingCreditsTable.tutorCreditId, tutorCreditsTable.id))
      .innerJoin(bookingsTable, eq(bookingCreditsTable.bookingId, bookingsTable.id))
      .where(and(
        eq(bookingsTable.tutorId, tutorId),
        eq(bookingsTable.crecheId, crecheId),
        eq(bookingCreditsTable.consumedDate, dateStr),
        isNull(bookingCreditsTable.restoredAt),
        gt(tutorCreditsTable.maxPetsPerDay, 1),
        eq(tutorCreditsTable.maxPetsPerDay, packageMaxPets),
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
        bookingId,
        tutorCreditId: piggybackedCreditId,
        creditsConsumed: 0,
        consumedDate: dateStr,
      });
      totalPiggybacked++;
      continue;
    }

    // 2. Consumo normal de crédito do pacote
    const validCredits = await tx
      .select()
      .from(tutorCreditsTable)
      .where(and(
        eq(tutorCreditsTable.tutorId, tutorId),
        eq(tutorCreditsTable.crecheId, crecheId),
        eq(tutorCreditsTable.maxPetsPerDay, packageMaxPets),
        sql`${tutorCreditsTable.usedCredits} < ${tutorCreditsTable.totalCredits}`,
        or(
          isNull(tutorCreditsTable.expirationDate),
          gte(tutorCreditsTable.expirationDate, new Date().toISOString().split("T")[0])
        )
      ))
      .orderBy(asc(tutorCreditsTable.expirationDate), asc(tutorCreditsTable.createdAt))
      .limit(1)
      .for("update");

    if (validCredits.length > 0) {
      const creditPack = validCredits[0];
      await tx.update(tutorCreditsTable)
        .set({ usedCredits: sql`${tutorCreditsTable.usedCredits} + 1` })
        .where(eq(tutorCreditsTable.id, creditPack.id));

      await tx.insert(bookingCreditsTable).values({
        bookingId,
        tutorCreditId: creditPack.id,
        creditsConsumed: 1,
        consumedDate: dateStr,
      });
      totalConsumedNormal++;
    } else {
      // 3. Sem saldo — dia excedente a faturar
      daysToBill++;
    }
  }

  return { totalPiggybacked, totalConsumedNormal, daysToBill };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 7: consumeServiceCreditsForBooking
// Extrai o consumo de créditos de serviço (carteira) do routes/bookings.ts.
// Retorna o número de dias restantes após o consumo de créditos.
// ─────────────────────────────────────────────────────────────────────────────

export async function consumeServiceCreditsForBooking(
  bookingId: number,
  tutorId: number,
  crecheId: number,
  catalogueItem: { id: number; type: string; name: string },
  daysToBill: number,
  userId: number,
  tx: any
): Promise<number> {
  if (catalogueItem.type !== "service") return daysToBill;

  const bookingServiceType = normalizeServiceType(catalogueItem.name);

  // Busca todos os créditos de serviço disponíveis para este tutor/creche
  const candidateCredits = await tx
    .select({
      id: tutorServiceCreditsTable.id,
      totalCredits: tutorServiceCreditsTable.totalCredits,
      usedCredits: tutorServiceCreditsTable.usedCredits,
      itemName: catalogueItemsTable.name,
    })
    .from(tutorServiceCreditsTable)
    .innerJoin(
      catalogueItemsTable,
      eq(catalogueItemsTable.id, tutorServiceCreditsTable.catalogueItemId),
    )
    .where(and(
      eq(tutorServiceCreditsTable.tutorId, tutorId),
      eq(tutorServiceCreditsTable.crecheId, crecheId),
      sql`${tutorServiceCreditsTable.usedCredits} < ${tutorServiceCreditsTable.totalCredits}`,
    ))
    .orderBy(asc(tutorServiceCreditsTable.id))
    .for("update");

  // Filtra por tipo de serviço normalizado (ex: "banho" cobre variantes de porte)
  const matchingCredits = candidateCredits.filter(
    (c: { itemName: string }) => normalizeServiceType(c.itemName) === bookingServiceType,
  );

  let remaining = daysToBill;

  for (const credit of matchingCredits) {
    if (remaining <= 0) break;

    const availableInCredit = credit.totalCredits - credit.usedCredits;
    const toConsume = Math.min(availableInCredit, remaining);

    await tx.update(tutorServiceCreditsTable)
      .set({ usedCredits: sql`${tutorServiceCreditsTable.usedCredits} + ${toConsume}` })
      .where(eq(tutorServiceCreditsTable.id, credit.id));

    // Fase 5: rastrear consumo em booking_service_credits para permitir restauração
    await tx.insert(bookingServiceCreditsTable).values({
      bookingId,
      tutorServiceCreditId: credit.id,
      creditsConsumed: toConsume,
    });

    remaining -= toConsume;

    await logFinancialAudit({
      crecheId,
      userId,
      action: "credits_deduct",
      referenceId: bookingId,
      referenceType: "bookings",
      details: `Consumo de ${toConsume} crédito(s) de serviço (${credit.itemName} → ${catalogueItem.name}) da Carteira de Serviços.`,
    }, tx);
  }

  return remaining; // dias restantes a faturar
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 4+7: restoreBookingPackageCredits
// Extrai a restauração de créditos de pacote do cancelamento em routes/bookings.ts.
// Fase 4: GREATEST(0, ...) impede usedCredits negativo.
// ─────────────────────────────────────────────────────────────────────────────

export async function restoreBookingPackageCredits(
  bookingId: number,
  tx: any
): Promise<void> {
  const consumed = await tx
    .select()
    .from(bookingCreditsTable)
    .where(and(
      eq(bookingCreditsTable.bookingId, bookingId),
      isNull(bookingCreditsTable.restoredAt),
    ));

  for (const c of consumed) {
    let shouldRestoreToTutor = true;

    if (c.creditsConsumed > 0 && c.consumedDate) {
      // Verificar se existe reserva de carona dependente deste crédito
      const [child] = await tx.select().from(bookingCreditsTable)
        .where(and(
          eq(bookingCreditsTable.tutorCreditId, c.tutorCreditId),
          eq(bookingCreditsTable.consumedDate, c.consumedDate),
          eq(bookingCreditsTable.creditsConsumed, 0),
          isNull(bookingCreditsTable.restoredAt),
          sql`${bookingCreditsTable.id} != ${c.id}`,
        )).limit(1);

      if (child) {
        // Transferir o crédito para a reserva de carona
        await tx.update(bookingCreditsTable)
          .set({ creditsConsumed: c.creditsConsumed })
          .where(eq(bookingCreditsTable.id, child.id));
        shouldRestoreToTutor = false;
      }
    }

    if (shouldRestoreToTutor) {
      // Fase 4: GREATEST(0, ...) garante que usedCredits nunca fica negativo
      await tx.update(tutorCreditsTable)
        .set({ usedCredits: sql`GREATEST(0, ${tutorCreditsTable.usedCredits} - ${c.creditsConsumed})` })
        .where(eq(tutorCreditsTable.id, c.tutorCreditId));
    }

    await tx.update(bookingCreditsTable)
      .set({ restoredAt: new Date() })
      .where(eq(bookingCreditsTable.id, c.id));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 4+5+7: restoreBookingServiceCredits
// Restaura créditos de serviço consumidos por uma reserva cancelada.
// Fase 4: GREATEST(0, ...) impede usedCredits negativo.
// ─────────────────────────────────────────────────────────────────────────────

export async function restoreBookingServiceCredits(
  bookingId: number,
  tx: any
): Promise<void> {
  const consumed = await tx
    .select()
    .from(bookingServiceCreditsTable)
    .where(and(
      eq(bookingServiceCreditsTable.bookingId, bookingId),
      isNull(bookingServiceCreditsTable.restoredAt),
    ));

  for (const sc of consumed) {
    // Fase 4: GREATEST(0, ...) garante que usedCredits nunca fica negativo
    await tx.update(tutorServiceCreditsTable)
      .set({ usedCredits: sql`GREATEST(0, ${tutorServiceCreditsTable.usedCredits} - ${sc.creditsConsumed})` })
      .where(eq(tutorServiceCreditsTable.id, sc.tutorServiceCreditId));

    await tx.update(bookingServiceCreditsTable)
      .set({ restoredAt: new Date() })
      .where(eq(bookingServiceCreditsTable.id, sc.id));
  }
}
