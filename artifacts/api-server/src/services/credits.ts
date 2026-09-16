import { getBusinessDate } from "../lib/date.js";
import { db } from "@workspace/db";
import { invoiceItemsTable, invoicesTable } from "@workspace/db/schema";
import { CreditRepository } from "../repositories/credit.repository.js";
import { InvoiceRepository } from "../repositories/invoice.repository.js";
import { CatalogueRepository } from "../repositories/catalogue.repository.js";
import { logFinancialAudit } from "./audit.js";
import { normalizeServiceType } from "../utils/service-name.js";
import { OutboxRepository } from "../repositories/outbox.repository.js";
import { type FinancialDomainEvent } from "./events.js";
import { financialLog } from "../lib/logger.js";
import { eq, and, count, inArray } from "drizzle-orm";

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
  const invoice = await InvoiceRepository.findByIdForUpdate(invoiceId, tx);
  if (!invoice) return;
  if (invoice.creditsReleased) return; // gate de idempotência

  const items = await InvoiceRepository.findItemsByInvoiceId(invoiceId, tx);

  // Fase 14: decisão baseada em itemType — sem regex
  const packageItems = items.filter(
    (item: any) => item.itemType === "package"
  );
  const serviceItems = items.filter(
    (item: any) => item.itemType === "service"
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
      const catItem = await CatalogueRepository.findById(packageItem.catalogueItemId, tx);
      if (catItem?.creditsAmount && catItem.creditsAmount > 0) {
        baseCredits = catItem.creditsAmount * (packageItem.quantity || 1);
        maxPetsPerDay = catItem.maxPetsPerDay ?? 1;
      }
    }
    // 3. Fallback legado: lookup por nome (deprecated — itens sem snapshot)
    else {
      const catItem = await CatalogueRepository.findByNameAndCreche(invoice.crecheId, packageItem.description, tx);
      if (catItem?.creditsAmount && catItem.creditsAmount > 0) {
        financialLog({
          operation: "credits_legacy_pkg_fallback",
          level: "warn",
          invoiceId,
          itemId: packageItem.id,
          itemDescription: packageItem.description,
          result: "legacy_name_lookup",
        });
        baseCredits = catItem.creditsAmount * (packageItem.quantity || 1);
        maxPetsPerDay = catItem.maxPetsPerDay ?? 1;
      }
    }

    if (!baseCredits || baseCredits <= 0) continue;

    const expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + expirationDays);

    await CreditRepository.createPackageCredits({
      crecheId: invoice.crecheId,
      tutorId: invoice.tutorId,
      totalCredits: baseCredits,
      usedCredits: 0,
      maxPetsPerDay,
      expirationDate: expirationDate.toISOString().split("T")[0],
    }, tx);

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
      const catItem2 = await CatalogueRepository.findServiceByNameAndCreche(invoice.crecheId, serviceItem.description, tx);
      if (catItem2) {
        financialLog({
          operation: "credits_legacy_svc_fallback",
          level: "warn",
          invoiceId,
          itemId: serviceItem.id,
          itemDescription: serviceItem.description,
          result: "legacy_name_lookup",
        });
        resolvedCatalogueItemId = catItem2.id;
      }
    }

    if (!resolvedCatalogueItemId) continue;

    await CreditRepository.createServiceCredits({
      crecheId: invoice.crecheId,
      tutorId: invoice.tutorId,
      catalogueItemId: resolvedCatalogueItemId,
      totalCredits: serviceItem.quantity || 1,
    }, tx);
    creditsAdded = true;
  }

  if (!creditsAdded) return;

  await InvoiceRepository.markCreditsReleased(invoiceId, tx);

  await logFinancialAudit({
    crecheId: invoice.crecheId,
    userId: paidByUserId,
    action: "credits_purchase",
    referenceId: invoiceId,
    referenceType: "invoices",
    details: `Créditos liberados para tutor #${invoice.tutorId} após pagamento da fatura #${invoiceId}.`,
  }, tx);

  await OutboxRepository.insert({
    type: "CreditsReleased",
    crecheId: invoice.crecheId,
    invoiceId,
    tutorId: invoice.tutorId as number,
    occurredAt: new Date().toISOString(),
  } as FinancialDomainEvent, tx);
}

