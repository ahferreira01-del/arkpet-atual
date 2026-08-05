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
// Tipos públicos do CreditService
// ─────────────────────────────────────────────────────────────────────────────

export interface ConsumePackageCreditsResult {
  totalPiggybacked: number;
  totalConsumedNormal: number;
  daysToBill: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// releasePurchasedCredits
//
// Fase 14: usa snapshot histórico do invoiceItemsTable (catalogueItemId,
// creditsAmount, snapshotMaxPets, snapshotExpirationDays) em vez de consultar
// o Catalogue por nome. Mantém fallback por catalogueItemId (lookup por ID) e
// por nome (legado) para invoices antigas sem snapshot.
//
// Garantias:
// - FOR UPDATE na invoice → idempotência (creditsReleased gate)
// - Nenhum INSERT duplicado se chamado duas vezes para o mesmo invoiceId
// ─────────────────────────────────────────────────────────────────────────────

export async function releasePurchasedCredits(
  invoiceId: number,
  paidByUserId: number,
  tx: any
): Promise<void> {
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

  // Fase 14: decisão baseada em itemType — sem regex
  const packageItems = items.filter(
    (item: typeof invoiceItemsTable.$inferSelect) => item.itemType === "package"
  );
  const serviceItems = items.filter(
    (item: typeof invoiceItemsTable.$inferSelect) => item.itemType === "service"
  );

  if (packageItems.length === 0 && serviceItems.length === 0) return;

  let creditsAdded = false;

  // ── Pacotes de diárias ──────────────────────────────────────────────────
  for (const packageItem of packageItems) {
    let baseCredits: number | null = null;
    let maxPetsPerDay = 1;
    let expirationDays = 365;

    // 1. Prioridade: snapshot histórico (Fase 14)
    if (packageItem.creditsAmount && packageItem.creditsAmount > 0) {
      baseCredits = packageItem.creditsAmount * (packageItem.quantity || 1);
      maxPetsPerDay = packageItem.snapshotMaxPets ?? 1;
      expirationDays = packageItem.snapshotExpirationDays ?? 365;
    }
    // 2. Fallback: lookup por catalogueItemId (mais confiável que nome)
    else if (packageItem.catalogueItemId) {
      const [catItem] = await tx
        .select()
        .from(catalogueItemsTable)
        .where(eq(catalogueItemsTable.id, packageItem.catalogueItemId))
        .limit(1);
      if (catItem?.creditsAmount && catItem.creditsAmount > 0) {
        baseCredits = catItem.creditsAmount * (packageItem.quantity || 1);
        maxPetsPerDay = catItem.maxPetsPerDay ?? 1;
      }
    }
    // 3. Fallback legado: lookup por nome (deprecated — itens sem snapshot)
    else {
      const [catItem] = await tx
        .select()
        .from(catalogueItemsTable)
        .where(
          and(
            eq(catalogueItemsTable.crecheId, invoice.crecheId),
            eq(catalogueItemsTable.name, packageItem.description)
          )
        )
        .limit(1);
      if (catItem?.creditsAmount && catItem.creditsAmount > 0) {
        console.warn(
          `[releasePurchasedCredits] Item "${packageItem.description}" sem snapshot. ` +
          `Usando lookup legado por nome (invoice #${invoiceId}, item #${packageItem.id}).`
        );
        baseCredits = catItem.creditsAmount * (packageItem.quantity || 1);
        maxPetsPerDay = catItem.maxPetsPerDay ?? 1;
      }
    }

    if (!baseCredits || baseCredits <= 0) continue;

    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + expirationDays);

    await tx.insert(tutorCreditsTable).values({
      crecheId: invoice.crecheId,
      tutorId: invoice.tutorId,
      totalCredits: baseCredits,
      usedCredits: 0,
      maxPetsPerDay,
      expirationDate: expirationDate.toISOString().split("T")[0],
    });

    creditsAdded = true;
  }

