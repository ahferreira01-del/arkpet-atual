import { db } from "@workspace/db";
import { InvoiceRepository } from "../repositories/invoice.repository.js";
import { TransactionRepository } from "../repositories/transaction.repository.js";
import { OrderRepository } from "../repositories/order.repository.js";
import { CatalogueRepository } from "../repositories/catalogue.repository.js";
import { getTutorMensalidadeDia } from "../repositories/shared.js";
import { releasePurchasedCredits } from "./credits.js";
import { logFinancialAudit } from "./audit.js";
import { OutboxRepository } from "../repositories/outbox.repository.js";
import { type FinancialDomainEvent } from "./events.js";
import { financialLog } from "../lib/logger.js";
import { getBusinessDate } from "../lib/date.js";
import { ordersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// Máquina de Estados da Invoice (Fase 14)
// Única fonte de verdade para transições válidas de status.
// ─────────────────────────────────────────────────────────────────────────────

export class InvoiceStateMachine {
  private static readonly VALID_TRANSITIONS: Record<string, readonly string[]> = {
    pending:               ["paid", "voided", "overdue"],
    overdue:               ["paid", "voided"],
    awaiting_confirmation: ["paid", "voided"],
    paid:                  ["refunded"],
    voided:                [],
    refunded:              [],
  } as const;

  static canTransition(from: string, to: string): boolean {
    return (this.VALID_TRANSITIONS[from] ?? []).includes(to);
  }

  static assertTransition(from: string, to: string): void {
    if (!this.canTransition(from, to)) {
      const allowed = (this.VALID_TRANSITIONS[from] ?? []).join(", ") || "nenhuma";
      throw new Error(
        `Transição de status inválida para Invoice: "${from}" → "${to}". ` +
        `Transições permitidas de "${from}": [${allowed}]`
      );
    }
  }

  /** Verifica se o status é terminal (não aceita mais alterações financeiras). */
  static isTerminal(status: string): boolean {
    return (this.VALID_TRANSITIONS[status]?.length ?? Infinity) === 0;
  }

  /** Verifica se o status é "fechado" para novos lançamentos no mesmo ciclo. */
  static isClosed(status: string): boolean {
    return [
      "awaiting_confirmation",
      "paid",
      "overdue",
      "voided",
      "refunded",
    ].includes(status);
  }

  /** Status nos quais um webhook de pagamento já não deve registrar novo pagamento. */
  static isAlreadyProcessedForPayment(status: string): boolean {
    return status === "paid" || status === "refunded" || status === "voided";
  }
}

/**
 * Reads an invoice only to discover its tutor, acquires the tutor-scoped
 * transaction lock, then re-reads the authoritative row with FOR UPDATE.
 * The initial read never authorizes a write.
 */
async function lockInvoiceForMutation(
  invoiceId: number,
  crecheId: number,
  tx: any
) {
  const snapshot = await InvoiceRepository.findByIdAndCreche(invoiceId, crecheId, tx);
  if (!snapshot) return null;

  await BillingService.acquireTutorFinancialLock(crecheId, snapshot.tutorId, tx);

  // Order status transitions already lock order → invoice. Financial mutations
  // must use the same row-lock order after the tutor advisory lock.
  await tx
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .where(eq(ordersTable.invoiceId, invoiceId))
    .orderBy(ordersTable.id)
    .for("update");

  return InvoiceRepository.findByIdAndCrecheForUpdate(invoiceId, crecheId, tx);
}

// ─────────────────────────────────────────────────────────────────────────────
// calculateDueDate
// ─────────────────────────────────────────────────────────────────────────────

export function calculateDueDate(
  tutorMensalidadeDia: number | null | undefined,
  fallbackDate: Date = new Date()
): string {
  if (!tutorMensalidadeDia) {
    const fallback = new Date(fallbackDate);
    fallback.setUTCDate(fallback.getUTCDate() + 3);
    return fallback.toISOString().split("T")[0];
  }

  const today = new Date();
  let dueMonth = today.getUTCMonth();
  let dueYear = today.getUTCFullYear();

  if (today.getUTCDate() > tutorMensalidadeDia) {
    dueMonth += 1;
    if (dueMonth > 11) {
      dueMonth = 0;
      dueYear += 1;
    }
  }

  const lastDayOfMonth = new Date(Date.UTC(dueYear, dueMonth + 1, 0)).getUTCDate();
  const actualDay = Math.min(tutorMensalidadeDia, lastDayOfMonth);
  const finalDueDate = new Date(Date.UTC(dueYear, dueMonth, actualDay));
  return finalDueDate.toISOString().split("T")[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// hasOverdueInvoices
// ─────────────────────────────────────────────────────────────────────────────

export async function hasOverdueInvoices(tutorId: number, crecheId: number): Promise<boolean> {
  return InvoiceRepository.hasOverdue(tutorId, crecheId);
}

// ─────────────────────────────────────────────────────────────────────────────
// processManualPayment — FOR UPDATE + state machine + audit
// ─────────────────────────────────────────────────────────────────────────────

export async function processManualPayment(
  invoiceId: number,
  crecheId: number,
  userId: number,
  paymentMethod: "stripe" | "pix" | "cash" | "credit_card" | "bank_slip"
) {
  return await db.transaction(async (tx) => {
    const invoice = await lockInvoiceForMutation(invoiceId, crecheId, tx);
    if (!invoice) throw new Error("Fatura não encontrada");
    InvoiceStateMachine.assertTransition(invoice.status, "paid");

    await InvoiceRepository.markPaid(invoiceId, paymentMethod, tx);

    await TransactionRepository.create({
      crecheId: invoice.crecheId,
      invoiceId: invoice.id,
      type: "income",
      amount: invoice.amount,
      transactionDate: getBusinessDate(),
      paymentMethod,
      description: `Pagamento da Fatura #${invoice.id}`,
    }, tx);

    await logFinancialAudit({
      crecheId: invoice.crecheId,
      userId,
      action: "manual_payment_register",
      referenceId: invoice.id,
      referenceType: "invoices",
      details: `Fatura #${invoice.id} paga via ${paymentMethod} e conciliada.`,
    }, tx);

    await releasePurchasedCredits(invoice.id, userId, tx);

    const paidOrdersManual = await OrderRepository.markPaidByInvoice(invoiceId, tx);
    for (const o of paidOrdersManual) {
      await OutboxRepository.insert({
        type: "OrderPaid",
        crecheId: invoice.crecheId,
        invoiceId: invoiceId,
        occurredAt: new Date().toISOString(),
      } as FinancialDomainEvent, tx);
    }

    await OutboxRepository.insert({
      type: "InvoicePaid",
      crecheId: invoice.crecheId,
      invoiceId: invoice.id,
      tutorId: invoice.tutorId,
      amount: invoice.amount,
      paymentMethod,
      occurredAt: new Date().toISOString(),
    } as FinancialDomainEvent, tx);

    return invoice;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// approveReceipt — FOR UPDATE + state machine + audit
// ─────────────────────────────────────────────────────────────────────────────

export async function approveReceipt(invoiceId: number, crecheId: number, userId: number) {
  return await db.transaction(async (tx) => {
    const invoice = await lockInvoiceForMutation(invoiceId, crecheId, tx);
    if (!invoice) throw new Error("Fatura não encontrada");
    InvoiceStateMachine.assertTransition(invoice.status, "paid");

    await InvoiceRepository.markPaid(invoiceId, invoice.paymentMethod || "pix", tx);

    await TransactionRepository.create({
      crecheId: invoice.crecheId,
      invoiceId: invoice.id,
      type: "income",
      amount: invoice.amount,
      transactionDate: getBusinessDate(),
      paymentMethod: invoice.paymentMethod || "pix",
      description: `Comprovante aprovado da Fatura #${invoice.id}`,
    }, tx);

    await logFinancialAudit({
      crecheId: invoice.crecheId,
      userId,
      action: "payment_approve",
      referenceId: invoice.id,
      referenceType: "invoices",
      details: `Comprovante da Fatura #${invoice.id} aprovado.`,
    }, tx);

    await releasePurchasedCredits(invoice.id, userId, tx);

    const paidOrdersReceipt = await OrderRepository.markPaidByInvoice(invoiceId, tx);
    for (const o of paidOrdersReceipt) {
      await OutboxRepository.insert({
        type: "OrderPaid",
        crecheId: invoice.crecheId,
        invoiceId: invoiceId,
        occurredAt: new Date().toISOString(),
      } as FinancialDomainEvent, tx);
    }

    await OutboxRepository.insert({
      type: "InvoicePaid",
      crecheId: invoice.crecheId,
      invoiceId: invoice.id,
      tutorId: invoice.tutorId,
      amount: invoice.amount,
      paymentMethod: invoice.paymentMethod || "pix",
      occurredAt: new Date().toISOString(),
    } as FinancialDomainEvent, tx);

    return invoice;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// voidInvoice — FOR UPDATE + state machine + audit
// ─────────────────────────────────────────────────────────────────────────────

export async function voidInvoice(invoiceId: number, crecheId: number, userId: number) {
  return await db.transaction(async (tx) => {
    const invoice = await lockInvoiceForMutation(invoiceId, crecheId, tx);
    if (!invoice) throw new Error("Fatura não encontrada");
    InvoiceStateMachine.assertTransition(invoice.status, "voided");

    await InvoiceRepository.markVoided(invoiceId, tx);
    await OrderRepository.cancelPendingByInvoice(invoiceId, tx);

    await logFinancialAudit({
      crecheId,
      userId,
      action: "invoice_void",
      referenceId: invoice.id,
      referenceType: "invoices",
      details: `Fatura #${invoice.id} cancelada (${invoice.status} → voided).`,
    }, tx);

    await OutboxRepository.insert({
      type: "InvoiceVoided",
      crecheId,
      invoiceId: invoice.id,
      tutorId: invoice.tutorId,
      occurredAt: new Date().toISOString(),
    } as FinancialDomainEvent, tx);

    return invoice;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// refundInvoice — FOR UPDATE + state machine + audit
// ─────────────────────────────────────────────────────────────────────────────

export async function refundInvoice(invoiceId: number, crecheId: number, userId: number) {
  return await db.transaction(async (tx) => {
    const invoice = await lockInvoiceForMutation(invoiceId, crecheId, tx);
    if (!invoice) throw new Error("Fatura não encontrada");
    InvoiceStateMachine.assertTransition(invoice.status, "refunded");

    await InvoiceRepository.markRefunded(invoiceId, tx);

    await TransactionRepository.create({
      crecheId: invoice.crecheId,
      invoiceId: invoice.id,
      type: "expense",
      amount: invoice.amount,
      transactionDate: getBusinessDate(),
      paymentMethod: invoice.paymentMethod || "pix",
      description: `Estorno da Fatura #${invoice.id}`,
    }, tx);

    await OrderRepository.cancelAllByInvoice(invoiceId, tx);

    await logFinancialAudit({
      crecheId,
      userId,
      action: "invoice_refund",
      referenceId: invoice.id,
      referenceType: "invoices",
      details: `Fatura #${invoice.id} estornada.`,
    }, tx);

    await OutboxRepository.insert({
      type: "InvoiceRefunded",
      crecheId,
      invoiceId: invoice.id,
      tutorId: invoice.tutorId,
      amount: invoice.amount,
      occurredAt: new Date().toISOString(),
    } as FinancialDomainEvent, tx);

    return invoice;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// BillingService — única autoridade de criação de invoices e charges
// ─────────────────────────────────────────────────────────────────────────────

export class BillingService {
  /**
   * Serializa mutações financeiras do mesmo tutor dentro da transação atual.
   * IDs são serial/inteiros, portanto formam uma chave advisory de dois int4.
   */
  static async acquireTutorFinancialLock(
    crecheId: number,
    tutorId: number | null | undefined,
    tx: any
  ): Promise<void> {
    if (tutorId == null) return;
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${crecheId}, ${tutorId})`);
  }

  /**
   * Calcula os limites exatos de um ciclo de faturamento baseado no dia de
   * mensalidade do tutor.
   */
  static getCycleDates(
    mensalidadeDia: number | null | undefined,
    txDateStr: string = getBusinessDate()
  ) {
    const txDate = new Date(txDateStr + "T12:00:00Z");
    const day = mensalidadeDia || 10;

    let endMonth = txDate.getUTCMonth();
    let endYear = txDate.getUTCFullYear();

    if (txDate.getUTCDate() > day) {
      endMonth++;
      if (endMonth > 11) {
        endMonth = 0;
        endYear++;
      }
    }

    const lastDayOfMonth = new Date(Date.UTC(endYear, endMonth + 1, 0)).getUTCDate();
    const actualDay = Math.min(day, lastDayOfMonth);
    const endDate = new Date(Date.UTC(endYear, endMonth, actualDay));

    let startMonth = endMonth - 1;
    let startYear = endYear;
    if (startMonth < 0) {
      startMonth = 11;
      startYear--;
    }
    const lastDayOfStartMonth = new Date(Date.UTC(startYear, startMonth + 1, 0)).getUTCDate();
    const actualStartDay = Math.min(day, lastDayOfStartMonth);
    const startDate = new Date(Date.UTC(startYear, startMonth, actualStartDay + 1));

    return {
      cycleStart: startDate.toISOString().split("T")[0],
      cycleEnd: endDate.toISOString().split("T")[0],
      dueDate: endDate.toISOString().split("T")[0],
    };
  }

  private static isEditableCollector(
    invoice: { status: string; dueDate: string },
    businessDate: string
  ): boolean {
    return invoice.status === "pending" && invoice.dueDate >= businessDate;
  }

  private static nextCycleReference(cycleEnd: string): string {
    const nextDay = new Date(`${cycleEnd}T12:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    return nextDay.toISOString().split("T")[0];
  }

  /**
   * Resolves the one editable collector for creche + tutor + effective period.
   * Frozen or expired cycles are skipped until the next applicable period.
   */
  private static async resolveCollector(params: {
    crecheId: number;
    tutorId: number;
    mensalidadeDia: number | null | undefined;
    itemDateStr: string;
    businessDate: string;
    amount?: string;
    createIfMissing: boolean;
    tx: any;
  }) {
    let referenceDate = params.itemDateStr;

    for (let attempt = 0; attempt < 120; attempt++) {
      const cycle = this.getCycleDates(params.mensalidadeDia, referenceDate);
      const existing = await InvoiceRepository.findByCycleForUpdate(
        params.tutorId,
        cycle.cycleStart,
        cycle.cycleEnd,
        params.tx
      );

      if (existing && existing.crecheId !== params.crecheId) {
        throw Object.assign(
          new Error("Coletor do tutor pertence a outra creche."),
          { status: 422 }
        );
      }

      if (existing && this.isEditableCollector(existing, params.businessDate)) {
        return { invoice: existing, created: false };
      }

      if (!existing && cycle.dueDate >= params.businessDate) {
        if (!params.createIfMissing) return null;
        const invoice = await InvoiceRepository.create({
          crecheId: params.crecheId,
          tutorId: params.tutorId,
          cycleStart: cycle.cycleStart,
          cycleEnd: cycle.cycleEnd,
          dueDate: cycle.dueDate,
          amount: params.amount ?? "0.00",
          status: "pending",
        }, params.tx);
        return { invoice, created: true };
      }

      referenceDate = this.nextCycleReference(cycle.cycleEnd);
    }

    throw Object.assign(
      new Error("Não foi possível resolver um período editável para a cobrança."),
      { status: 422 }
    );
  }

  /**
   * Adiciona uma cobrança ao tutor.
   *
   * Regras:
   * - Cobranças avulsas (`isAvulso: true`) criam invoice própria, nunca reabrem a mensal.
   * - Cobranças mensais fazem merge somente em invoice `pending` cujo vencimento
   *   ainda não passou. Períodos congelados avançam para um ciclo sucessor normal.
   * - `existingInvoiceId` é apenas uma sugestão validada: tenant, tutor, período,
   *   status e vencimento precisam continuar válidos sob lock.
   * - Salva snapshot histórico no `invoiceItemsTable` para permitir reconstituição sem
   *   consultar o Catalogue.
   *
   * @returns ID do invoice ao qual o item foi adicionado.
   */
  static async addCharge(params: {
    crecheId: number;
    tutorId: number | null;
    amount: number | string;
    description: string;
    type?: string;
    petId?: number;
    bookingId?: number;
    orderId?: number;
    itemDate?: Date;
    quantity?: number;
    isAvulso?: boolean;
    existingInvoiceId?: number;
    tx?: any;
    userId?: number;              // Para audit log (0 = sistema)
    // ─── Fase 14: snapshot histórico ───────────────────────────────────────
    catalogueItemId?: number;     // FK para catalogueItemsTable
    creditsAmount?: number;       // Qtd de créditos que este item concede
    snapshotMaxPets?: number;     // maxPetsPerDay do pacote
    snapshotExpiration?: number;  // Dias até expirar (padrão 365)
  }) {
    const amountVal =
      typeof params.amount === "string" ? parseFloat(params.amount) : params.amount;

    // Guard: never create a zero or NaN invoice item — this would silently corrupt
    // the tutor's invoice total and generate meaningless R$0,00 charges.
    if (!Number.isFinite(amountVal) || amountVal <= 0) {
      throw Object.assign(
        new Error(
          `[BillingService.addCharge] Valor inválido (${params.amount}) para "${params.description}". ` +
          `Verifique se o item do catálogo tem preço maior que zero.`
        ),
        { status: 422 }
      );
    }

    const quantity = params.quantity || 1;
    const totalItemAmount = amountVal * quantity;
    const itemDateStr = params.itemDate 
      ? params.itemDate.toISOString().split("T")[0]
      : getBusinessDate();
    const businessDate = getBusinessDate();

    const executeLogic = async (txClient: any) => {
      let invoiceId: number;
      let hintedInvoice:
        | Awaited<ReturnType<typeof InvoiceRepository.findById>>
        | null = null;

      // Preflight is identity-only and deliberately non-locking. It prevents an
      // invalid cross-tutor hint from making us lock rows under the wrong tutor key.
      if (params.existingInvoiceId) {
        hintedInvoice = await InvoiceRepository.findById(params.existingInvoiceId, txClient);
        if (
          !hintedInvoice ||
          hintedInvoice.crecheId !== params.crecheId ||
          hintedInvoice.tutorId !== (params.tutorId ?? null)
        ) {
          throw Object.assign(
            new Error("Fatura informada não pertence à creche e ao tutor da cobrança."),
            { status: 422 }
          );
        }
      }

      const hintedStandalone =
        hintedInvoice?.cycleStart == null && hintedInvoice?.cycleEnd == null;
      const needsTutorLock =
        params.tutorId != null &&
        (params.existingInvoiceId ? !hintedStandalone : !params.isAvulso);
      if (needsTutorLock) {
        await this.acquireTutorFinancialLock(params.crecheId, params.tutorId, txClient);
      }

      if (params.existingInvoiceId) {
        // ── Append to an already-created invoice after full validation ───
        const existing = await InvoiceRepository.findByIdForUpdate(
          params.existingInvoiceId,
          txClient
        );

        if (
          !existing ||
          existing.crecheId !== params.crecheId ||
          existing.tutorId !== (params.tutorId ?? null)
        ) {
          throw Object.assign(
            new Error("Fatura informada deixou de ser válida para esta cobrança."),
            { status: 422 }
          );
        }

        if (!this.isEditableCollector(existing, businessDate)) {
          throw Object.assign(
            new Error("Fatura informada está congelada ou com vencimento expirado."),
            { status: 422 }
          );
        }

        const isStandalone = existing.cycleStart == null && existing.cycleEnd == null;
        if (!isStandalone && params.tutorId != null) {
          const mensalidadeDia = await getTutorMensalidadeDia(params.tutorId, txClient);
          const authoritative = await this.resolveCollector({
            crecheId: params.crecheId,
            tutorId: params.tutorId,
            mensalidadeDia,
            itemDateStr,
            businessDate,
            createIfMissing: false,
            tx: txClient,
          });

          if (!authoritative || authoritative.invoice.id !== existing.id) {
            throw Object.assign(
              new Error("Fatura informada não é o coletor editável do período da cobrança."),
              { status: 422 }
            );
          }
        } else if (!isStandalone) {
          throw Object.assign(
            new Error("Fatura avulsa informada possui período incompatível."),
            { status: 422 }
          );
        }

        const newTotal = (parseFloat(existing.amount) + totalItemAmount).toFixed(2);
        await InvoiceRepository.setAmount(params.existingInvoiceId, newTotal, txClient);
        invoiceId = params.existingInvoiceId;

      } else if (params.isAvulso || params.tutorId == null) {
        // ── Avulso: invoice standalone, nunca reabrir mensal.
        // cycleStart/cycleEnd are intentionally left NULL for ALL avulso invoices
        // (both anonymous and named). Avulso invoices are standalone — they don't
        // belong to a billing cycle. Keeping them NULL also ensures the
        // tutor_cycle_unique_idx (which fires only when all three cols are NOT NULL)
        // never blocks a second purchase from the same tutor on the same day.
        //
        // F2: dueDate = next billing-cycle due date for the tutor (reuses the
        // existing mensalidadeDia + getCycleDates logic). Anonymous charges
        // (tutorId == null) keep dueDate = today since there is no billing cycle.
        let avulsoDueDate = itemDateStr;
        if (params.tutorId != null) {
          const mensalidadeDia = await getTutorMensalidadeDia(params.tutorId, txClient);
          avulsoDueDate = this.getCycleDates(mensalidadeDia, itemDateStr).dueDate;
        }
        const newInv = await InvoiceRepository.create({
          crecheId: params.crecheId,
          tutorId: params.tutorId ?? null,
          cycleStart: undefined,
          cycleEnd: undefined,
          dueDate: avulsoDueDate,
          amount: totalItemAmount.toFixed(2),
          status: "pending",
        }, txClient);
        invoiceId = newInv.id;

      } else {
        // ── Ciclo mensal: coletor editável ou sucessora normal ────────────
        const tutorId = params.tutorId; // narrowed: not null here
        const mensalidadeDia = await getTutorMensalidadeDia(tutorId, txClient);
        const resolved = await this.resolveCollector({
          crecheId: params.crecheId,
          tutorId,
          mensalidadeDia,
          itemDateStr,
          businessDate,
          amount: totalItemAmount.toFixed(2),
          createIfMissing: true,
          tx: txClient,
        });

        if (!resolved) {
          throw Object.assign(
            new Error("Não foi possível criar o coletor editável da cobrança."),
            { status: 422 }
          );
        }

        if (resolved.created) {
          // A newly-created collector already contains this item's total.
          invoiceId = resolved.invoice.id;
        } else {
          const newTotal = (
            parseFloat(resolved.invoice.amount) + totalItemAmount
          ).toFixed(2);
          await InvoiceRepository.setAmount(resolved.invoice.id, newTotal, txClient);
          invoiceId = resolved.invoice.id;
        }
      }

      // ── Inserir item com snapshot histórico (Fase 14) ──────────────────
      const { id: invoiceItemId } = await InvoiceRepository.createItem({
        invoiceId,
        description: params.description,
        amount: amountVal.toString(),
        quantity,
        itemDate: params.itemDate || new Date(),
        petId: params.petId,
        bookingId: params.bookingId,
        orderId: params.orderId,
        itemType: params.type || "service",
        // Snapshot — capturado no momento da cobrança
        catalogueItemId: params.catalogueItemId,
        snapshotName: params.description,
        snapshotPrice: amountVal.toFixed(2),
        creditsAmount: params.creditsAmount,
        snapshotMaxPets: params.snapshotMaxPets,
        snapshotExpirationDays: params.snapshotExpiration ?? (params.creditsAmount ? 365 : undefined),
      }, txClient);

      // ── Audit log (Fase 14) ────────────────────────────────────────────
      await logFinancialAudit({
        crecheId: params.crecheId,
        userId: params.userId ?? 0,
        action: "invoice_create",
        referenceId: invoiceId,
        referenceType: "invoices",
        details:
          `Cobrança "${params.description}" × ${quantity} = R$${totalItemAmount.toFixed(2)}` +
          ` (tipo: ${params.type || "service"}).`,
      }, txClient);

      return { invoiceId, invoiceItemId };
    };

    if (params.tx) {
      return await executeLogic(params.tx);
    } else {
      return await db.transaction(executeLogic);
    }
  }

  /**
   * Processa pagamento Stripe — delega ao fluxo padrão de pagamento manual.
   * FinancialSync chama este método em vez de escrever no banco diretamente.
   */
  /**
   * Processes a partial item refund on an invoice.
   * - Restores stock (if product type)
   * - Adjusts invoice total or creates a negative transaction (if paid)
   * - Writes audit log
   */
  static async refundItem(params: {
    invoiceId: number;
    crecheId: number;
    invoiceItemId: number;
    quantity: number;
    userId: number;
  }) {
    const { invoiceId, crecheId, invoiceItemId, quantity, userId } = params;

    await db.transaction(async (tx) => {
      const invoice = await lockInvoiceForMutation(invoiceId, crecheId, tx);
      if (!invoice) throw Object.assign(new Error("Fatura não encontrada."), { status: 404 });

      const invoiceItem = await InvoiceRepository.findItemById(invoiceItemId, invoiceId, tx);
      if (!invoiceItem) throw Object.assign(new Error("Item da fatura não encontrado."), { status: 404 });
      if ((invoiceItem.quantity ?? 1) < quantity) {
        throw Object.assign(new Error("Quantidade de devolução maior que a comprada."), { status: 400 });
      }

      const canAdjustPending =
        invoice.status === "pending" &&
        invoice.dueDate >= getBusinessDate();
      const canRefundPaid = invoice.status === "paid";
      if (!canAdjustPending && !canRefundPaid) {
        throw Object.assign(
          new Error("Fatura congelada não permite estorno parcial de itens."),
          { status: 422 }
        );
      }

      // Restore stock if this is a product (Phase 14: prefer catalogueItemId snapshot)
      let catItem = invoiceItem.catalogueItemId
        ? await CatalogueRepository.findById(invoiceItem.catalogueItemId, tx)
        : await CatalogueRepository.findByNameAndCreche(crecheId, invoiceItem.description, tx);

      if (catItem && catItem.type === "product") {
        await CatalogueRepository.incrementStock(catItem.id, quantity, tx);
        await CatalogueRepository.createStockTransaction({
          itemId: catItem.id,
          crecheId,
          type: "in",
          quantity,
          reason: "Devolução / Estorno",
          userId,
        }, tx);
      }

      const itemTotalValue = Number(invoiceItem.amount) * quantity;

      if (canAdjustPending) {
        const newAmount = (Number(invoice.amount) - itemTotalValue).toString();
        await InvoiceRepository.setAmount(invoiceId, newAmount, tx);

        if ((invoiceItem.quantity ?? 1) === quantity) {
          await InvoiceRepository.deleteItem(invoiceItemId, tx);
        } else {
          await InvoiceRepository.updateItemQuantity(
            invoiceItemId,
            (invoiceItem.quantity ?? 1) - quantity,
            tx
          );
        }
      } else if (canRefundPaid) {
        // Paid invoices keep history intact — create a negative transaction
        await TransactionRepository.create({
          crecheId,
          invoiceId: invoice.id,
          type: "income",
          amount: (-itemTotalValue).toString(),
          transactionDate: getBusinessDate(),
          paymentMethod: "cash",
          description: `Estorno de Venda: ${invoiceItem.description} (Qtd: ${quantity})`,
        }, tx);
      }

      await logFinancialAudit({
        crecheId,
        userId,
        action: "invoice_refund",
        referenceId: invoice.id,
        referenceType: "invoices",
        details: `Estorno parcial/total do item ${invoiceItem.description} (Qtd: ${quantity})`,
      }, tx);

      await OutboxRepository.insert({
        type: "InvoiceRefunded",
        crecheId,
        invoiceId,
        tutorId: invoice.tutorId,
        amount: itemTotalValue.toString(),
        occurredAt: new Date().toISOString(),
      } as FinancialDomainEvent, tx);
    });
  }

  static async processStripePayment(params: {
    invoiceId: number;
    crecheId: number;
    stripeSessionId: string;
    isPackagePurchase?: boolean;
    tx: any;
  }): Promise<void> {
    const { invoiceId, crecheId, stripeSessionId, isPackagePurchase, tx } = params;

    const invoice = await lockInvoiceForMutation(invoiceId, crecheId, tx);
    if (!invoice) return;

    // Idempotência: se já processado por um worker anterior, sair silenciosamente
    if (InvoiceStateMachine.isAlreadyProcessedForPayment(invoice.status)) {
      financialLog({
        operation: "stripe_payment_idempotent",
        invoiceId,
        invoiceStatus: invoice.status,
        result: "skipped",
      });
      return;
    }

    await InvoiceRepository.markPaid(invoiceId, "stripe", tx);

    await TransactionRepository.create({
      crecheId,
      invoiceId,
      type: "income",
      amount: invoice.amount,
      transactionDate: getBusinessDate(),
      paymentMethod: "stripe",
      description: `Pagamento Stripe da Fatura #${invoiceId}`,
    }, tx);

    const paidOrdersStripe = await OrderRepository.markPaidByInvoice(invoiceId, tx);
    for (const o of paidOrdersStripe) {
      await OutboxRepository.insert({
        type: "OrderPaid",
        crecheId,
        invoiceId,
        occurredAt: new Date().toISOString(),
      } as FinancialDomainEvent, tx);
    }

    if (isPackagePurchase) {
      await (await import("./credits.js")).releasePurchasedCredits(invoiceId, 0, tx);
    }

    await logFinancialAudit({
      crecheId,
      userId: 0, // 0 = sistema / Stripe
      action: "manual_payment_register",
      referenceId: invoiceId,
      referenceType: "invoices",
      details: `Fatura #${invoiceId} paga via Stripe (session: ${stripeSessionId}).`,
    }, tx);

    await OutboxRepository.insert({
      type: "InvoicePaid",
      crecheId,
      invoiceId,
      tutorId: invoice.tutorId,
      amount: invoice.amount,
      paymentMethod: "stripe",
      occurredAt: new Date().toISOString(),
    } as FinancialDomainEvent, tx);
  }
}