// ─────────────────────────────────────────────────────────────────────────────
// consumePackageCredits
//
// Fase 14: adicionada verificação de idempotência — se bookingCreditsTable já
// contém registros para este bookingId, retorna os totais sem reprocessar.
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
  const existing = await CreditRepository.findBookingCredits(bookingId, tx);

  if (existing.length > 0) {
    const totalConsumedNormal = existing.filter((r: any) => r.creditsConsumed > 0).length;
    const totalPiggybacked = existing.filter((r: any) => r.creditsConsumed === 0).length;
    financialLog({
      operation: "credits_pkg_idempotent",
      level: "warn",
      bookingId,
      existingCount: existing.length,
      result: "skipped",
    });
    return { totalPiggybacked, totalConsumedNormal, daysToBill: 0 };
  }

  let totalPiggybacked = 0;
  let totalConsumedNormal = 0;
  let daysToBill = 0;

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];

    // 1. Tentar carona (piggyback) — pacotes multi-pet
    const piggybackCandidates = await CreditRepository.findPiggybackCandidates(
      tutorId, crecheId, dateStr, packageMaxPets, tx
    );

    let piggybackedCreditId: number | null = null;
    for (const cand of piggybackCandidates) {
      if (Number(cand.usedPetsCount) < cand.maxPets) {
        piggybackedCreditId = cand.creditId;
        break;
      }
    }

    if (piggybackedCreditId) {
      await CreditRepository.createBookingCredit({
        bookingId,
        tutorCreditId: piggybackedCreditId,
        creditsConsumed: 0,
        consumedDate: dateStr,
      }, tx);
      totalPiggybacked++;
      continue;
    }

    // 2. Consumo normal de crédito do pacote
    const todayStr = getBusinessDate();
    const creditPack = await CreditRepository.findOldestAvailablePackageCreditForUpdate(
      tutorId, crecheId, packageMaxPets, todayStr, tx
    );

    if (creditPack) {
      await CreditRepository.incrementUsedPackageCredits(creditPack.id, 1, tx);

      await CreditRepository.createBookingCredit({
        bookingId,
        tutorCreditId: creditPack.id,
        creditsConsumed: 1,
        consumedDate: dateStr,
      }, tx);
      totalConsumedNormal++;
    } else {
      // 3. Sem saldo — dia excedente a faturar
      daysToBill++;
    }
  }

  if (totalConsumedNormal > 0) {
    await OutboxRepository.insert({
      type: "CreditsConsumed",
      crecheId,
      bookingId,
      tutorId,
      creditsConsumed: totalConsumedNormal,
      occurredAt: new Date().toISOString(),
    } as FinancialDomainEvent, tx);
  }

  return { totalPiggybacked, totalConsumedNormal, daysToBill };
}

// ─────────────────────────────────────────────────────────────────────────────
// consumeServiceCreditsForBooking
//
// Fase 14:
// - Adicionada verificação de idempotência (bookingServiceCreditsTable)
// - Match por catalogueItemId em vez de normalização de string quando possível
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
  if (await CreditRepository.existsBookingServiceCredit(bookingId, tx)) {
    financialLog({
      operation: "credits_svc_idempotent",
      level: "warn",
      bookingId,
      result: "skipped",
    });
    return daysToBill;
  }

  const candidateCredits = await CreditRepository.findAvailableServiceCreditsForUpdate(
    tutorId, crecheId, tx
  );

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

    await CreditRepository.incrementUsedServiceCredits(credit.id, toConsume, tx);

    await CreditRepository.createBookingServiceCredit({
      bookingId,
      tutorServiceCreditId: credit.id,
      creditsConsumed: toConsume,
    }, tx);

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

  const serviceCreditsConsumed = daysToBill - remaining;
  if (serviceCreditsConsumed > 0) {
    await OutboxRepository.insert({
      type: "CreditsConsumed",
      crecheId,
      bookingId,
      tutorId,
      creditsConsumed: serviceCreditsConsumed,
      occurredAt: new Date().toISOString(),
    } as FinancialDomainEvent, tx);
  }

  return remaining; // dias restantes a faturar
}

// ─────────────────────────────────────────────────────────────────────────────
// consumeAdditionalServices
//
// For each pending add-on in booking_services:
//   1. Try to consume a service credit (by catalogueItemId, exact match first).
//   2. If no credit available, charge via BillingService.addCharge.
//   3. Mark the add-on as confirmed + consumedCredit/charged accordingly.
//
// Returns the list of bookingServiceIds that were charged (for audit).
// ─────────────────────────────────────────────────────────────────────────────

