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
    return status === "paid" || status === "refunded" || status === "voided";
  }
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
    fallback.setDate(fallback.getDate() + 3);
    return fallback.toISOString().split("T")[0];
  }

  const today = new Date();
  let dueMonth = today.getMonth();
  let dueYear = today.getFullYear();

  if (today.getDate() > tutorMensalidadeDia) {
    dueMonth += 1;
    if (dueMonth > 11) {
      dueMonth = 0;
      dueYear += 1;
    }
  }

  const lastDayOfMonth = new Date(dueYear, dueMonth + 1, 0).getDate();
  const actualDay = Math.min(tutorMensalidadeDia, lastDayOfMonth);
  const finalDueDate = new Date(dueYear, dueMonth, actualDay);
  return finalDueDate.toISOString().split("T")[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// hasOverdueInvoices
// ─────────────────────────────────────────────────────────────────────────────

export async function hasOverdueInvoices(tutorId: number): Promise<boolean> {
  return InvoiceRepository.hasOverdue(tutorId);
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
    const invoice = await InvoiceRepository.findByIdAndCrecheForUpdate(invoiceId, crecheId, tx);
    if (!invoice) throw new Error("Fatura não encontrada");
    InvoiceStateMachine.assertTransition(invoice.status, "paid");

    await InvoiceRepository.markPaid(invoiceId, paymentMethod, tx);

    await TransactionRepository.create({
      crecheId: invoice.crecheId,
      invoiceId: invoice.id,
      type: "income",
      amount: invoice.amount,
      transactionDate: new Date().toISOString().split("T")[0],
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
    const invoice = await InvoiceRepository.findByIdAndCrecheForUpdate(invoiceId, crecheId, tx);
    if (!invoice) throw new Error("Fatura não encontrada");
    InvoiceStateMachine.assertTransition(invoice.status, "paid");

    await InvoiceRepository.markPaid(invoiceId, invoice.paymentMethod || "pix", tx);

    await TransactionRepository.create({
      crecheId: invoice.crecheId,
      invoiceId: invoice.id,
      type: "income",
      amount: invoice.amount,
      transactionDate: new Date().toISOString().split("T")[0],
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
    const invoice = await InvoiceRepository.findByIdAndCrecheForUpdate(invoiceId, crecheId, tx);
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
    const invoice = await InvoiceRepository.findByIdAndCrecheForUpdate(invoiceId, crecheId, tx);
    if (!invoice) throw new Error("Fatura não encontrada");
    InvoiceStateMachine.assertTransition(invoice.status, "refunded");

    await InvoiceRepository.markRefunded(invoiceId, tx);

    await TransactionRepository.create({
      crecheId: invoice.crecheId,
      invoiceId: invoice.id,
      type: "expense",
      amount: invoice.amount,
      transactionDate: new Date().toISOString().split("T")[0],
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
   * Calcula os limites exatos de um ciclo de faturamento baseado no dia de
   * mensalidade do tutor.
   */
  static getCycleDates(
    mensalidadeDia: number | null | undefined,
    txDateStr: string = new Date().toISOString().split("T")[0]
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

  /**
   * Adiciona uma cobrança ao tutor.
   *
   * Regras:
   * - Cobranças avulsas (`isAvulso: true`) criam invoice própria, nunca reabrem a mensal.
   * - Cobranças mensais fazem merge no ciclo atual SE o ciclo estiver em status aberto
   *   (pending/overdue). Se o ciclo já estiver fechado (paid/refunded/voided), cria
   *   invoice avulsa — NUNCA reabre invoice já liquidada.
   * - Se `existingInvoiceId` for fornecido, adiciona ao invoice existente (multi-item orders).
   *   Se o invoice não for encontrado, lança erro (não cria item órfão).
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
    const itemDateStr = (params.itemDate || new Date()).toISOString().split("T")[0];

    const executeLogic = async (txClient: any) => {
      let invoiceId: number;

      if (params.existingInvoiceId) {
        // ── Append to an already-created invoice (multi-item orders) ──────
        const existing = await InvoiceRepository.findById(params.existingInvoiceId, txClient);

        if (!existing) {
          throw new Error(
            `[BillingService.addCharge] Invoice #${params.existingInvoiceId} não encontrada. ` +
            `Item não foi criado para evitar registro órfão.`
          );
        }

        const newTotal = (parseFloat(existing.amount) + totalItemAmount).toFixed(2);
        await InvoiceRepository.setAmount(params.existingInvoiceId, newTotal, txClient);
        invoiceId = params.existingInvoiceId;

      } else if (params.isAvulso || params.tutorId == null) {
        // ── Avulso: invoice standalone, nunca reabrir mensal.
        // Also covers anonymous POS sales (tutorId=null) — they are always
        // standalone so each sale gets its own invoice and the unique index
        // on (tutorId, cycleStart, cycleEnd) is never contested.
        const newInv = await InvoiceRepository.create({
          crecheId: params.crecheId,
          tutorId: params.tutorId ?? null,
          // Anonymous sales omit cycleStart/cycleEnd so concurrent invoices
          // don't collide on the unique index (NULL != NULL in Postgres).
          cycleStart: params.isAvulso ? itemDateStr : undefined,
          cycleEnd: params.isAvulso ? itemDateStr : undefined,
          dueDate: itemDateStr,
          amount: totalItemAmount.toFixed(2),
          status: "pending",
        }, txClient);
        invoiceId = newInv.id;

      } else {
        // ── Ciclo mensal: merge ou nova invoice ───────────────────────────
        const tutorId = params.tutorId; // narrowed: not null here
        const mensalidadeDia = await getTutorMensalidadeDia(tutorId, txClient);
        const cycle = this.getCycleDates(mensalidadeDia, itemDateStr);

        const existing = await InvoiceRepository.findByCycleForUpdate(
          params.tutorId,
          cycle.cycleStart,
          cycle.cycleEnd,
          txClient
        );

        if (existing) {
          if (InvoiceStateMachine.isClosed(existing.status)) {
            // F-03: Ciclo já encerrado — criar avulsa overflow em vez de reabrir
            financialLog({
              operation: "billing_overflow_avulso",
              level: "warn",
              tenantId: params.crecheId,
              userId: params.userId,
              tutorId: params.tutorId,
              cycleStart: cycle.cycleStart,
              cycleEnd: cycle.cycleEnd,
              closedStatus: existing.status,
              result: "overflow_avulso_created",
            });
            const newInv = await InvoiceRepository.create({
              crecheId: params.crecheId,
              tutorId: params.tutorId,
              dueDate: itemDateStr,
              amount: totalItemAmount.toFixed(2),
              status: "pending",
            }, txClient);
            invoiceId = newInv.id;
          } else {
            // Ciclo aberto (pending/overdue) — merge normal
            const newTotal = (parseFloat(existing.amount) + totalItemAmount).toFixed(2);
            await InvoiceRepository.setAmount(existing.id, newTotal, txClient);
            invoiceId = existing.id;
          }
        } else {
          // Primeiro lançamento do ciclo — criar invoice mensal
          const newInv = await InvoiceRepository.create({
            crecheId: params.crecheId,
            tutorId: params.tutorId,
            cycleStart: cycle.cycleStart,
            cycleEnd: cycle.cycleEnd,
            dueDate: cycle.dueDate,
            amount: totalItemAmount.toFixed(2),
            status: "pending",
          }, txClient);
          invoiceId = newInv.id;
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
      const invoice = await InvoiceRepository.findByIdAndCreche(invoiceId, crecheId, tx);
      if (!invoice) throw Object.assign(new Error("Fatura não encontrada."), { status: 404 });

      const invoiceItem = await InvoiceRepository.findItemById(invoiceItemId, invoiceId, tx);
      if (!invoiceItem) throw Object.assign(new Error("Item da fatura não encontrado."), { status: 404 });
      if ((invoiceItem.quantity ?? 1) < quantity) {
        throw Object.assign(new Error("Quantidade de devolução maior que a comprada."), { status: 400 });
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

      if (invoice.status === "pending") {
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
      } else if (invoice.status === "paid") {
        // Paid invoices keep history intact — create a negative transaction
        await TransactionRepository.create({
          crecheId,
          invoiceId: invoice.id,
          type: "income",
          amount: (-itemTotalValue).toString(),
          transactionDate: new Date().toISOString().split("T")[0],
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

    const invoice = await InvoiceRepository.findByIdForUpdate(invoiceId, tx);
    if (!invoice) return;

    // Idempotência: se já processado por um worker anterior, sair silenciosamente
    if (InvoiceStateMachine.isClosed(invoice.status)) {
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
      transactionDate: new Date().toISOString().split("T")[0],
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