  // ── Pacotes de serviços ─────────────────────────────────────────────────
  for (const serviceItem of serviceItems) {
    let resolvedCatalogueItemId: number | null = null;

    // 1. Prioridade: snapshot histórico
    if (serviceItem.catalogueItemId) {
      resolvedCatalogueItemId = serviceItem.catalogueItemId;
    }
    // 2. Fallback legado: lookup por nome
    else {
      const [catItem] = await tx
        .select()
        .from(catalogueItemsTable)
        .where(
          and(
            eq(catalogueItemsTable.crecheId, invoice.crecheId),
            eq(catalogueItemsTable.name, serviceItem.description),
            eq(catalogueItemsTable.type, "service")
          )
        )
        .limit(1);
      if (catItem) {
        console.warn(
          `[releasePurchasedCredits] ServiceItem "${serviceItem.description}" sem catalogueItemId. ` +
          `Usando lookup legado por nome (invoice #${invoiceId}, item #${serviceItem.id}).`
        );
        resolvedCatalogueItemId = catItem.id;
      }
    }

    if (!resolvedCatalogueItemId) continue;

    await tx.insert(tutorServiceCreditsTable).values({
      crecheId: invoice.crecheId,
      tutorId: invoice.tutorId,
      catalogueItemId: resolvedCatalogueItemId,
      totalCredits: serviceItem.quantity || 1,
    });
    creditsAdded = true;
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
// consumePackageCredits
//
// Fase 14: adicionada verificação de idempotência — se bookingCreditsTable já
// contém registros para este bookingId, retorna os totais sem reprocessar.
// Isso previne double-consume em caso de retry ou dupla confirmação.
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
  // ── Fase 14: Idempotência ────────────────────────────────────────────────
  const existing = await tx
    .select({
      id: bookingCreditsTable.id,
      creditsConsumed: bookingCreditsTable.creditsConsumed,
    })
    .from(bookingCreditsTable)
    .where(eq(bookingCreditsTable.bookingId, bookingId));

  if (existing.length > 0) {
    // Já foi processado — retornar totais existentes sem reprocessar
    const totalConsumedNormal = existing.filter((r: any) => r.creditsConsumed > 0).length;
    const totalPiggybacked = existing.filter((r: any) => r.creditsConsumed === 0).length;
    console.warn(
      `[consumePackageCredits] Booking #${bookingId} já tem ${existing.length} registros ` +
      `em bookingCreditsTable. Retornando sem reprocessar (idempotência).`
    );
    return { totalPiggybacked, totalConsumedNormal, daysToBill: 0 };
  }

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
// consumeServiceCreditsForBooking
//
// Fase 14:
// - Adicionada verificação de idempotência (bookingServiceCreditsTable)
// - Match por catalogueItemId em vez de normalização de string quando possível
// - Normalização de string mantida como fallback para compatibilidade
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

  // ── Fase 14: Idempotência ────────────────────────────────────────────────
  const existingSvc = await tx
    .select({ id: bookingServiceCreditsTable.id })
    .from(bookingServiceCreditsTable)
    .where(eq(bookingServiceCreditsTable.bookingId, bookingId))
    .limit(1);

  if (existingSvc.length > 0) {
    console.warn(
      `[consumeServiceCreditsForBooking] Booking #${bookingId} já tem registros ` +
      `em bookingServiceCreditsTable. Retornando sem reprocessar (idempotência).`
    );
    return daysToBill; // não reprocessar; retornar daysToBill original
  }

  // Busca créditos de serviço disponíveis para este tutor/creche
  const candidateCredits = await tx
    .select({
      id: tutorServiceCreditsTable.id,
      totalCredits: tutorServiceCreditsTable.totalCredits,
      usedCredits: tutorServiceCreditsTable.usedCredits,
      catalogueItemId: tutorServiceCreditsTable.catalogueItemId,
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

  // Fase 14: match prioritário por catalogueItemId (sem depender de string)
  let matchingCredits = candidateCredits.filter(
    (c: any) => c.catalogueItemId === catalogueItem.id
  );

  // Fallback: normalização de nome para variantes de tamanho (ex: Banho P/M/G)
  if (matchingCredits.length === 0) {
    const bookingServiceType = normalizeServiceType(catalogueItem.name);
    matchingCredits = candidateCredits.filter(
      (c: any) => normalizeServiceType(c.itemName) === bookingServiceType
    );
  }

  let remaining = daysToBill;

  for (const credit of matchingCredits) {
    if (remaining <= 0) break;

    const availableInCredit = credit.totalCredits - credit.usedCredits;
    const toConsume = Math.min(availableInCredit, remaining);

    await tx.update(tutorServiceCreditsTable)
      .set({ usedCredits: sql`${tutorServiceCreditsTable.usedCredits} + ${toConsume}` })
      .where(eq(tutorServiceCreditsTable.id, credit.id));

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
      details:
        `Consumo de ${toConsume} crédito(s) de serviço ` +
        `(catId=${credit.catalogueItemId}, "${credit.itemName}" → "${catalogueItem.name}").`,
    }, tx);
  }

  return remaining; // dias restantes a faturar
}

// ─────────────────────────────────────────────────────────────────────────────
// restoreBookingPackageCredits — GREATEST(0,...) + piggyback transfer
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
      const [child] = await tx
        .select()
        .from(bookingCreditsTable)
        .where(and(
          eq(bookingCreditsTable.tutorCreditId, c.tutorCreditId),
          eq(bookingCreditsTable.consumedDate, c.consumedDate),
          eq(bookingCreditsTable.creditsConsumed, 0),
          isNull(bookingCreditsTable.restoredAt),
          sql`${bookingCreditsTable.id} != ${c.id}`,
        ))
        .limit(1);

      if (child) {
        // Transferir o crédito para a reserva de carona
        await tx
          .update(bookingCreditsTable)
          .set({ creditsConsumed: c.creditsConsumed })
          .where(eq(bookingCreditsTable.id, child.id));
        shouldRestoreToTutor = false;
      }
    }

    if (shouldRestoreToTutor) {
      await tx.update(tutorCreditsTable)
        .set({
          usedCredits: sql`GREATEST(0, ${tutorCreditsTable.usedCredits} - ${c.creditsConsumed})`,
        })
        .where(eq(tutorCreditsTable.id, c.tutorCreditId));
    }

    await tx.update(bookingCreditsTable)
      .set({ restoredAt: new Date() })
      .where(eq(bookingCreditsTable.id, c.id));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// restoreBookingServiceCredits — GREATEST(0,...) anti-underflow
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
    await tx.update(tutorServiceCreditsTable)
      .set({
        usedCredits: sql`GREATEST(0, ${tutorServiceCreditsTable.usedCredits} - ${sc.creditsConsumed})`,
      })
      .where(eq(tutorServiceCreditsTable.id, sc.tutorServiceCreditId));

    await tx.update(bookingServiceCreditsTable)
      .set({ restoredAt: new Date() })
      .where(eq(bookingServiceCreditsTable.id, sc.id));
  }
}