export async function consumeAdditionalServices(
  bookingId: number,
  tutorId: number,
  crecheId: number,
  petId: number,
  userId: number,
  tx: any
): Promise<{ creditedIds: number[]; chargedIds: number[] }> {
  const { BookingServicesRepository } = await import("../repositories/booking-services.repository.js");
  const { BillingService } = await import("./billing.js");

  const addons = await BookingServicesRepository.findPendingForUpdate(bookingId, tx);

  const creditedIds: number[] = [];
  const chargedIds: number[] = [];

  for (const addon of addons) {
    // Try exact service-credit match by catalogueItemId
    const candidateCredits = await CreditRepository.findAvailableServiceCreditsForUpdate(
      tutorId, crecheId, tx
    );

    const exactMatch = candidateCredits.find(
      (c: any) => c.catalogueItemId === addon.catalogueItemId
    );

    if (exactMatch) {
      // Consume 1 credit per add-on (quantity=1 always for services)
      await CreditRepository.incrementUsedServiceCredits(exactMatch.id, addon.quantity, tx);
      // Save the exact credit row ID so restore can target the precise row
      await BookingServicesRepository.markConsumedCredit(addon.id, exactMatch.id, tx);

      await OutboxRepository.insert({
        type: "AdditionalServiceCreditConsumed",
        crecheId,
        bookingId,
        tutorId,
        bookingServiceId: addon.id,
        catalogueItemId: addon.catalogueItemId,
        occurredAt: new Date().toISOString(),
      } as FinancialDomainEvent, tx);

      creditedIds.push(addon.id);

      // Pre-paid credit precedence: release campaign reservation if one was reserved
      const { CrecheCampaignReservationService } = await import(
        "./crecheCampaignReservation.service.js"
      );
      await CrecheCampaignReservationService.applyBookingLineCampaign(tx, {
        crecheId,
        tutorId,
        bookingId,
        lineType: "BOOKING_SERVICE",
        catalogueItemId: addon.catalogueItemId,
        bookingServiceId: addon.id,
        actualBillableQuantity: 0,
        petId,
        description: addon.itemName ?? `Serviço adicional #${addon.catalogueItemId}`,
      });
    } else {
      // No service credit — check for reserved promotional campaign
      const { CrecheCampaignReservationService } = await import(
        "./crecheCampaignReservation.service.js"
      );
      const campaignResult = await CrecheCampaignReservationService.applyBookingLineCampaign(tx, {
        crecheId,
        tutorId,
        bookingId,
        lineType: "BOOKING_SERVICE",
        catalogueItemId: addon.catalogueItemId,
        bookingServiceId: addon.id,
        actualBillableQuantity: addon.quantity,
        petId,
        description: addon.itemName ?? `Serviço adicional #${addon.catalogueItemId}`,
      });

      if (campaignResult.hasCampaign) {
        if (campaignResult.applied) {
          if (campaignResult.mode === "COMPLIMENTARY_ZERO_VALUE") {
            // Complimentary zero-value promo add-on
            await BookingServicesRepository.markConfirmed(addon.id, tx);
            creditedIds.push(addon.id);
          } else {
            // Monetary promo add-on faturado
            await BookingServicesRepository.markCharged(addon.id, campaignResult.invoiceItemId!, tx);
            await OutboxRepository.insert({
              type: "AdditionalServiceCharged",
              crecheId,
              bookingId,
              tutorId,
              bookingServiceId: addon.id,
              catalogueItemId: addon.catalogueItemId,
              amount: campaignResult.finalAmountCents / 100,
              occurredAt: new Date().toISOString(),
            } as FinancialDomainEvent, tx);
            chargedIds.push(addon.id);
          }
        } else {
          // Line released
          await BookingServicesRepository.markConfirmed(addon.id, tx);
          creditedIds.push(addon.id);
        }
      } else {
        // No campaign reserved — charge via BillingService with captured price
        const price = Number(addon.capturedPrice ?? 0);
        if (price > 0) {
          // addCharge now returns { invoiceId, invoiceItemId } — use the item ID directly
          const { invoiceItemId: resolvedInvoiceItemId } = await BillingService.addCharge({
            crecheId,
            tutorId,
            amount: price,
            quantity: addon.quantity,
            description: addon.itemName ?? `Serviço adicional #${addon.catalogueItemId}`,
            type: "service",
            petId,
            bookingId,
            catalogueItemId: addon.catalogueItemId,
            itemDate: new Date(),
            tx,
          });

          await BookingServicesRepository.markCharged(addon.id, resolvedInvoiceItemId, tx);

          await OutboxRepository.insert({
            type: "AdditionalServiceCharged",
            crecheId,
            bookingId,
            tutorId,
            bookingServiceId: addon.id,
            catalogueItemId: addon.catalogueItemId,
            amount: price,
            occurredAt: new Date().toISOString(),
          } as FinancialDomainEvent, tx);

          chargedIds.push(addon.id);
        } else {
          // Zero-price add-on (e.g. a free service) — just confirm it
          await BookingServicesRepository.markConfirmed(addon.id, tx);
          creditedIds.push(addon.id);
        }
      }
    }
  }

  if (addons.length > 0) {
    await OutboxRepository.insert({
      type: "AdditionalServicesConfirmed",
      crecheId,
      bookingId,
      tutorId,
      count: addons.length,
      occurredAt: new Date().toISOString(),
    } as FinancialDomainEvent, tx);
  }

  return { creditedIds, chargedIds };
}

// ─────────────────────────────────────────────────────────────────────────────
// restoreAdditionalServices
//
// Called during booking cancellation.
// - For add-ons with consumedCredit=true: restore the service credit
//   (GREATEST(0,...) anti-underflow via CreditRepository).
// - For add-ons with charged=true: void the linked invoice item via SQL
//   (the parent invoice re-calculates at next payment attempt).
// - Marks all confirmed add-ons as cancelled.
// ─────────────────────────────────────────────────────────────────────────────

export async function restoreAdditionalServices(
  bookingId: number,
  tutorId: number,
  crecheId: number,
  tx: any
): Promise<void> {
  const { BookingServicesRepository } = await import("../repositories/booking-services.repository.js");

  // Restore credited add-ons — use the persisted tutorServiceCreditId for exact targeting
  const credited = await BookingServicesRepository.findConfirmedWithCredit(bookingId, tx);
  for (const addon of credited) {
    if (addon.tutorServiceCreditId) {
      // Exact-row restore: guaranteed to hit the row that was incremented at confirmation
      await CreditRepository.decrementUsedServiceCredits(
        addon.tutorServiceCreditId, addon.quantity, tx
      );
    }

    await BookingServicesRepository.markCancelled(addon.id, tx);

    await OutboxRepository.insert({
      type: "AdditionalServiceCreditRestored",
      crecheId,
      bookingId,
      bookingServiceId: addon.id,
      catalogueItemId: addon.catalogueItemId,
      occurredAt: new Date().toISOString(),
    } as FinancialDomainEvent, tx);
  }

  // Reverse charged add-ons: group by invoice first to avoid prematurely voiding
  // a shared cycle invoice mid-loop when two or more add-ons share the same invoice.
  const charged = await BookingServicesRepository.findConfirmedCharged(bookingId, tx);

  // Step 1: collect all invoice item IDs that need reversal
  type ChargedAddonWithItem = {
    addon: (typeof charged)[number];
    item: { id: number; invoiceId: number; amount: string; quantity: number | null } | null;
  };
  const chargedWithItems: ChargedAddonWithItem[] = await Promise.all(
    charged.map(async (addon: (typeof charged)[number]) => {
      if (!addon.invoiceItemId) return { addon, item: null };
      const [item] = await tx
        .select({
          id: invoiceItemsTable.id,
          invoiceId: invoiceItemsTable.invoiceId,
          amount: invoiceItemsTable.amount,
          quantity: invoiceItemsTable.quantity,
        })
        .from(invoiceItemsTable)
        .where(eq(invoiceItemsTable.id, addon.invoiceItemId))
        .limit(1);
      return { addon, item: item ?? null };
    })
  );

  // Step 2: group by invoiceId
  const byInvoice = new Map<number, ChargedAddonWithItem[]>();
  for (const cai of chargedWithItems) {
    if (!cai.item) continue;
    const invId = cai.item.invoiceId;
    if (!byInvoice.has(invId)) byInvoice.set(invId, []);
    byInvoice.get(invId)!.push(cai);
  }

  // Step 3: per-invoice batch reversal — one void-or-adjust decision per invoice
  for (const [invoiceId, invoiceAddons] of byInvoice) {
    const [invoice] = await tx
      .select({
        id: invoicesTable.id,
        amount: invoicesTable.amount,
        status: invoicesTable.status,
        dueDate: invoicesTable.dueDate,
      })
      .from(invoicesTable)
      .where(eq(invoicesTable.id, invoiceId))
      .limit(1);

    const isMutable =
      invoice &&
      invoice.status === "pending" &&
      invoice.dueDate >= getBusinessDate();
    if (!isMutable) {
      // Paid/refunded/voided invoices: preserve items as financial history
      continue;
    }

    // Compute total to subtract for all add-ons on this invoice
    let amountToRemove = 0;
    const itemIdsToDelete: number[] = [];
    for (const { item } of invoiceAddons) {
      if (!item) continue;
      amountToRemove += parseFloat(item.amount) * (item.quantity ?? 1);
      itemIdsToDelete.push(item.id);
    }

    // Delete all add-on items for this invoice in one pass
    if (itemIdsToDelete.length > 0) {
      await tx.delete(invoiceItemsTable).where(inArray(invoiceItemsTable.id, itemIdsToDelete));
    }

    // Count remaining items after batch deletion
    const [{ remaining }] = await tx
      .select({ remaining: count(invoiceItemsTable.id) })
      .from(invoiceItemsTable)
      .where(eq(invoiceItemsTable.invoiceId, invoiceId));

    if (Number(remaining) === 0) {
      // Invoice is now empty — void it
      await InvoiceRepository.setAmount(invoiceId, "0.00", tx);
      await InvoiceRepository.markVoided(invoiceId, tx);
    } else {
      // Shared invoice still has other line items — only reduce the total
      const newTotal = Math.max(0, parseFloat(invoice.amount) - amountToRemove);
      await InvoiceRepository.setAmount(invoiceId, newTotal.toFixed(2), tx);
    }
  }

  // Step 4: mark all add-on records cancelled and emit outbox events
  for (const { addon } of chargedWithItems) {
    await BookingServicesRepository.markCancelled(addon.id, tx);

    await OutboxRepository.insert({
      type: "AdditionalServicesCancelled",
      crecheId,
      bookingId,
      bookingServiceId: addon.id,
      catalogueItemId: addon.catalogueItemId,
      occurredAt: new Date().toISOString(),
    } as FinancialDomainEvent, tx);
  }

  // Also cancel any still-pending add-ons (booking cancelled before confirmation)
  await BookingServicesRepository.markAllCancelledForBooking(bookingId, tx);

  if (credited.length > 0 || charged.length > 0) {
    await OutboxRepository.insert({
      type: "AdditionalServicesCancelled",
      crecheId,
      bookingId,
      occurredAt: new Date().toISOString(),
    } as FinancialDomainEvent, tx);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// restoreBookingPackageCredits — GREATEST(0,...) + piggyback transfer
// ─────────────────────────────────────────────────────────────────────────────

export async function restoreBookingPackageCredits(
  bookingId: number,
  tx: any,
  crecheId = 0
): Promise<void> {
  const consumed = await CreditRepository.findActiveBookingCredits(bookingId, tx);

  for (const credit of consumed) {
    let shouldRestoreToTutor = true;

    if (credit.creditsConsumed > 0 && credit.consumedDate) {
      // Verificar se existe reserva de carona dependente deste crédito
      const child = await CreditRepository.findPiggybackChild(
        credit.tutorCreditId,
        credit.consumedDate,
        credit.id,
        tx
      );

      if (child) {
        // Transferir o crédito para a reserva de carona
        await CreditRepository.updateBookingCreditConsumed(child.id, credit.creditsConsumed, tx);
        shouldRestoreToTutor = false;
      }
    }

    if (shouldRestoreToTutor) {
      await CreditRepository.decrementUsedPackageCredits(credit.tutorCreditId, credit.creditsConsumed, tx);
    }

    await CreditRepository.markBookingCreditRestored(credit.id, tx);
  }

  if (consumed.length > 0) {
    await OutboxRepository.insert({
      type: "CreditsRestored",
      crecheId,
      bookingId,
      occurredAt: new Date().toISOString(),
    } as FinancialDomainEvent, tx);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// restoreBookingServiceCredits — GREATEST(0,...) anti-underflow
// ─────────────────────────────────────────────────────────────────────────────

export async function restoreBookingServiceCredits(
  bookingId: number,
  tx: any,
  crecheId = 0
): Promise<void> {
  const consumed = await CreditRepository.findActiveBookingServiceCredits(bookingId, tx);

  for (const sc of consumed) {
    await CreditRepository.decrementUsedServiceCredits(sc.tutorServiceCreditId, sc.creditsConsumed, tx);
    await CreditRepository.markBookingServiceCreditRestored(sc.id, tx);
  }

  if (consumed.length > 0) {
    await OutboxRepository.insert({
      type: "CreditsRestored",
      crecheId,
      bookingId,
      occurredAt: new Date().toISOString(),
    } as FinancialDomainEvent, tx);
  }
}

